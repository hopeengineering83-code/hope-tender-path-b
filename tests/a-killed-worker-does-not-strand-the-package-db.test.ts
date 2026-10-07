// A worker killed mid-stage (the function cap, a crash) must not leave the
// tender waiting for someone to click Re-run. Stuck-job recovery used to mark
// ENGINE_RUN / PROPOSAL_GENERATION / AUTO_FINALIZE FAILED ("Re-run the
// engine"), so with the browser closed the package stopped for good. A
// killed durable stage now runs again from its checkpoint within the shared
// attempt budget — but only once no live invocation can still be running it,
// and exactly one concurrent caller can claim it.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prisma, prismaReady } from "../lib/prisma";
import { failStuckJobs, WORKER_INVOCATION_HARD_CAP_MS } from "../lib/ai-jobs";
import { claimJobForCaller } from "../lib/job-claim-policy";
import { MAX_DURABLE_STAGE_ATTEMPTS } from "../lib/engine/stage-retry-policy";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let userId = "";
let tenderId = "";

async function runningJob(jobType: string, startedMsAgo: number, retries = 0): Promise<string> {
  const startedAt = new Date(Date.now() - startedMsAgo);
  const job = await prisma.aiJob.create({ data: { userId, tenderId, jobType, status: "RUNNING", input: "{}", startedAt, retries } });
  await prisma.aiJobStep.create({ data: { jobId: job.id, stepIndex: 0, stepName: "engine.match", status: "RUNNING", createdAt: startedAt, startedAt } });
  return job.id;
}

describe("a killed worker does not strand the package — real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    userId = (await prisma.user.create({ data: { email: `killed-worker-${nonce}@example.test`, name: "Killed Worker", passwordHash: "h" } })).id;
    tenderId = (await prisma.tender.create({ data: { userId, title: `Killed worker ${nonce}`, status: "DRAFT", stage: "TENDER_INTAKE" } })).id;
  });

  after(async () => {
    const jobs = await prisma.aiJob.findMany({ where: { tenderId }, select: { id: true } });
    await prisma.aiJobStep.deleteMany({ where: { jobId: { in: jobs.map((j) => j.id) } } });
    await prisma.aiJob.deleteMany({ where: { tenderId } });
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("re-arms a durable stage whose worker is certainly dead, and one caller claims it", async () => {
    const id = await runningJob("PROPOSAL_GENERATION", WORKER_INVOCATION_HARD_CAP_MS + 60_000);
    const result = await failStuckJobs({ tenderId });
    assert.ok(result.rearmedIds.includes(id), JSON.stringify(result));
    const row = await prisma.aiJob.findUniqueOrThrow({ where: { id } });
    assert.equal(row.status, "QUEUED");
    assert.equal(row.retries, 1);
    assert.match(row.errorMessage ?? "", /WORKER_STOPPED/);

    const claims = await Promise.all(Array.from({ length: 6 }, () => claimJobForCaller({ global: true, tenderId })));
    assert.equal(claims.filter((c) => c?.id === id).length, 1, "exactly one concurrent caller claims the re-armed job");
  });

  it("leaves alone a stalled job a live invocation may still be running", async () => {
    const id = await runningJob("ENGINE_RUN", 200_000);
    const result = await failStuckJobs({ tenderId });
    assert.equal(result.rearmedIds.includes(id), false);
    assert.equal(result.ids.includes(id), false);
    assert.equal((await prisma.aiJob.findUniqueOrThrow({ where: { id } })).status, "RUNNING");
  });

  it("fails a stage that has spent its attempt budget", async () => {
    const id = await runningJob("AUTO_FINALIZE", WORKER_INVOCATION_HARD_CAP_MS + 60_000, MAX_DURABLE_STAGE_ATTEMPTS);
    const result = await failStuckJobs({ tenderId });
    assert.ok(result.ids.includes(id));
    assert.equal((await prisma.aiJob.findUniqueOrThrow({ where: { id } })).status, "FAILED");
  });

  it("running the sweep twice changes nothing more", async () => {
    const id = await runningJob("ENGINE_RUN", WORKER_INVOCATION_HARD_CAP_MS + 60_000);
    const [a, b] = await Promise.all([failStuckJobs({ tenderId }), failStuckJobs({ tenderId })]);
    assert.equal([...a.rearmedIds, ...b.rearmedIds].filter((x) => x === id).length, 1);
    assert.equal((await prisma.aiJob.findUniqueOrThrow({ where: { id } })).retries, 1);
  });
});
