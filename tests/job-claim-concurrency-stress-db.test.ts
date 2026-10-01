// Stress evidence for the durable job queue's exactly-once claim.
//
// tests/engine-worker-wake-constraints.test.ts proves the wake-vs-cron race at
// small scale for ENGINE_RUN. This file is the queue-level counterpart: it
// pushes claimJobForCaller() at 2, 10 and 25 concurrent callers, mixes global
// (cron) and tenant-scoped (request wake) callers, and crosses tenants,
// tenders, job types and backoff windows — the conditions a single deployment
// actually sees when a cron sweep lands while owners are clicking.
//
// Every claim here is pinned to a tender this file created. `global: true` is
// deliberately NOT user-scoped: it takes the oldest claimable row in the whole
// table, so an unpinned global claim in a test suite steals queued jobs from
// whatever else the runner is executing concurrently. That already happened
// once on this branch. Pinning by tenderId keeps the real global code path
// under test while making the candidate row set exclusively ours.

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";

const RUN = process.env.RUN_DB_INTEGRATION === "true";

type Ctx = {
  userA: { id: string };
  userB: { id: string };
  tenderA1: { id: string };
  tenderA2: { id: string };
  tenderB1: { id: string };
};

let ctx: Ctx | null = null;

async function db() {
  const { prisma } = await import("../lib/prisma");
  return prisma;
}

