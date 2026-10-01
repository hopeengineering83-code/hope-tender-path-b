// Real-DB proof that PROPOSAL_GENERATION now gets the SAME progress-only
// stuck-job recovery ENGINE_RUN already had (lib/ai-jobs.ts's
// isProgressStuckOnlyType + the PROPOSAL_GENERATION heartbeat added to
// lib/ai-job-handlers.ts). Before this fix, a PROPOSAL_GENERATION job killed
// mid-run by a Vercel function timeout (60s) sat RUNNING for the full 15
// minute wall-clock threshold before being recovered — this proves the
// heartbeat-driven ~90s recovery path now applies to it too, exactly like
// ENGINE_RUN, and that a still-progressing job (fresh heartbeat step) is
// correctly left alone.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { findStuckJobs, failStuckJobs } from "../lib/ai-jobs";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

const PROGRESS_MS = 90_000;
const TOTAL_MS = 15 * 60 * 1000;

let userId: string;

describe("PROPOSAL_GENERATION progress-only stuck recovery — real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    const user = await prisma.user.create({
      data: { email: `proposal-heartbeat-${Date.now()}@example.test`, name: "Proposal Heartbeat Test", passwordHash: "test-hash" },
    });
    userId = user.id;
  });

  after(async () => {
    await prisma.aiJobStep.deleteMany({ where: { job: { userId } } });
    await prisma.aiJob.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("a PROPOSAL_GENERATION job with no heartbeat step for >90s is found stuck even though wall-clock is well under 15 min", async () => {
    const startedAt = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago — under the 15 min wall-clock threshold
    const job = await prisma.aiJob.create({
      data: {
        userId, jobType: "PROPOSAL_GENERATION", status: "RUNNING", startedAt,
        input: JSON.stringify({}),
      },
    });

    const { jobs } = await findStuckJobs({ stuckAfterMs: TOTAL_MS, progressStuckAfterMs: PROGRESS_MS, limit: 50 });
    assert.ok(jobs.some((j) => j.id === job.id), "a heartbeat-less PROPOSAL_GENERATION job past the progress threshold must be found stuck");
  });

  it("a PROPOSAL_GENERATION job with a fresh heartbeat step is NOT found stuck, even at the same wall-clock age", async () => {
    const startedAt = new Date(Date.now() - 5 * 60 * 1000);
    const job = await prisma.aiJob.create({
      data: {
        userId, jobType: "PROPOSAL_GENERATION", status: "RUNNING", startedAt,
        input: JSON.stringify({}),
      },
    });
    // Simulate the 25s heartbeat: a fresh AiJobStep row within the last 90s.
    await prisma.aiJobStep.create({
      data: { jobId: job.id, stepIndex: 0, stepName: "proposal.heartbeat", status: "RUNNING", startedAt: new Date(), createdAt: new Date(Date.now() - 10_000) },
    });

    const { jobs } = await findStuckJobs({ stuckAfterMs: TOTAL_MS, progressStuckAfterMs: PROGRESS_MS, limit: 50 });
    assert.ok(!jobs.some((j) => j.id === job.id), "a PROPOSAL_GENERATION job with a heartbeat step within 90s must NOT be found stuck");
  });

  it("failStuckJobs terminally fails a heartbeat-less PROPOSAL_GENERATION job with the structured ASYNC_ENGINE_TIMEOUT payload", async () => {
    const startedAt = new Date(Date.now() - 5 * 60 * 1000);
    const job = await prisma.aiJob.create({
      data: {
        userId, jobType: "PROPOSAL_GENERATION", status: "RUNNING", startedAt,
        input: JSON.stringify({}),
      },
    });

    const result = await failStuckJobs({ stuckAfterMs: TOTAL_MS, progressStuckAfterMs: PROGRESS_MS, limit: 50 });
    assert.ok(result.ids.includes(job.id));

    const row = await prisma.aiJob.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(row.status, "FAILED");
    const output = JSON.parse(row.output ?? "{}") as { code: string; nextAction: string; safeModeAvailable: boolean };
    assert.equal(output.code, "ASYNC_ENGINE_TIMEOUT");
    assert.equal(output.nextAction, "RUN_ENGINE_SAFE_MODE");
  });

  it("a brand-new PROPOSAL_GENERATION job (started seconds ago, no steps yet) is never mistaken for stuck", async () => {
    const job = await prisma.aiJob.create({
      data: {
        userId, jobType: "PROPOSAL_GENERATION", status: "RUNNING", startedAt: new Date(),
        input: JSON.stringify({}),
      },
    });

    const { jobs } = await findStuckJobs({ stuckAfterMs: TOTAL_MS, progressStuckAfterMs: PROGRESS_MS, limit: 50 });
    assert.ok(!jobs.some((j) => j.id === job.id), "a freshly-started job must not be flagged stuck before the progress threshold elapses");
  });
});
