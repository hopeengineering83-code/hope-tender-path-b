import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { listUserJobs } from "../lib/ai-jobs";
import { prisma, prismaReady } from "../lib/prisma";

/**
 * THE DEFECT, measured on two consecutive hosted acceptance runs.
 * ---------------------------------------------------------------
 * The acceptance workflow reads /api/ai-jobs to fail loudly when a job in the
 * run's chain did not succeed. It printed:
 *
 *   AUTO_FINALIZE FAILED id=... created=... error=None
 *
 * A durable job that fails with no reason is unactionable — there is nothing
 * to act on and nothing to distinguish a real blocker from a lost one. The
 * reason was never lost: ai-job-handlers-legacy throws
 * "AUTO_FINALIZE_NOT_CONVERGED — <blockers>" precisely so it lands on
 * AiJob.errorMessage. `listUserJobs` simply never selected the column, so
 * every consumer read null. This is the "a missing JSON key read as null"
 * failure mode, and only a test that asserts the field ARRIVES can catch it:
 * a null reason and an absent column look identical from the outside.
 *
 * Scoping is asserted too — a reason must reach its own owner and no one else.
 */

const RUN = process.env.RUN_DB_INTEGRATION === "true";

describe("a failed job carries its reason out of the database", { skip: RUN ? false : "requires RUN_DB_INTEGRATION=true and a real database" }, () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = { id: "", email: `job-reason-owner-${suffix}@example.test` };
  const stranger = { id: "", email: `job-reason-stranger-${suffix}@example.test` };
  const REASON = "AUTO_FINALIZE_NOT_CONVERGED — Technical Proposal.pdf: blocked by hygiene (pricing)";
  let jobId = "";

  before(async () => {
    await prismaReady;
    for (const user of [owner, stranger]) {
      const created = await prisma.user.create({
        data: { email: user.email, passwordHash: "x" },
        select: { id: true },
      });
      user.id = created.id;
    }
    const job = await prisma.aiJob.create({
      data: {
        userId: owner.id,
        jobType: "AUTO_FINALIZE",
        status: "FAILED",
        errorMessage: REASON,
      },
      select: { id: true },
    });
    jobId = job.id;
  });

  after(async () => {
    if (jobId) await prisma.aiJob.deleteMany({ where: { id: jobId } });
    await prisma.user.deleteMany({ where: { email: { in: [owner.email, stranger.email] } } });
  });

  it("returns the reason the handler persisted, not null", async () => {
    const jobs = await listUserJobs(owner.id, { take: 10 });
    const job = jobs.find((row) => row.id === jobId);
    assert.ok(job, "the failed job must be listed at all");
    assert.equal(job.status, "FAILED");
    assert.equal(
      job.errorMessage,
      REASON,
      "a FAILED job whose reason reads as null is indistinguishable from one that recorded none",
    );
  });

  it("does not hand another user's failure reason to a stranger", async () => {
    const jobs = await listUserJobs(stranger.id, { take: 10 });
    assert.equal(jobs.find((row) => row.id === jobId), undefined);
  });
});
