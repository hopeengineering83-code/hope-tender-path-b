// Behavioral DB tests: worker reliability, tenant isolation, concurrency (evidence B)
//
// These tests run in CI with RUN_DB_INTEGRATION=true on ephemeral PostgreSQL.
// They provide evidence level B for Categories 4, 5, and 6.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

const RUN = process.env.RUN_DB_INTEGRATION === "true";

describe("Behavioral DB: worker transient retry (Category 4)", { skip: !RUN }, () => {
  it("transient retry error does not leave job permanently RUNNING", async () => {
    const { prisma } = await import("../lib/prisma");
    const bcrypt = (await import("bcryptjs")).default;

    const email = `retry-${Date.now()}@example.test`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash("Retry-password-2026!", 10), role: "ADMIN", name: "Retry Test" },
    });

    try {
      // Create a RUNNING job (simulating a worker that was killed mid-execution)
      const job = await prisma.aiJob.create({
        data: {
          userId: user.id,
          jobType: "ENGINE_RUN",
          status: "RUNNING",
          startedAt: new Date(Date.now() - 300_000), // 5 minutes ago
          input: JSON.stringify({ tenderId: null, retryCount: 0 }),
        },
      });

      // Verify the job is RUNNING
      const running = await prisma.aiJob.findUnique({ where: { id: job.id } });
      assert.equal(running?.status, "RUNNING");

      // Call failStuckJobs — it should mark the job as FAILED
      const { failStuckJobs } = await import("../lib/ai-jobs");
      const result = await failStuckJobs();
      assert.ok(result.recovered >= 0, "failStuckJobs should return a result");

      // The job should no longer be RUNNING (it should be FAILED)
      const after = await prisma.aiJob.findUnique({ where: { id: job.id } });
      assert.notEqual(after?.status, "RUNNING", "Stuck RUNNING job must be recovered by failStuckJobs");
      assert.match(after?.status ?? "", /FAILED|SUCCEEDED/, "Recovered job should be FAILED or SUCCEEDED");
    } finally {
      await prisma.aiJob.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("claimJobForCaller only claims QUEUED jobs, not RUNNING or terminal", async () => {
    const { prisma } = await import("../lib/prisma");
    const { claimJobForCaller } = await import("../lib/job-claim-policy");
    const bcrypt = (await import("bcryptjs")).default;

    const email = `claim-${Date.now()}@example.test`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash("Claim-password-2026!", 10), role: "ADMIN", name: "Claim Test" },
    });

    try {
      // Create jobs in various states
      await prisma.aiJob.create({
        data: { userId: user.id, jobType: "AI_ANALYZE", status: "QUEUED", input: "{}" },
      });
      await prisma.aiJob.create({
        data: { userId: user.id, jobType: "AI_ANALYZE", status: "RUNNING", startedAt: new Date(), input: "{}" },
      });
      await prisma.aiJob.create({
        data: { userId: user.id, jobType: "AI_ANALYZE", status: "SUCCEEDED", finishedAt: new Date(), input: "{}" },
      });
      await prisma.aiJob.create({
        data: { userId: user.id, jobType: "AI_ANALYZE", status: "FAILED", finishedAt: new Date(), input: "{}" },
      });

      // Claim should only return the QUEUED job
      const claimed = await claimJobForCaller({
        jobType: "AI_ANALYZE" as any,
        userId: user.id,
        global: false,
      });

      assert.ok(claimed, "Should claim the QUEUED job");
      // claimed job has been transitioned to RUNNING by the UPDATE in claimJobForCaller

      // Try to claim again — should return null (no more QUEUED jobs)
      const claimed2 = await claimJobForCaller({
        jobType: "AI_ANALYZE" as any,
        userId: user.id,
        global: false,
      });
      assert.equal(claimed2, null, "Should not claim RUNNING/SUCCEEDED/FAILED jobs");
    } finally {
      await prisma.aiJob.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("terminal jobs (SUCCEEDED/FAILED) are never re-claimed", async () => {
    const { prisma } = await import("../lib/prisma");
    const { claimJobForCaller } = await import("../lib/job-claim-policy");
    const bcrypt = (await import("bcryptjs")).default;

    const email = `terminal-${Date.now()}@example.test`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash("Terminal-password-2026!", 10), role: "ADMIN", name: "Terminal Test" },
    });

    try {
      // Create only terminal jobs (no QUEUED)
      await prisma.aiJob.create({
        data: { userId: user.id, jobType: "AI_ANALYZE", status: "SUCCEEDED", finishedAt: new Date(), input: "{}" },
      });
      await prisma.aiJob.create({
        data: { userId: user.id, jobType: "AI_ANALYZE", status: "FAILED", finishedAt: new Date(), input: "{}" },
      });

      const claimed = await claimJobForCaller({
        jobType: "AI_ANALYZE" as any,
        userId: user.id,
        global: false,
      });

      assert.equal(claimed, null, "Terminal jobs must never be claimed");
    } finally {
      await prisma.aiJob.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});

