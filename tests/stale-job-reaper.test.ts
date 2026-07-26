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

  it("reaps a QUEUED job created more than 30 minutes ago", async () => {
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

    const result = await reapStaleQueuedJobs();
    assert.ok(result.reaped >= 1, "must reap at least the one stale job created for this test");
    assert.equal(result.errors.length, 0);

    const refreshed = await prisma.aiJob.findUnique({ where: { id: staleJob.id } });
    assert.equal(refreshed?.status, "FAILED");
    assert.match(refreshed?.errorMessage ?? "", /never claimed by a worker/);
    assert.ok(refreshed?.finishedAt, "finishedAt must be set on reap");
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
