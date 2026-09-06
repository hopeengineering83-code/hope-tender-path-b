// Real DB-integration test: generic durable-stage retry/backoff.
//
// Before this fix, only AI_ANALYZE had a working automatic-retry path
// (AiAnalyzeRetryState + findJobsDueForRetry/rearmJobForRetry). EXTRACT_TEXT,
// VAULT_INGEST, ENGINE_RUN, and PROPOSAL_GENERATION all had
// classifyStageRetry() available (lib/engine/stage-retry-policy.ts) but
// nothing ever called it on a real handler failure — a transient failure in
// any of these job types went straight to a terminal FAILED status with no
// automatic recovery, identical to a genuinely non-retryable failure.
//
// The fix reuses AiJob's EXISTING generic retries/nextAttemptAt columns
// (already indexed — no new migration needed): rearmDurableStageJob()
// re-arms a RUNNING job back to QUEUED with a future nextAttemptAt, and
// claimJobForCaller() now gates claiming on nextAttemptAt having elapsed.
// app/api/ai-jobs/run-next/route.ts's catch block classifies every durable
// job type's failure and re-arms instead of terminally failing when the
// failure is retryable and the attempt budget remains.
//
// This test proves the mechanism against a real database — not just that
// the right functions are imported.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { enqueueJob, rearmDurableStageJob } from "../lib/ai-jobs";
import { claimJobForCaller } from "../lib/job-claim-policy";
import { classifyStageRetry, isDurableRetryJobType } from "../lib/engine/stage-retry-policy";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let userId: string;

describe("stage-retry-policy — classification contract", () => {
  it("recognizes all four durable-retry job types", () => {
    for (const jobType of ["EXTRACT_TEXT", "VAULT_INGEST", "ENGINE_RUN", "PROPOSAL_GENERATION"]) {
      assert.equal(isDurableRetryJobType(jobType), true, `${jobType} must be a durable-retry job type`);
    }
    assert.equal(isDurableRetryJobType("AI_REMATCH"), false, "job types without stage-retry wiring must not falsely qualify");
  });

  it("classifies PROPOSAL_GENERATION's evidence-gate failures as non-retryable", () => {
    assert.equal(classifyStageRetry("ZERO_REVIEWED_EXPERT_EVIDENCE: no reviewed experts", 0).retryable, false);
    assert.equal(classifyStageRetry("PROPOSAL_GENERATION blocked by readiness gate (BUILD_PLAN_NOT_CONFIRMED): ...", 0).retryable, false);
  });

  it("classifies PROPOSAL_GENERATION's concurrency guard as retryable (the other run will finish)", () => {
    const decision = classifyStageRetry("GENERATION_IN_PROGRESS", 0);
    assert.equal(decision.retryable, true);
    assert.equal(decision.delayMs, 30_000);
  });
});