describe("Behavioral DB: tenant isolation (Category 5)", { skip: !RUN }, () => {
  it("user A cannot claim user B's QUEUED job", async () => {
    const { prisma } = await import("../lib/prisma");
    const { claimJobForCaller } = await import("../lib/job-claim-policy");
    const bcrypt = (await import("bcryptjs")).default;

    const emailA = `tenantA-${Date.now()}@example.test`;
    const emailB = `tenantB-${Date.now()}@example.test`;
    const userA = await prisma.user.create({
      data: { email: emailA, passwordHash: await bcrypt.hash("TenantA-password-2026!", 10), role: "ADMIN", name: "Tenant A" },
    });
    const userB = await prisma.user.create({
      data: { email: emailB, passwordHash: await bcrypt.hash("TenantB-password-2026!", 10), role: "ADMIN", name: "Tenant B" },
    });

    try {
      // User B creates a QUEUED job
      await prisma.aiJob.create({
        data: { userId: userB.id, jobType: "AI_ANALYZE", status: "QUEUED", input: "{}" },
      });

      // User A tries to claim it — should not get user B's job
      const claimed = await claimJobForCaller({
        jobType: "AI_ANALYZE" as any,
        userId: userA.id,
        global: false,
      });

      assert.equal(claimed, null, "User A must not claim User B's job (tenant isolation)");
    } finally {
      await prisma.aiJob.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    }
  });

  it("createAnalysisJob rejects tender owned by another user", async () => {
    const { prisma } = await import("../lib/prisma");
    const { createAnalysisJob } = await import("../lib/ai-jobs/analysis-job-service");
    const bcrypt = (await import("bcryptjs")).default;

    const emailA = `crossA-${Date.now()}@example.test`;
    const emailB = `crossB-${Date.now()}@example.test`;
    const userA = await prisma.user.create({
      data: { email: emailA, passwordHash: await bcrypt.hash("CrossA-password-2026!", 10), role: "ADMIN", name: "Cross A" },
    });
    const userB = await prisma.user.create({
      data: { email: emailB, passwordHash: await bcrypt.hash("CrossB-password-2026!", 10), role: "ADMIN", name: "Cross B" },
    });
    const tenderB = await prisma.tender.create({
      data: { userId: userB.id, title: "User B's Tender" },
    });

    try {
      // User A tries to analyze User B's tender
      await assert.rejects(
        () => createAnalysisJob({
          tenderId: tenderB.id,
          userId: userA.id,
          manualAuthority: {
            source: "manual-ai-analyze",
            actorUserId: userA.id,
            authorizedAt: new Date().toISOString(),
          },
        }),
        /Tender not found or access denied/,
        "User A must not be able to analyze User B's tender (cross-tenant access denied)",
      );
    } finally {
      await prisma.tender.deleteMany({ where: { userId: userB.id } });
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    }
  });
});

