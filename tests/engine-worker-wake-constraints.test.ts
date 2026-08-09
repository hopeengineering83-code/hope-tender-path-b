// Constraints the immediate Run Engine wake must hold, beyond the happy path.
//
// tests/engine-worker-handoff.test.ts already proves the sequential end-to-end
// story: one manual request persists one QUEUED job, the server-owned wake
// claims it, and it reaches SUCCEEDED. These are the properties that story
// cannot show, each mapping to a stated requirement of the feature:
//
//   exactly-once            — the wake adds a racer (wake vs cron vs a second
//                             click) that the sequential test never exercises
//   fail-closed authority   — the wake must sit behind every gate, so it can
//                             never start work the owner did not authorize
//   cron solely as recovery — the wake must not authenticate as an automated
//                             caller, or it would take over the recovery sweeps
//   scope                   — a wake must not reach another tenant, another
//                             tender, or another job type
//
// Without these, a regression could keep the happy path green while silently
// double-running the Engine, starting it before authority exists, or moving
// stuck-job recovery off the cron.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const RUN = process.env.RUN_DB_INTEGRATION === "true";

const stripComments = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

const wakeCode = stripComments(readFileSync("lib/ai-jobs/request-scoped-engine-worker-wake.ts", "utf8"));
const engineRouteCode = stripComments(readFileSync("app/api/tenders/[id]/engine/route.ts", "utf8"));
const runNext = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");
const claimPolicy = readFileSync("lib/job-claim-policy.ts", "utf8");

