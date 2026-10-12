// The tender page the owner watches polls workflow-center. A queued job that
// has been due for over a minute with no claimant is woken from that poll;
// a job not yet due, or one already running, is left alone.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { prisma, prismaReady } from "../lib/prisma";
import { nudgeStalledTenderJob } from "../lib/ai-jobs/stalled-job-nudge";

const RUN = process.env.RUN_DB_INTEGRATION === "true";

describe("the polled page route nudges stalled work", () => {
  it("workflow-center calls the nudge before resolving state", () => {
    const route = readFileSync("app/api/tenders/[id]/workflow-center/route.ts", "utf8");
    assert.match(route, /await nudgeStalledTenderJob\(req, tenderId, actor\.id\)/);
  });
});

describe("a stalled job is nudged; a waiting one is not", { skip: RUN ? false : "requires RUN_DB_INTEGRATION=true and a real database" }, () => {
  let userId = "";
  let tenderId = "";
  before(async () => {
    await prismaReady;
    const user = await prisma.user.create({ data: { email: `nudge-${randomUUID()}@test.local`, passwordHash: "x", role: "PROPOSAL_MANAGER" } });
    userId = user.id;
    const tender = await prisma.tender.create({ data: { userId, title: "Nudge test" } });
    tenderId = tender.id;
  });
  after(async () => {
    await prisma.aiJob.deleteMany({ where: { userId } });
    await prisma.tender.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const req = () => new Request("https://app.example/api/tenders/x/workflow-center", { headers: { cookie: "session=abc" } });

  it("leaves a job alone while it is not yet due", async () => {
    await prisma.aiJob.create({ data: { userId, tenderId, jobType: "AUTO_FINALIZE", status: "QUEUED", input: "{}", nextAttemptAt: new Date(Date.now() + 120_000) } });
    assert.equal(await nudgeStalledTenderJob(req(), tenderId, userId, () => {}), null);
  });

  it("wakes a queued job that has been due with no claimant", async () => {
    const job = await prisma.aiJob.create({ data: { userId, tenderId, jobType: "PROPOSAL_GENERATION", status: "QUEUED", input: "{}" } });
    await prisma.$executeRaw`UPDATE "AiJob" SET "updatedAt" = NOW() - INTERVAL '5 minutes' WHERE id = ${job.id}`;
    assert.equal(await nudgeStalledTenderJob(req(), tenderId, userId, () => {}), "PROPOSAL_GENERATION");
  });

  it("ignores another user's job", async () => {
    assert.equal(await nudgeStalledTenderJob(req(), tenderId, randomUUID(), () => {}), null);
  });
});