describe("Behavioral DB: concurrent analysis idempotency (Category 6)", { skip: !RUN }, () => {
  it("concurrent createAnalysisJob calls return the same job (idempotent)", async () => {
    const { prisma } = await import("../lib/prisma");
    const { createAnalysisJob } = await import("../lib/ai-jobs/analysis-job-service");
    const bcrypt = (await import("bcryptjs")).default;

    const email = `conc-${Date.now()}@example.test`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash("Conc-password-2026!", 10), role: "ADMIN", name: "Conc Test" },
    });
    const company = await prisma.company.create({
      data: { userId: user.id, name: "Conc Co", legalName: "Conc Co", setupCompletedAt: new Date() },
    });
    const tender = await prisma.tender.create({
      data: {
        userId: user.id,
        title: "Concurrent Test Tender",
        files: {
          create: [{
            originalFileName: "conc.pdf",
            fileName: "conc.pdf",
            mimeType: "text/plain",
            size: 5000,
            extractedText: "Concurrent analysis idempotency test content that is long enough to pass the 100-character minimum. " +
              "This text ensures the createAnalysisJob function will not reject the tender for being too short.",
            deletionStatus: "ACTIVE",
            contentSha256: "d".repeat(64),
            integrityStatus: "VERIFIED",
            extractionScore: 90,
            extractionMethod: "text",
          }],
        },
      },
    });

    try {
      const authority = {
        source: "manual-ai-analyze" as const,
        actorUserId: user.id,
        authorizedAt: new Date().toISOString(),
      };

      // Launch 3 concurrent createAnalysisJob calls
      const results = await Promise.all([
        createAnalysisJob({ tenderId: tender.id, userId: user.id, manualAuthority: authority }),
        createAnalysisJob({ tenderId: tender.id, userId: user.id, manualAuthority: authority }),
        createAnalysisJob({ tenderId: tender.id, userId: user.id, manualAuthority: authority }),
      ]);

      // EXACTLY one. The business invariant is one authoritative active
      // AI_ANALYZE job per (userId, tenderId, jobType, analysisInputHash), so
      // the only correct result is 1.
      //
      // This assertion previously accepted "1 or 2", excused by "concurrent
      // calls may interleave between lock acquire and recheck". That reasoning
      // is wrong: pg_advisory_xact_lock is held for the whole transaction, so a
      // waiting caller only proceeds after the holder COMMITS, and its recheck
      // (READ COMMITTED) therefore sees the committed row. A result of 2 is a
      // real defect, and the old assertion would have passed straight through
      // it. Measured against this implementation at 3, 10 and 25 concurrent
      // callers: always exactly 1.
      const jobIds = results.map((r) => r.jobId);
      const uniqueJobIds = new Set(jobIds);
      assert.equal(
        uniqueJobIds.size,
        1,
        `Concurrent createAnalysisJob calls must converge to exactly 1 job (got ${uniqueJobIds.size})`,
      );

      // Returned ids agreeing is not sufficient — assert the actual row count,
      // which is what a duplicate-creation regression would show up in.
      const rowCount = await prisma.aiJob.count({
        where: { tenderId: tender.id, userId: user.id, jobType: "AI_ANALYZE" },
      });
      assert.equal(rowCount, 1, `exactly one AiJob row must exist (got ${rowCount})`);
    } finally {
      await prisma.aiAnalyzeChunk.deleteMany({ where: { userId: user.id } });
      await prisma.aiJob.deleteMany({ where: { userId: user.id } });
      await prisma.tenderFile.deleteMany({ where: { tenderId: tender.id } });
      await prisma.tender.deleteMany({ where: { userId: user.id } });
      await prisma.company.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  // High-concurrency proof. Three callers can pass by luck; 10 and 25 exercise
  // real advisory-lock queueing across separate connections from the Prisma
  // pool. Exact row counts only — a "1 or 2" style tolerance here would defeat
  // the purpose of the test.
  for (const concurrency of [10, 25]) {
    it(`${concurrency} concurrent createAnalysisJob calls create exactly one job`, async () => {
      const { prisma } = await import("../lib/prisma");
      const { createAnalysisJob } = await import("../lib/ai-jobs/analysis-job-service");
      const bcrypt = (await import("bcryptjs")).default;

      const user = await prisma.user.create({
        data: {
          email: `conc${concurrency}-${Date.now()}@example.test`,
          passwordHash: await bcrypt.hash("Conc-password-2026!", 10),
          role: "ADMIN",
          name: "Conc Test",
        },
      });
      await prisma.company.create({
        data: { userId: user.id, name: "Conc Co", legalName: "Conc Co", setupCompletedAt: new Date() },
      });
      const tender = await prisma.tender.create({
        data: {
          userId: user.id,
          title: `Concurrent Test Tender ${concurrency}`,
          files: {
            create: [{
              originalFileName: "conc.pdf",
              fileName: "conc.pdf",
              mimeType: "text/plain",
              size: 5000,
              extractedText:
                "Concurrent analysis idempotency test content that is long enough to pass the 100-character minimum. " +
                "This text ensures the createAnalysisJob function will not reject the tender for being too short.",
              deletionStatus: "ACTIVE",
              contentSha256: "d".repeat(64),
              integrityStatus: "VERIFIED",
              extractionScore: 90,
              extractionMethod: "text",
            }],
          },
        },
      });

      try {
        const authority = {
          source: "manual-ai-analyze" as const,
          actorUserId: user.id,
          authorizedAt: new Date().toISOString(),
        };

        const settled = await Promise.allSettled(
          Array.from({ length: concurrency }, () =>
            createAnalysisJob({ tenderId: tender.id, userId: user.id, manualAuthority: authority }),
          ),
        );

        const rejected = settled.filter((r) => r.status === "rejected");
        assert.equal(
          rejected.length,
          0,
          `no caller may fail: ${rejected.map((r: any) => r.reason?.message).join("; ")}`,
        );

        const uniqueJobIds = new Set(
          settled.map((r) => (r as PromiseFulfilledResult<{ jobId: string }>).value.jobId),
        );
        assert.equal(
          uniqueJobIds.size,
          1,
          `${concurrency} concurrent callers must all receive the same jobId (got ${uniqueJobIds.size})`,
        );

        const rowCount = await prisma.aiJob.count({
          where: { tenderId: tender.id, userId: user.id, jobType: "AI_ANALYZE" },
        });
        assert.equal(rowCount, 1, `exactly one AiJob row must exist (got ${rowCount})`);

        // Chunk checkpoints are keyed by (tenderId,userId,contentHash,chunkIndex)
        // and upserted per caller — duplicates would corrupt resume accounting.
        const chunkRows = await prisma.aiAnalyzeChunk.findMany({
          where: { tenderId: tender.id, userId: user.id },
          select: { chunkIndex: true },
        });
        assert.equal(
          new Set(chunkRows.map((c) => c.chunkIndex)).size,
          chunkRows.length,
          "chunk checkpoints must not be duplicated by concurrent creation",
        );
      } finally {
        await prisma.aiAnalyzeChunk.deleteMany({ where: { userId: user.id } });
        await prisma.aiJob.deleteMany({ where: { userId: user.id } });
        await prisma.tenderFile.deleteMany({ where: { tenderId: tender.id } });
        await prisma.tender.deleteMany({ where: { userId: user.id } });
        await prisma.company.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    });
  }
});