describe("durable-stage retry/backoff — real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: { email: `stage-retry-${nonce}@example.test`, name: "Stage Retry Integration Test", passwordHash: "test-hash" },
    });
    userId = user.id;
  });

  after(async () => {
    await prisma.aiJob.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("rearmDurableStageJob re-queues a RUNNING job with a future nextAttemptAt and an incremented retry count", async () => {
    const job = await enqueueJob({ userId, jobType: "EXTRACT_TEXT", input: { tenderFileId: "does-not-matter" } });
    const claimed = await claimJobForCaller({ jobType: "EXTRACT_TEXT", global: true });
    assert.ok(claimed && claimed.id === job.id);
    assert.equal(claimed!.retries, 0, "a freshly enqueued job starts at 0 retries");

    const rearmed = await rearmDurableStageJob(job.id, { errorMessage: "ETIMEDOUT contacting storage", delayMs: 30_000 });
    assert.equal(rearmed, true);

    const row = await prisma.aiJob.findUnique({ where: { id: job.id } });
    assert.equal(row?.status, "QUEUED");
    assert.equal(row?.retries, 1);
    assert.ok(row?.nextAttemptAt && row.nextAttemptAt.getTime() > Date.now() + 20_000, "nextAttemptAt must be ~30s in the future");
    assert.equal(row?.leaseOwner, null);
    assert.equal(row?.startedAt, null);
  });

  it("claimJobForCaller does NOT reclaim a job whose backoff delay has not yet elapsed", async () => {
    const job = await enqueueJob({ userId, jobType: "EXTRACT_TEXT", input: {} });
    const firstClaim = await claimJobForCaller({ jobType: "EXTRACT_TEXT", global: true });
    assert.ok(firstClaim && firstClaim.id === job.id);

    await rearmDurableStageJob(job.id, { errorMessage: "ECONNRESET", delayMs: 600_000 });

    const secondClaim = await claimJobForCaller({ jobType: "EXTRACT_TEXT", global: true });
    assert.equal(secondClaim, null, "a job whose nextAttemptAt is 10 minutes out must not be claimable yet");
  });

  it("claimJobForCaller DOES reclaim a job once its backoff delay has elapsed", async () => {
    const job = await enqueueJob({ userId, jobType: "EXTRACT_TEXT", input: {} });
    await claimJobForCaller({ jobType: "EXTRACT_TEXT", global: true }); // move to RUNNING
    await rearmDurableStageJob(job.id, { errorMessage: "ETIMEDOUT", delayMs: 30_000 });

    // Simulate the backoff window having elapsed.
    await prisma.aiJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(Date.now() - 1_000) } });

    const reclaimed = await claimJobForCaller({ jobType: "EXTRACT_TEXT", global: true });
    assert.ok(reclaimed && reclaimed.id === job.id, "a job past its nextAttemptAt must be claimable again");
    assert.equal(reclaimed!.retries, 1, "the retry count from the prior attempt must be visible to the next handler run");
  });

  it("rearmDurableStageJob is a no-op (never resurrects) a job that already reached a terminal state", async () => {
    const job = await enqueueJob({ userId, jobType: "EXTRACT_TEXT", input: {} });
    await claimJobForCaller({ jobType: "EXTRACT_TEXT", global: true });
    await prisma.aiJob.update({ where: { id: job.id }, data: { status: "FAILED", finishedAt: new Date() } });

    const rearmed = await rearmDurableStageJob(job.id, { errorMessage: "ETIMEDOUT", delayMs: 30_000 });
    assert.equal(rearmed, false, "a job that already reached FAILED (e.g. raced by a concurrent recovery sweep) must not be resurrected");

    const row = await prisma.aiJob.findUnique({ where: { id: job.id } });
    assert.equal(row?.status, "FAILED", "the terminal state must be preserved");
  });

  it("regular freshly-enqueued jobs (nextAttemptAt = NULL) are unaffected by the backoff gate", async () => {
    const job = await enqueueJob({ userId, jobType: "VAULT_INGEST", input: { companyId: "does-not-matter" } });
    const row = await prisma.aiJob.findUnique({ where: { id: job.id } });
    assert.equal(row?.nextAttemptAt, null);
    const claimed = await claimJobForCaller({ jobType: "VAULT_INGEST", global: true });
    assert.ok(claimed && claimed.id === job.id, "a normal QUEUED job with no nextAttemptAt must be claimable immediately");
  });

  // ─── Max-attempts / retry-budget exhaustion ──────────────────────────────
  // classifyStageRetry's BACKOFF_MS array has 4 entries — a transient
  // failure gets re-armed at most 4 times before the SAME failure message
  // is treated as non-retryable (RETRY_BUDGET_EXHAUSTED_OR_UNKNOWN_FAILURE)
  // and terminally failed instead of looping forever. This proves that
  // boundary both as a pure classification check AND end-to-end against
  // real rows, replaying the exact claim -> classify -> conditionally-rearm
  // sequence app/api/ai-jobs/run-next/route.ts's catch block runs.
  it("classifyStageRetry: the same transient message is retryable up through retryCount 3, then exhausted at retryCount 4", () => {
    for (let retryCount = 0; retryCount < 4; retryCount++) {
      const decision = classifyStageRetry("ETIMEDOUT contacting storage", retryCount);
      assert.equal(decision.retryable, true, `retryCount=${retryCount} must still be retryable`);
    }
    const exhausted = classifyStageRetry("ETIMEDOUT contacting storage", 4);
    assert.equal(exhausted.retryable, false);
    assert.equal(exhausted.blockerCode, "RETRY_BUDGET_EXHAUSTED_OR_UNKNOWN_FAILURE");
  });

  it("a job re-armed 4 times for the same transient failure is terminally failed on the 5th failure, never resurrected again", async () => {
    const job = await enqueueJob({ userId, jobType: "EXTRACT_TEXT", input: {} });

    // Replay 4 real claim -> classify -> rearm cycles, exactly what
    // run-next's catch block does on each transient failure.
    for (let attempt = 0; attempt < 4; attempt++) {
      const claimed = await claimJobForCaller({ jobType: "EXTRACT_TEXT", global: true });
      assert.ok(claimed && claimed.id === job.id, `attempt ${attempt}: job must be claimable`);
      assert.equal(claimed!.retries, attempt, `attempt ${attempt}: retries must reflect ${attempt} prior rearms`);

      const decision = classifyStageRetry("ETIMEDOUT contacting storage", claimed!.retries);
      assert.equal(decision.retryable, true, `attempt ${attempt}: still within the retry budget`);
      const rearmed = await rearmDurableStageJob(job.id, { errorMessage: "ETIMEDOUT contacting storage", delayMs: decision.delayMs! });
      assert.equal(rearmed, true);

      // Simulate the backoff window elapsing so the next loop iteration can reclaim it.
      await prisma.aiJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(Date.now() - 1_000) } });
    }

    // 5th failure: retries is now 4 (the retry budget), so the SAME
    // transient-looking message must be classified non-retryable.
    const finalClaim = await claimJobForCaller({ jobType: "EXTRACT_TEXT", global: true });
    assert.ok(finalClaim && finalClaim.id === job.id);
    assert.equal(finalClaim!.retries, 4);
    const finalDecision = classifyStageRetry("ETIMEDOUT contacting storage", finalClaim!.retries);
    assert.equal(finalDecision.retryable, false);
    assert.equal(finalDecision.blockerCode, "RETRY_BUDGET_EXHAUSTED_OR_UNKNOWN_FAILURE");

    // Terminally fail it (mirrors run-next's fallback to failJob when
    // retryScheduled stays false) and prove it is never resurrected again.
    await prisma.aiJob.update({ where: { id: job.id }, data: { status: "FAILED", errorMessage: "ETIMEDOUT contacting storage", finishedAt: new Date() } });
    const rearmAfterExhaustion = await rearmDurableStageJob(job.id, { errorMessage: "ETIMEDOUT contacting storage", delayMs: 30_000 });
    assert.equal(rearmAfterExhaustion, false, "a terminally FAILED job must never be resurrected, even by a stray rearm call");

    const finalRow = await prisma.aiJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(finalRow.status, "FAILED");
    assert.equal(finalRow.retries, 4, "the retry counter is preserved at the exhausted budget, not incremented further");
  });
});
