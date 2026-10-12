/**
 * Run Engine is one of the two manual gates. It must never become a no-op.
 *
 * The enqueue authority reuses an "active" Engine job rather than minting a
 * duplicate, and counts QUEUED, RUNNING and PARTIAL_SUCCESS as active. Only
 * QUEUED is claimable — claimJobForCaller updates `status = 'QUEUED'` and
 * nothing else — so two of those three states reused a row no worker could
 * ever take:
 *
 *   RUNNING          a worker killed mid-invocation leaves the row RUNNING
 *                    forever. Every later click resolved to that corpse and
 *                    answered 202 for it, and the route skips the wake when
 *                    the status is not QUEUED. Nothing else clears it on a
 *                    Preview deployment: run-next's unattended sweeps run only
 *                    for the automated caller, and the drain cron posts to the
 *                    default-branch host. The only remaining path was a
 *                    browser parked on the job's status endpoint — exactly the
 *                    dependency the owner contract removes.
 *
 *   PARTIAL_SUCCESS  reused forever, and retry state is recorded for
 *                    AI_ANALYZE only, so no sweep would ever re-arm it either.
 *
 * In both cases the owner's only manual control stopped doing anything, for
 * that revision, permanently — while answering "accepted" every time.
 *
 * What must NOT change: a genuinely live Engine run is never interrupted by a
 * second click, and no click ever creates a duplicate Engine job.
 *
 * Requires RUN_DB_INTEGRATION=true. Skips cleanly otherwise.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";

const RUN_DB = process.env.RUN_DB_INTEGRATION === "true";
const dbDescribe = RUN_DB ? describe : describe.skip;

dbDescribe("the Run Engine gate never becomes a no-op", () => {
  const { PrismaClient } = require("@prisma/client");
  const { randomUUID } = require("node:crypto");
  const { enqueueEngineJobForCurrentSources } = require("../lib/engine/enqueue-engine-job");
  const { claimJobForCaller } = require("../lib/job-claim-policy");
  const { MAX_DURABLE_STAGE_ATTEMPTS } = require("../lib/engine/stage-retry-policy");

  const prisma = new PrismaClient();

  let userId = "";
  let companyId = "";
  let tenderId = "";

  const runEngine = () =>
    enqueueEngineJobForCurrentSources(prisma, {
      userId,
      tenderId,
      companyId,
      manualRequested: true,
    });

  before(async () => {
    const user = await prisma.user.create({
      data: {
        name: "Gate Owner",
        email: `gate-owner+${Date.now()}@example.test`,
        passwordHash: "x",
        role: "ADMIN",
      },
    });
    userId = user.id;
    const company = await prisma.company.create({ data: { userId, name: "Gate Works" } });
    companyId = company.id;
    const tender = await prisma.tender.create({
      data: { id: randomUUID(), userId, title: "Gate RFP", status: "ACTIVE" },
    });
    tenderId = tender.id;
  });

  beforeEach(async () => {
    await prisma.aiJob.deleteMany({ where: { tenderId } });
  });

  after(async () => {
    if (userId) await prisma.aiJob.deleteMany({ where: { userId } }).catch(() => {});
    if (tenderId) await prisma.tender.delete({ where: { id: tenderId } }).catch(() => {});
    if (companyId) await prisma.company.delete({ where: { id: companyId } }).catch(() => {});
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect().catch(() => {});
  });

  it("produces a claimable job on a first run", async () => {
    const result = await runEngine();
    assert.ok(result, "the revision must resolve for a tender with a company");
    assert.equal(result.job.status, "QUEUED");
    assert.equal(result.job.reusedActiveJob, false);

    const claimed = await claimJobForCaller({ jobType: "ENGINE_RUN", tenderId, userId, global: false });
    assert.ok(claimed, "the gate must hand the worker something it can claim");
    assert.equal(claimed.id, result.job.id);
  });

  it("recovers this tender's abandoned run instead of reusing a corpse", async () => {
    const first = await runEngine();
    // Simulate the worker being killed: claimed, then never finishing, and
    // stale enough for the shared staleness rule to call it abandoned.
    await prisma.aiJob.update({
      where: { id: first.job.id },
      data: { status: "RUNNING", startedAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const second = await runEngine();
    assert.equal(second.job.status, "QUEUED", "the owner's click must produce claimable work");

    const dead = await prisma.aiJob.findUnique({ where: { id: first.job.id }, select: { status: true } });
    assert.equal(dead.status, "FAILED", "the abandoned run must be closed, not left RUNNING forever");

    const claimed = await claimJobForCaller({ jobType: "ENGINE_RUN", tenderId, userId, global: false });
    assert.ok(claimed, "a worker must be able to claim the new run");
    assert.equal(claimed.id, second.job.id);
  });

  it("does not interrupt a genuinely live run", async () => {
    // A second click while the Engine is actually working must reuse the live
    // job untouched — recovering it would kill a healthy run mid-flight.
    const first = await runEngine();
    await prisma.aiJob.update({
      where: { id: first.job.id },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    await prisma.aiJobStep.create({
      data: { jobId: first.job.id, stepIndex: 0, stepName: "engine.match", status: "RUNNING" },
    });

    const second = await runEngine();
    assert.equal(second.job.id, first.job.id, "a live run must be reused, not duplicated");
    assert.equal(second.job.reusedActiveJob, true);
    const live = await prisma.aiJob.findUnique({ where: { id: first.job.id }, select: { status: true } });
    assert.equal(live.status, "RUNNING", "a live run must be left strictly alone");

    const count = await prisma.aiJob.count({ where: { tenderId, jobType: "ENGINE_RUN" } });
    assert.equal(count, 1, "no click may create a duplicate Engine job");
  });

  it("re-arms a partial run rather than reusing an unclaimable row", async () => {
    const first = await runEngine();
    await prisma.aiJob.update({
      where: { id: first.job.id },
      data: { status: "PARTIAL_SUCCESS", finishedAt: new Date() },
    });

    const second = await runEngine();
    assert.equal(second.job.id, first.job.id, "the same manually authorized job is re-armed, not replaced");
    assert.equal(second.job.reusedActiveJob, true);
    assert.equal(second.job.status, "QUEUED", "a reused partial run must become claimable");

    const claimed = await claimJobForCaller({ jobType: "ENGINE_RUN", tenderId, userId, global: false });
    assert.ok(claimed, "the re-armed run must be claimable by a worker");
    assert.equal(claimed.id, first.job.id);

    const count = await prisma.aiJob.count({ where: { tenderId, jobType: "ENGINE_RUN" } });
    assert.equal(count, 1, "re-arming must not leave a second Engine job behind");
  });

  it("stops re-arming a partial run once the shared attempt budget is spent", async () => {
    // Repeated clicks on a genuinely broken revision must not loop forever.
    // The bound is the same one classifyStageRetry uses.
    const first = await runEngine();
    await prisma.aiJob.update({
      where: { id: first.job.id },
      data: {
        status: "PARTIAL_SUCCESS",
        finishedAt: new Date(),
        retries: MAX_DURABLE_STAGE_ATTEMPTS,
      },
    });

    const second = await runEngine();
    assert.equal(second.job.status, "PARTIAL_SUCCESS", "the exhausted row is reported as it is, not re-armed");
    const row = await prisma.aiJob.findUnique({ where: { id: first.job.id }, select: { retries: true } });
    assert.equal(row.retries, MAX_DURABLE_STAGE_ATTEMPTS, "the attempt counter must not keep climbing");
  });

  it("leaves another tenant's abandoned run alone", async () => {
    // Recovery is scoped to the clicking owner's own tender. One owner's click
    // must never touch anyone else's job.
    const other = await prisma.user.create({
      data: {
        name: "Other Owner",
        email: `other-owner+${Date.now()}@example.test`,
        passwordHash: "x",
        role: "ADMIN",
      },
    });
    const otherTender = await prisma.tender.create({
      data: { id: randomUUID(), userId: other.id, title: "Other RFP", status: "ACTIVE" },
    });
    const otherJob = await prisma.aiJob.create({
      data: {
        userId: other.id,
        tenderId: otherTender.id,
        jobType: "ENGINE_RUN",
        status: "RUNNING",
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
        input: "{}",
      },
    });

    try {
      await runEngine();
      const untouched = await prisma.aiJob.findUnique({
        where: { id: otherJob.id },
        select: { status: true },
      });
      assert.equal(untouched.status, "RUNNING", "another tenant's job must not be recovered by this click");
    } finally {
      await prisma.aiJob.deleteMany({ where: { userId: other.id } }).catch(() => {});
      await prisma.tender.delete({ where: { id: otherTender.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: other.id } }).catch(() => {});
    }
  });
});