async function makeUser(tag: string) {
  const prisma = await db();
  return prisma.user.create({
    data: {
      email: `claimstress-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      name: `claim stress ${tag}`,
      passwordHash: "unused",
      role: "PROPOSAL_MANAGER",
    },
  });
}

async function queueJobs(opts: {
  userId: string;
  tenderId: string;
  count: number;
  jobType?: "ENGINE_RUN" | "AI_ANALYZE";
  nextAttemptAt?: Date | null;
}) {
  const prisma = await db();
  const ids: string[] = [];
  for (let i = 0; i < opts.count; i += 1) {
    const job = await prisma.aiJob.create({
      data: {
        userId: opts.userId,
        tenderId: opts.tenderId,
        jobType: opts.jobType ?? "ENGINE_RUN",
        status: "QUEUED",
        input: JSON.stringify({ manualRequested: true, seq: i }),
        ...(opts.nextAttemptAt !== undefined ? { nextAttemptAt: opts.nextAttemptAt } : {}),
      },
    });
    ids.push(job.id);
  }
  return ids;
}

async function clearJobs(tenderIds: string[]) {
  const prisma = await db();
  await prisma.aiJob.deleteMany({ where: { tenderId: { in: tenderIds } } });
}

before(async () => {
  if (!RUN) return;
  const prisma = await db();
  const userA = await makeUser("tenant-a");
  const userB = await makeUser("tenant-b");
  const tenderA1 = await prisma.tender.create({
    data: { userId: userA.id, title: `claim stress A1 ${Date.now()}` },
  });
  const tenderA2 = await prisma.tender.create({
    data: { userId: userA.id, title: `claim stress A2 ${Date.now()}` },
  });
  const tenderB1 = await prisma.tender.create({
    data: { userId: userB.id, title: `claim stress B1 ${Date.now()}` },
  });
  ctx = { userA, userB, tenderA1, tenderA2, tenderB1 };
});

after(async () => {
  if (!RUN || !ctx) return;
  const prisma = await db();
  const userIds = [ctx.userA.id, ctx.userB.id];
  await prisma.aiJob.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.tender.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  ctx = null;
});

describe("job claim — exactly-once under concurrency", () => {
  for (const concurrency of [2, 10, 25]) {
    it(`yields exactly one winner for one job at ${concurrency} concurrent claimers`, { skip: !RUN }, async () => {
      const c = ctx!;
      const { claimJobForCaller } = await import("../lib/job-claim-policy");
      const prisma = await db();
      const [jobId] = await queueJobs({ userId: c.userA.id, tenderId: c.tenderA1.id, count: 1 });

      try {
        const claims = await Promise.all(
          Array.from({ length: concurrency }, (_, i) =>
            // Alternate the two real callers: the cron (global, unscoped by
            // user) and the request-scoped wake (tenant-scoped).
            i % 2 === 0
              ? claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: c.tenderA1.id, global: true })
              : claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: c.tenderA1.id, userId: c.userA.id, global: false })),
        );

        const winners = claims.filter((claim) => claim && claim.id === jobId);
        assert.equal(winners.length, 1, `exactly one of ${concurrency} claimers may win, got ${winners.length}`);
        assert.equal(
          claims.filter(Boolean).length,
          1,
          "no claimer may return a job other than the single queued row",
        );
        assert.equal((await prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } })).status, "RUNNING");
      } finally {
        await clearJobs([c.tenderA1.id]);
      }
    });
  }

  it("claims every job exactly once when 25 callers race 25 jobs", { skip: !RUN }, async () => {
    const c = ctx!;
    const { claimJobForCaller } = await import("../lib/job-claim-policy");
    const prisma = await db();
    const jobIds = await queueJobs({ userId: c.userA.id, tenderId: c.tenderA1.id, count: 25 });

    try {
      const claims = await Promise.all(
        Array.from({ length: 25 }, (_, i) =>
          i % 2 === 0
            ? claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: c.tenderA1.id, global: true })
            : claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: c.tenderA1.id, userId: c.userA.id, global: false })),
      );

      const claimedIds = claims.filter(Boolean).map((claim) => claim!.id);
      assert.equal(new Set(claimedIds).size, claimedIds.length, "no job may be handed to two callers");
      assert.equal(claimedIds.length, 25, "SKIP LOCKED must not starve callers when enough rows exist");
      assert.deepEqual(new Set(claimedIds), new Set(jobIds), "claimers must stay inside the seeded row set");

      const stillQueued = await prisma.aiJob.count({
        where: { tenderId: c.tenderA1.id, status: "QUEUED" },
      });
      assert.equal(stillQueued, 0, "every seeded job must have been claimed");
    } finally {
      await clearJobs([c.tenderA1.id]);
    }
  });

  it("hands the oldest queued job out first", { skip: !RUN }, async () => {
    const c = ctx!;
    const { claimJobForCaller } = await import("../lib/job-claim-policy");
    const prisma = await db();
    const jobIds = await queueJobs({ userId: c.userA.id, tenderId: c.tenderA1.id, count: 3 });
    // createdAt defaults can collide within a millisecond; make the order explicit.
    await prisma.aiJob.update({ where: { id: jobIds[0] }, data: { createdAt: new Date(Date.now() - 60_000) } });
    await prisma.aiJob.update({ where: { id: jobIds[1] }, data: { createdAt: new Date(Date.now() - 30_000) } });
    await prisma.aiJob.update({ where: { id: jobIds[2] }, data: { createdAt: new Date() } });

    try {
      const first = await claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: c.tenderA1.id, global: true });
      const second = await claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: c.tenderA1.id, global: true });
      assert.equal(first?.id, jobIds[0], "FIFO: the oldest row must be claimed first");
      assert.equal(second?.id, jobIds[1], "FIFO: the next-oldest row must follow");
    } finally {
      await clearJobs([c.tenderA1.id]);
    }
  });
});

describe("job claim — tenancy and scope hold under contention", () => {
  it("never lets one tenant's worker claim another tenant's job", { skip: !RUN }, async () => {
    const c = ctx!;
    const { claimJobForCaller } = await import("../lib/job-claim-policy");
    const prisma = await db();
    const [jobA] = await queueJobs({ userId: c.userA.id, tenderId: c.tenderA1.id, count: 1 });
    const [jobB] = await queueJobs({ userId: c.userB.id, tenderId: c.tenderB1.id, count: 1 });

    try {
      // Both tenants' request-scoped wakes fire at the same instant, each
      // unaware of the other. Neither may reach across.
      const claims = await Promise.all([
        ...Array.from({ length: 10 }, () =>
          claimJobForCaller({ jobType: "ENGINE_RUN", userId: c.userA.id, global: false, tenderId: c.tenderA1.id })),
        ...Array.from({ length: 10 }, () =>
          claimJobForCaller({ jobType: "ENGINE_RUN", userId: c.userB.id, global: false, tenderId: c.tenderB1.id })),
      ]);

      const aWinners = claims.filter((claim) => claim?.id === jobA);
      const bWinners = claims.filter((claim) => claim?.id === jobB);
      assert.equal(aWinners.length, 1, "tenant A's job claimed exactly once");
      assert.equal(bWinners.length, 1, "tenant B's job claimed exactly once");
      for (const claim of claims) {
        if (!claim) continue;
        const expectedOwner = claim.id === jobA ? c.userA.id : c.userB.id;
        assert.equal(claim.userId, expectedOwner, "a claim must carry its own tenant's ownership");
      }
      assert.equal((await prisma.aiJob.findUniqueOrThrow({ where: { id: jobA } })).userId, c.userA.id);
      assert.equal((await prisma.aiJob.findUniqueOrThrow({ where: { id: jobB } })).userId, c.userB.id);
    } finally {
      await clearJobs([c.tenderA1.id, c.tenderB1.id]);
    }
  });

  it("cannot cross tenders inside a single tenant", { skip: !RUN }, async () => {
    const c = ctx!;
    const { claimJobForCaller } = await import("../lib/job-claim-policy");
    const prisma = await db();
    const [jobT1] = await queueJobs({ userId: c.userA.id, tenderId: c.tenderA1.id, count: 1 });
    const [jobT2] = await queueJobs({ userId: c.userA.id, tenderId: c.tenderA2.id, count: 1 });

    try {
      const claims = await Promise.all(
        Array.from({ length: 10 }, () =>
          claimJobForCaller({ jobType: "ENGINE_RUN", userId: c.userA.id, tenderId: c.tenderA2.id, global: false })),
      );
      assert.equal(claims.filter((claim) => claim?.id === jobT2).length, 1, "the requested tender's job is claimed once");
      assert.equal(claims.filter((claim) => claim?.id === jobT1).length, 0, "a tender-scoped wake must not touch a sibling tender");
      assert.equal(
        (await prisma.aiJob.findUniqueOrThrow({ where: { id: jobT1 } })).status,
        "QUEUED",
        "the sibling tender's job stays queued",
      );
    } finally {
      await clearJobs([c.tenderA1.id, c.tenderA2.id]);
    }
  });

  it("cannot claim a different job type under contention", { skip: !RUN }, async () => {
    const c = ctx!;
    const { claimJobForCaller } = await import("../lib/job-claim-policy");
    const prisma = await db();
    const [analyze] = await queueJobs({
      userId: c.userA.id,
      tenderId: c.tenderA1.id,
      count: 1,
      jobType: "AI_ANALYZE",
    });

    try {
      const claims = await Promise.all(
        Array.from({ length: 10 }, () =>
          claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: c.tenderA1.id, global: true })),
      );
      assert.equal(claims.filter(Boolean).length, 0, "no ENGINE_RUN caller may claim an AI_ANALYZE row");
      assert.equal(
        (await prisma.aiJob.findUniqueOrThrow({ where: { id: analyze } })).status,
        "QUEUED",
        "the manual-gated AI_ANALYZE job must remain queued",
      );
    } finally {
      await clearJobs([c.tenderA1.id]);
    }
  });

  it("refuses to claim anything for a non-global caller with no tenant", { skip: !RUN }, async () => {
    const c = ctx!;
    const { claimJobForCaller } = await import("../lib/job-claim-policy");
    const prisma = await db();
    const [jobId] = await queueJobs({ userId: c.userA.id, tenderId: c.tenderA1.id, count: 1 });

    try {
      const claimed = await claimJobForCaller({ jobType: "ENGINE_RUN", global: false });
      assert.equal(claimed, null, "an unidentified non-global caller must fail closed");
      assert.equal((await prisma.aiJob.findUniqueOrThrow({ where: { id: jobId } })).status, "QUEUED");
    } finally {
      await clearJobs([c.tenderA1.id]);
    }
  });
});

describe("job claim — backoff windows survive a stampede", () => {
  it("leaves a re-armed job alone until its nextAttemptAt elapses", { skip: !RUN }, async () => {
    const c = ctx!;
    const { claimJobForCaller } = await import("../lib/job-claim-policy");
    const prisma = await db();
    const [future] = await queueJobs({
      userId: c.userA.id,
      tenderId: c.tenderA1.id,
      count: 1,
      nextAttemptAt: new Date(Date.now() + 10 * 60_000),
    });

    try {
      const claims = await Promise.all(
        Array.from({ length: 25 }, () =>
          claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: c.tenderA1.id, global: true })),
      );
      assert.equal(claims.filter(Boolean).length, 0, "backoff must hold against 25 concurrent claimers");
      assert.equal((await prisma.aiJob.findUniqueOrThrow({ where: { id: future } })).status, "QUEUED");
    } finally {
      await clearJobs([c.tenderA1.id]);
    }
  });

  it("claims a job whose backoff has already elapsed, exactly once", { skip: !RUN }, async () => {
    const c = ctx!;
    const { claimJobForCaller } = await import("../lib/job-claim-policy");
    const [due] = await queueJobs({
      userId: c.userA.id,
      tenderId: c.tenderA1.id,
      count: 1,
      nextAttemptAt: new Date(Date.now() - 60_000),
    });

    try {
      const claims = await Promise.all(
        Array.from({ length: 25 }, () =>
          claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: c.tenderA1.id, global: true })),
      );
      assert.equal(claims.filter((claim) => claim?.id === due).length, 1, "an elapsed backoff is claimable exactly once");
    } finally {
      await clearJobs([c.tenderA1.id]);
    }
  });

  it("mixes due and not-yet-due rows without leaking the not-yet-due one", { skip: !RUN }, async () => {
    const c = ctx!;
    const { claimJobForCaller } = await import("../lib/job-claim-policy");
    const prisma = await db();
    const [due] = await queueJobs({
      userId: c.userA.id,
      tenderId: c.tenderA1.id,
      count: 1,
      nextAttemptAt: new Date(Date.now() - 60_000),
    });
    const [held] = await queueJobs({
      userId: c.userA.id,
      tenderId: c.tenderA1.id,
      count: 1,
      nextAttemptAt: new Date(Date.now() + 10 * 60_000),
    });

    try {
      const claims = await Promise.all(
        Array.from({ length: 25 }, () =>
          claimJobForCaller({ jobType: "ENGINE_RUN", tenderId: c.tenderA1.id, global: true })),
      );
      assert.equal(claims.filter(Boolean).length, 1, "only the due row is claimable");
      assert.equal(claims.find(Boolean)?.id, due);
      assert.equal(
        (await prisma.aiJob.findUniqueOrThrow({ where: { id: held } })).status,
        "QUEUED",
        "the held row must not be dragged out by the stampede",
      );
    } finally {
      await clearJobs([c.tenderA1.id]);
    }
  });
});
