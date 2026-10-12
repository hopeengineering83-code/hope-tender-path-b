// Integration test: reapStaleQueuedJobs actually reaps stale QUEUED AiJob
// rows against a real PostgreSQL database, and leaves everything else alone.
//
// This replaces a prior source-regex-only test suite (readFileSync + string
// matching against lib/engine/stale-job-reaper.ts) with real execution
// against real rows, per the "existence-only tests must become real
// integration tests" requirement. The prior tests only proved the file
// contained certain substrings — they never proved the function actually
// reaped anything, was idempotent against real DB state, or left non-stale
// rows untouched.

import { before, after, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { reapStaleQueuedJobs } from "../lib/engine/stale-job-reaper";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let userId: string;
let tenderId: string;

describe("reapStaleQueuedJobs — real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `stale-reaper-${nonce}@example.test`,
        name: "Stale Reaper Integration Test",
        passwordHash: "test-hash",
      },
    });
    userId = user.id;
    const tender = await prisma.tender.create({
      data: {
        userId,
        title: `Stale Reaper Tender ${nonce}`,
        clientName: "Stale Reaper Procuring Authority",
        reference: `SR-${nonce}`,
        country: "Ethiopia",
        status: "DRAFT",
        stage: "TENDER_INTAKE",
        exactFileNaming: '["Technical Proposal.docx"]',
        exactFileOrder: '[1]',
        submissionMethod: "email",
        submissionAddress: "submission@example.com",
        submissionEmails: "submission@example.com",
        submissionEmailSubject: "Tender Submission",
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    tenderId = tender.id;
  });

  after(async () => {
    await prisma.aiJob.deleteMany({ where: { tenderId } });
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("reaps a QUEUED job the worker demonstrably passed over", async () => {
    // This used to assert that age alone is enough to reap. It isn't, and
    // asserting it was pinned a defect: claiming is FIFO within a job type,
    // the queue drains one job per 5-minute tick, and the cron that drives it
    // documents 5–15 minutes of drift — so a healthy backlog crossed 30
    // minutes routinely and had its work destroyed.
    //
    // The fixture now supplies the evidence that makes "orphaned" true: a
    // NEWER job of the same type already started, which under FIFO can only
    // happen if this one was skipped.
    const staleJob = await prisma.aiJob.create({
      data: {
        tenderId,
        userId,
        jobType: "AI_ANALYZE",
        status: "QUEUED",
        input: "{}",
        createdAt: new Date(Date.now() - 31 * 60 * 1000),
      },
    });
    const overtook = await prisma.aiJob.create({
      data: {
        tenderId,
        userId,
        jobType: "AI_ANALYZE",
        status: "SUCCEEDED",
        input: "{}",
        createdAt: new Date(Date.now() - 20 * 60 * 1000),
        startedAt: new Date(Date.now() - 20 * 60 * 1000),
      },
    });

    const result = await reapStaleQueuedJobs();
    assert.ok(result.reaped >= 1, "must reap the job that was skipped while a newer sibling ran");
    assert.equal(result.errors.length, 0);

    const refreshed = await prisma.aiJob.findUnique({ where: { id: staleJob.id } });
    assert.equal(refreshed?.status, "FAILED");
    assert.match(refreshed?.errorMessage ?? "", /passed over/);
    assert.ok(refreshed?.finishedAt, "finishedAt must be set on reap");

    await prisma.aiJob.delete({ where: { id: overtook.id } });
  });

  it("leaves a backlogged job alone — waiting your turn is not being orphaned", async () => {
    // The product promise is upload once and walk away. The queue drains one
    // job per tick, so a handful of tenders puts later jobs well past 30
    // minutes with nothing wrong. Reaping them marked healthy work FAILED and
    // stopped the automatic chain short of a downloadable ZIP.
    const ahead = await prisma.aiJob.create({
      data: {
        tenderId,
        userId,
        jobType: "ENGINE_RUN",
        status: "QUEUED",
        input: "{}",
        createdAt: new Date(Date.now() - 90 * 60 * 1000),
      },
    });
    const behind = await prisma.aiJob.create({
      data: {
        tenderId,
        userId,
        jobType: "ENGINE_RUN",
        status: "QUEUED",
        input: "{}",
        createdAt: new Date(Date.now() - 40 * 60 * 1000),
      },
    });

    await reapStaleQueuedJobs();

    for (const [label, id] of [["head of queue", ahead.id], ["behind it", behind.id]] as const) {
      const refreshed = await prisma.aiJob.findUnique({ where: { id } });
      assert.equal(refreshed?.status, "QUEUED", `${label}: a backlogged job must survive the reaper`);
    }

    await prisma.aiJob.deleteMany({ where: { id: { in: [ahead.id, behind.id] } } });
  });

  it("does not infer a pass-over from another tenant's queue progress", async () => {
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const otherUser = await prisma.user.create({
      data: {
        email: `stale-reaper-other-${nonce}@example.test`,
        name: "Other Tenant",
        passwordHash: "test-hash",
      },
    });
    const waiting = await prisma.aiJob.create({
      data: {
        tenderId,
        userId,
        jobType: "ENGINE_RUN",
        status: "QUEUED",
        input: "{}",
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    const foreignProgress = await prisma.aiJob.create({
      data: {
        userId: otherUser.id,
        jobType: "ENGINE_RUN",
        status: "SUCCEEDED",
        input: "{}",
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    await reapStaleQueuedJobs();

    assert.equal((await prisma.aiJob.findUnique({ where: { id: waiting.id } }))?.status, "QUEUED");
    await prisma.aiJob.deleteMany({ where: { id: { in: [waiting.id, foreignProgress.id] } } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  it("leaves a job alone through a worker outage — nothing newer ran either", async () => {
    // If the GitHub Actions drain is down for an hour, every queued job ages
    // past the threshold. None of them was skipped; the worker simply never
    // ran. Failing them turns an outage into permanent data loss for work
    // that would have completed on the next tick.
    const outageJob = await prisma.aiJob.create({
      data: {
        tenderId,
        userId,
        jobType: "AUTO_FINALIZE",
        status: "QUEUED",
        input: "{}",
        createdAt: new Date(Date.now() - 120 * 60 * 1000),
      },
    });

    await reapStaleQueuedJobs();

    const refreshed = await prisma.aiJob.findUnique({ where: { id: outageJob.id } });
    assert.equal(refreshed?.status, "QUEUED", "an outage must not destroy queued work");

    await prisma.aiJob.delete({ where: { id: outageJob.id } });
  });

  it("a newer sibling of a DIFFERENT type running is not evidence of being skipped", async () => {
    // Targeted claims are legitimate: the Vault page posts
    // run-next?jobType=VAULT_INGEST, which correctly takes a VAULT_INGEST
    // created after a queued EVALUATOR_SIM. That is the type filter working,
    // not the queue passing anything over.
    const waiting = await prisma.aiJob.create({
      data: {
        tenderId,
        userId,
        jobType: "EVALUATOR_SIM",
        status: "QUEUED",
        input: "{}",
        createdAt: new Date(Date.now() - 50 * 60 * 1000),
      },
    });
    const otherType = await prisma.aiJob.create({
      data: {
        tenderId,
        userId,
        jobType: "VAULT_INGEST",
        status: "SUCCEEDED",
        input: "{}",
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });

    await reapStaleQueuedJobs();

    const refreshed = await prisma.aiJob.findUnique({ where: { id: waiting.id } });
    assert.equal(refreshed?.status, "QUEUED", "a type-filtered claim must not condemn another type");

    await prisma.aiJob.deleteMany({ where: { id: { in: [waiting.id, otherType.id] } } });
  });

  it("does not touch a QUEUED job created recently", async () => {
    const freshJob = await prisma.aiJob.create({
      data: {
        tenderId,
        userId,
        jobType: "AI_ANALYZE",
        status: "QUEUED",
        input: "{}",
        createdAt: new Date(),
      },
    });

    await reapStaleQueuedJobs();

    const refreshed = await prisma.aiJob.findUnique({ where: { id: freshJob.id } });
    assert.equal(refreshed?.status, "QUEUED", "a freshly queued job must not be reaped");
  });

  it("does not touch a RUNNING job, even if started long ago (that's failStuckJobs' job, not this reaper's)", async () => {
    const runningJob = await prisma.aiJob.create({
      data: {
        tenderId,
        userId,
        jobType: "ENGINE_RUN",
        status: "RUNNING",
        input: "{}",
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    await reapStaleQueuedJobs();

    const refreshed = await prisma.aiJob.findUnique({ where: { id: runningJob.id } });
    assert.equal(refreshed?.status, "RUNNING", "reapStaleQueuedJobs must only touch QUEUED jobs, never RUNNING ones");
  });

  it("is idempotent — a second call finds nothing left to reap for the same job", async () => {
    const staleJob = await prisma.aiJob.create({
      data: {
        tenderId,
        userId,
        jobType: "PROPOSAL_GENERATION",
        status: "QUEUED",
        input: "{}",
        createdAt: new Date(Date.now() - 45 * 60 * 1000),
      },
    });
    // Same skipped-evidence the reap path now requires.
    await prisma.aiJob.create({
      data: {
        tenderId,
        userId,
        jobType: "PROPOSAL_GENERATION",
        status: "SUCCEEDED",
        input: "{}",
        createdAt: new Date(Date.now() - 25 * 60 * 1000),
        startedAt: new Date(Date.now() - 25 * 60 * 1000),
      },
    });

    const first = await reapStaleQueuedJobs();
    assert.ok(first.reaped >= 1);

    const beforeSecond = await prisma.aiJob.findUnique({ where: { id: staleJob.id } });
    assert.equal(beforeSecond?.status, "FAILED");

    // Second call must not error and must not re-reap the already-FAILED job
    // (it's no longer QUEUED, so it falls outside the WHERE clause).
    const second = await reapStaleQueuedJobs();
    assert.equal(second.errors.length, 0);
    const afterSecond = await prisma.aiJob.findUnique({ where: { id: staleJob.id } });
    assert.equal(afterSecond?.status, "FAILED");
    assert.equal(afterSecond?.finishedAt?.getTime(), beforeSecond?.finishedAt?.getTime(), "second call must not touch an already-reaped row");
  });
});