async function makeUser(tag: string) {
  const { prisma } = await import("../lib/prisma");
  return prisma.user.create({
    data: {
      email: `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      name: `${tag} test`,
      passwordHash: "unused",
      role: "PROPOSAL_MANAGER",
    },
  });
}

describe("Run Engine wake — fail-closed authority", () => {
  it("is scheduled only after the enqueue, behind every source gate", () => {
    const enqueueIdx = engineRouteCode.indexOf("enqueueEngineJobForCurrentSources(");
    const failedEnqueueGuard = engineRouteCode.indexOf("if (!enqueue)");
    const wakeIdx = engineRouteCode.indexOf("scheduleRequestScopedEngineWorkerWake(");
    assert.ok(enqueueIdx > 0 && failedEnqueueGuard > 0 && wakeIdx > 0);
    assert.ok(enqueueIdx < wakeIdx, "the wake must follow the enqueue");
    assert.ok(failedEnqueueGuard < wakeIdx, "the wake must follow the failed-enqueue guard");

    // Each fail-closed gate returns before control can reach the wake.
    for (const gate of [
      "NO_TENDER_FILES",
      "SOURCE_INTEGRITY_ENGINE_BLOCKED",
      "CURRENT_ANALYSIS_REQUIRED",
      "ANALYSIS_FROM_CORRUPTED_EXTRACTION",
      "ANALYSIS_FROM_WEAK_EXTRACTION",
      "COMPANY_VAULT_REQUIRED",
    ]) {
      const gateIdx = engineRouteCode.indexOf(gate);
      assert.ok(gateIdx > 0, `${gate} must still exist`);
      assert.ok(gateIdx < wakeIdx, `${gate} must be decided before the wake`);
    }
  });

  it("does not become a second way to reach the Engine without the owner", () => {
    assert.match(engineRouteCode, /manualRequested: true/);
    const enqueueSource = stripComments(readFileSync("lib/engine/enqueue-engine-job.ts", "utf8"));
    assert.match(enqueueSource, /MANUAL_RUN_ENGINE_REQUIRED/);
    assert.match(enqueueSource, /if \(!input\.manualRequested\)/);
  });

  it("defers to the durable worker instead of running the Engine inline", () => {
    assert.match(wakeCode, /new URL\("\/api\/ai-jobs\/run-next", requestUrl\.origin\)/);
    assert.doesNotMatch(wakeCode, /runTenderEngine|getHandler|claimJobForCaller/);
  });
});

describe("Run Engine wake — cron remains the only recovery path", () => {
  it("never authenticates as an automated caller", () => {
    // Presenting AI_JOBS_WORKER_SECRET or CRON_SECRET would make run-next treat
    // the wake as automated, handing it failStuckJobs / reapStaleQueuedJobs /
    // retry re-arm. Recovery must stay with the cron alone.
    assert.doesNotMatch(wakeCode, /AI_JOBS_WORKER_SECRET|CRON_SECRET|x-worker-secret/i);
    assert.match(wakeCode, /req\.headers\.get\("cookie"\)/);
  });

  it("keeps every recovery sweep inside run-next's automated-caller branch", () => {
    const automatedIdx = runNext.indexOf("if (isAutomatedCaller) {");
    assert.ok(automatedIdx > 0, "the automated-caller branch must exist");
    for (const sweep of ["failStuckJobs()", "reapStaleQueuedJobs()", "findJobsDueForRetry("]) {
      assert.ok(runNext.indexOf(sweep) > automatedIdx, `${sweep} must stay in the automated branch`);
    }
  });

  it("leaves the job queued for the cron rather than failing the owner's request", () => {
    assert.match(wakeCode, /if \(!cookie\)[\s\S]*return false/);
    assert.match(wakeCode, /catch \(error\)/);
    assert.doesNotMatch(wakeCode, /throw /);
  });
});

describe("Run Engine wake — exactly-once under contention", () => {
  it("relies on the transactional QUEUED claim as the single arbiter", () => {
    assert.match(claimPolicy, /"status" = 'QUEUED'/);
    assert.match(claimPolicy, /FOR UPDATE SKIP LOCKED/);
    assert.match(claimPolicy, /LIMIT 1/);
  });

  it("yields exactly one winner when the wake races the cron", { skip: !RUN }, async () => {
    const { prisma } = await import("../lib/prisma");
    const { claimJobForCaller } = await import("../lib/job-claim-policy");
    const user = await makeUser("engine-wake-race");

    // The cron claims with global: true, which is deliberately NOT user-scoped —
    // it takes the oldest claimable ENGINE_RUN row in the whole table. Left
    // unfiltered here, this test stole other suites' queued Engine jobs when the
    // runner executed them concurrently, and their own claims then found
    // nothing. Scoping every claim to this test's own tender keeps the global
    // (non-user-scoped) path under test while making the row set exclusively
    // ours.
    const tender = await prisma.tender.create({
      data: { userId: user.id, title: `Engine wake race ${Date.now()}` },
    });

    try {
      const job = await prisma.aiJob.create({
        data: {
          userId: user.id,
          tenderId: tender.id,
          jobType: "ENGINE_RUN",
          status: "QUEUED",
          input: JSON.stringify({ manualRequested: true, executionPolicy: "SERVER_CONTROLLED" }),
        },
      });

      // The wake claims tenant-scoped (session cookie -> global:false + userId);
      // the cron claims globally. Both reach the row at the same instant.
      const claims = await Promise.all([
        claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: tender.id, userId: user.id, global: false }),
        claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: tender.id, global: true }),
        claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: tender.id, userId: user.id, global: false }),
        claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: tender.id, global: true }),
      ]);

      const winners = claims.filter((c) => c && c.id === job.id);
      assert.equal(winners.length, 1, `exactly one caller may claim the job, got ${winners.length}`);
      assert.equal(
        (await prisma.aiJob.findUniqueOrThrow({ where: { id: job.id } })).status,
        "RUNNING",
      );
    } finally {
      await prisma.aiJob.deleteMany({ where: { userId: user.id } });
      await prisma.tender.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("cannot execute the same job twice when Run Engine is double-clicked", { skip: !RUN }, async () => {
    const { prisma } = await import("../lib/prisma");
    const { claimJobForCaller } = await import("../lib/job-claim-policy");
    const user = await makeUser("engine-wake-double");

    try {
      const job = await prisma.aiJob.create({
        data: {
          userId: user.id,
          jobType: "ENGINE_RUN",
          status: "QUEUED",
          input: JSON.stringify({ manualRequested: true }),
        },
      });

      // A second click reuses the same row (reusedActiveJob), so both clicks
      // wake the same job.
      const claims = await Promise.all(
        Array.from({ length: 12 }, () =>
          claimJobForCaller({ jobType: "ENGINE_RUN", userId: user.id, global: false })),
      );
      assert.equal(
        claims.filter((c) => c && c.id === job.id).length,
        1,
        "12 concurrent wakes must produce exactly one winner",
      );
    } finally {
      await prisma.aiJob.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});

describe("Run Engine wake — scope", () => {
  it("pins the request to ENGINE_RUN and the requested tender", () => {
    assert.match(wakeCode, /searchParams\.set\("jobType", "ENGINE_RUN"\)/);
    assert.match(wakeCode, /searchParams\.set\("tenderId", tenderId\)/);
  });

  it("cannot start another tenant's Engine job", { skip: !RUN }, async () => {
    const { prisma } = await import("../lib/prisma");
    const { claimJobForCaller } = await import("../lib/job-claim-policy");
    const owner = await makeUser("engine-wake-owner");
    const intruder = await makeUser("engine-wake-intruder");

    try {
      const job = await prisma.aiJob.create({
        data: {
          userId: owner.id,
          jobType: "ENGINE_RUN",
          status: "QUEUED",
          input: JSON.stringify({ manualRequested: true }),
        },
      });

      // The wake forwards the caller's own session, so run-next resolves the
      // intruder and claims with their userId.
      const claimed = await claimJobForCaller({
        jobType: "ENGINE_RUN",
        userId: intruder.id,
        global: false,
      });
      assert.notEqual(claimed?.id, job.id, "a wake must never claim another tenant's job");
      assert.equal(
        (await prisma.aiJob.findUniqueOrThrow({ where: { id: job.id } })).status,
        "QUEUED",
        "the owner's job must be untouched",
      );
    } finally {
      await prisma.aiJob.deleteMany({ where: { userId: { in: [owner.id, intruder.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [owner.id, intruder.id] } } });
    }
  });

  it("cannot start a queued AI_ANALYZE as a side effect of Run Engine", { skip: !RUN }, async () => {
    const { prisma } = await import("../lib/prisma");
    const { claimJobForCaller } = await import("../lib/job-claim-policy");
    const user = await makeUser("engine-wake-type");

    try {
      const analyze = await prisma.aiJob.create({
        data: { userId: user.id, jobType: "AI_ANALYZE", status: "QUEUED", input: "{}" },
      });

      const claimed = await claimJobForCaller({
        jobType: "ENGINE_RUN",
        userId: user.id,
        global: false,
      });
      assert.notEqual(claimed?.id, analyze.id, "Run Engine's wake must not start AI_ANALYZE");
      assert.equal(
        (await prisma.aiJob.findUniqueOrThrow({ where: { id: analyze.id } })).status,
        "QUEUED",
        "the manual-gated AI_ANALYZE job must remain queued",
      );
    } finally {
      await prisma.aiJob.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
