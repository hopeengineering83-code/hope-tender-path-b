// The post-release scheduler test reads the queue from /api/admin/diagnostics.
// What it reports must be right and must be the caller's own: live jobs, the
// oldest queued age, retried jobs, and any tender with two live jobs for one
// pipeline stage — counts only, never another tenant's queue.
import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { getQueueHealth } from "../lib/queue-health";
import { executeTenderDeletion } from "../lib/tender/delete-tender";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let ownerId = "";
let otherId = "";
let tenderId = "";
let otherTenderId = "";

describe("queue health — real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    ownerId = (await prisma.user.create({ data: { email: `queue-health-${nonce}@example.test`, name: "Q", passwordHash: "h" } })).id;
    otherId = (await prisma.user.create({ data: { email: `queue-health-other-${nonce}@example.test`, name: "O", passwordHash: "h" } })).id;
    tenderId = (await prisma.tender.create({ data: { userId: ownerId, title: `Queue ${nonce}`, status: "DRAFT", stage: "TENDER_INTAKE" } })).id;
    otherTenderId = (await prisma.tender.create({ data: { userId: otherId, title: `Other ${nonce}`, status: "DRAFT", stage: "TENDER_INTAKE" } })).id;
    const old = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.aiJob.create({ data: { userId: ownerId, tenderId, jobType: "ENGINE_RUN", status: "QUEUED", input: "{}", createdAt: old } });
    await prisma.aiJob.create({ data: { userId: ownerId, tenderId, jobType: "ENGINE_RUN", status: "RUNNING", input: "{}", startedAt: new Date(), retries: 1 } });
    await prisma.aiJob.create({ data: { userId: ownerId, tenderId, jobType: "EXTRACT_TEXT", status: "QUEUED", input: "{}" } });
    await prisma.aiJob.create({ data: { userId: ownerId, tenderId, jobType: "EXTRACT_TEXT", status: "QUEUED", input: "{}" } });
    await prisma.aiJob.create({ data: { userId: otherId, tenderId: otherTenderId, jobType: "AI_ANALYZE", status: "QUEUED", input: "{}" } });
    await prisma.aiJob.create({ data: { userId: otherId, tenderId: otherTenderId, jobType: "AI_ANALYZE", status: "QUEUED", input: "{}" } });
  });

  after(async () => {
    await prisma.aiJob.deleteMany({ where: { userId: { in: [ownerId, otherId] } } });
    await prisma.$transaction((tx) => executeTenderDeletion(tx, tenderId, "queue-health-test", ownerId));
    await prisma.$transaction((tx) => executeTenderDeletion(tx, otherTenderId, "queue-health-test", otherId));
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  });

  it("reports the caller's live jobs, oldest queued age, retries and duplicate stage jobs", async () => {
    const health = await getQueueHealth(prisma, ownerId);
    assert.deepEqual(health.live, [
      { jobType: "ENGINE_RUN", status: "QUEUED", count: 1 },
      { jobType: "ENGINE_RUN", status: "RUNNING", count: 1 },
      { jobType: "EXTRACT_TEXT", status: "QUEUED", count: 2 },
    ]);
    assert.ok(health.oldestQueuedSeconds! >= 590, String(health.oldestQueuedSeconds));
    assert.equal(health.retriedLast24h, 1);
    assert.ok(health.lastJobStartedAt);
    assert.equal(health.duplicateLiveStageJobs, 1, "two live ENGINE_RUN jobs on one tender; two file extractions are not a duplicate");
  });

  it("never counts another tenant's queue", async () => {
    const health = await getQueueHealth(prisma, ownerId);
    assert.ok(!health.live.some((row) => row.jobType === "AI_ANALYZE"));
    const other = await getQueueHealth(prisma, otherId);
    assert.deepEqual(other.live, [{ jobType: "AI_ANALYZE", status: "QUEUED", count: 2 }]);
    assert.equal(other.duplicateLiveStageJobs, 1);
  });
});
