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
});
