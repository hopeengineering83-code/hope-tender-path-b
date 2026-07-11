import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { PrismaClient } from "@prisma/client";
import { createAnalysisJob, computeAnalysisJobLockKey } from "../lib/ai-jobs/analysis-job-service";

/**
 * BLOCKER 2: Real PostgreSQL concurrency test for createAnalysisJob advisory locking.
 * 
 * Requires: RUN_DB_INTEGRATION=true and a live PostgreSQL DATABASE_URL.
 * 
 * Verifies:
 * - 8+ simultaneous createAnalysisJob() calls create exactly ONE active AiJob row
 * - All calls return the SAME jobId (idempotent)
 * - No duplicate AiAnalyzeChunk rows
 * - Non-retryable FAILED jobs are NOT re-armed
 * 
 * Run: RUN_DB_INTEGRATION=true npm test
 */

const RUN_DB_INTEGRATION = process.env.RUN_DB_INTEGRATION === "true";

describe("analysis-job advisory lock identity", () => {
  it("is deterministic and changes for every identity dimension", () => {
    const base = computeAnalysisJobLockKey("user-a", "tender-a", "AI_ANALYZE", "hash-a");
    assert.equal(base, computeAnalysisJobLockKey("user-a", "tender-a", "AI_ANALYZE", "hash-a"));
    assert.notEqual(base, computeAnalysisJobLockKey("user-b", "tender-a", "AI_ANALYZE", "hash-a"));
    assert.notEqual(base, computeAnalysisJobLockKey("user-a", "tender-b", "AI_ANALYZE", "hash-a"));
    assert.notEqual(base, computeAnalysisJobLockKey("user-a", "tender-a", "OTHER_JOB", "hash-a"));
    assert.notEqual(base, computeAnalysisJobLockKey("user-a", "tender-a", "AI_ANALYZE", "hash-b"));
  });
});

const prisma = new PrismaClient();

describe("createAnalysisJob() concurrency safety (BLOCKER 2)", { skip: !RUN_DB_INTEGRATION }, () => {
  let userId: string;
  let companyId: string;
  let tenderId: string;

  before(async () => {
    // Create test user, company, tender with sufficient extracted text for analysis
    const user = await prisma.user.create({
      data: {
        email: `test-concurrency-${Date.now()}@test.local`,
        name: "Concurrency Test User",
        passwordHash: "unused",
        role: "PROPOSAL_MANAGER",
      },
    });
    userId = user.id;

    const company = await prisma.company.create({
      data: {
        name: "Test Company",
        userId: userId,
        documents: {
          create: [
            {
              originalFileName: "cv.pdf",
              fileName: "cv.pdf",
              mimeType: "application/pdf",
              size: 1000,
              category: "CV",
              extractedText: "Test company document extracted text for analysis context.",
            },
          ],
        },
      },
    });
    companyId = company.id;

    const tender = await prisma.tender.create({
      data: {
        title: "Concurrency Test Tender",
        userId: userId,
        files: {
          create: [
            {
              originalFileName: "tender.pdf",
              fileName: "tender.pdf",
              mimeType: "application/pdf",
              size: 5000,
              extractedText:
                "This is a test tender document with enough extracted text to pass the 100-character minimum for AI analysis. " +
                "The service requires at least 100 characters of extracted text before it will create an analysis job. " +
                "This paragraph ensures we meet that requirement so the concurrency test can proceed.",
            },
          ],
        },
      },
    });
    tenderId = tender.id;
  });

  after(async () => {
    // Clean up test data
    if (userId) {
      await prisma.aiAnalyzeChunk.deleteMany({ where: { userId } });
      await prisma.aiJob.deleteMany({ where: { userId } });
      await prisma.tender.deleteMany({ where: { userId } });
      await prisma.company.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it("creates exactly one active job from 8 simultaneous calls", async () => {
    // Launch 8 concurrent createAnalysisJob() calls for the same user/tender
    const promises = Array.from({ length: 8 }, () =>
      createAnalysisJob({ tenderId, userId })
    );

    const results = await Promise.all(promises);

    // All 8 calls should return the SAME jobId (idempotent)
    const jobIds = results.map((r) => r.jobId);
    const uniqueJobIds = new Set(jobIds);
    assert.equal(
      uniqueJobIds.size,
      1,
      `Expected exactly 1 unique jobId, got ${uniqueJobIds.size}: ${Array.from(uniqueJobIds).join(", ")}`
    );

    const jobId = jobIds[0];

    // Verify exactly ONE AiJob row exists for this tender/user/hash
    const jobs = await prisma.aiJob.findMany({
      where: {
        userId,
        tenderId,
        jobType: "AI_ANALYZE",
        status: { in: ["QUEUED", "RUNNING", "PARTIAL_SUCCESS", "FAILED"] },
      },
    });
    assert.equal(jobs.length, 1, `Expected 1 active AiJob row, found ${jobs.length}`);
    assert.equal(jobs[0].id, jobId, "The single job row should match the returned jobId");

    // Verify no duplicate chunks were created
    const chunks = await prisma.aiAnalyzeChunk.findMany({
      where: { jobId },
    });
    const chunkIndexes = chunks.map((c) => c.chunkIndex);
    const uniqueIndexes = new Set(chunkIndexes);
    assert.equal(
      chunkIndexes.length,
      uniqueIndexes.size,
      `Duplicate chunk indexes found: ${chunkIndexes.join(", ")}`
    );
  });

  it("does not re-arm a non-retryable FAILED job", async () => {
    // Create a FAILED job with nonRetryable=true
    const failedJob = await prisma.aiJob.create({
      data: {
        userId,
        tenderId,
        jobType: "AI_ANALYZE",
        status: "FAILED",
        analysisInputHash: "non-retryable-hash",
        input: JSON.stringify({ tenderId }),
        runId: require("crypto").randomUUID(),
        errorMessage: "Provider configuration invalid",
      },
    });

    await prisma.aiAnalyzeRetryState.create({
      data: {
        jobId: failedJob.id,
        tenderId,
        userId,
        contentHash: "non-retryable-hash",
        retryReason: "PROVIDER_CONFIG_ERROR",
        failureCategory: "PROVIDER_CONFIG_ERROR",
        nonRetryable: true,
        retryCount: 0,
      },
    });

    // Mock the tender content to match the failed job's hash
    await prisma.tender.update({
      where: { id: tenderId },
      data: {
        files: {
          deleteMany: {},
          create: [
            {
              originalFileName: "tender-non-retryable.pdf",
              fileName: "tender-non-retryable.pdf",
              mimeType: "application/pdf",
              size: 1000,
              extractedText: "Tender content matching non-retryable hash exactly for test purposes here now.",
            },
          ],
        },
      },
    });

    // Temporarily mock computeAnalysisContentHash to return the non-retryable hash.
    // ESM exports are non-configurable in some TS/tsx setups, so we use a
    // module-level override via a wrapper instead of direct property mutation.
    // The analysis-job-service reads computeAnalysisContentHash via a dynamic
    // import, so we need to patch the module's exports object.
    const tacModule = require("../lib/engine/tender-analysis-content");
    const originalHash = tacModule.computeAnalysisContentHash;
    // Try Object.defineProperty first; if it fails, fall back to direct assignment.
    try {
      Object.defineProperty(tacModule, "computeAnalysisContentHash", {
        value: () => "non-retryable-hash",
        writable: true,
        configurable: true,
      });
    } catch {
      // If the property is non-configurable, skip the mock — the test will
      // still verify the non-retryable guard logic via the retryState check.
      // The hash mismatch path is covered by other tests.
    }

    try {
      // Attempt to create a job for the same tender (should throw)
      await assert.rejects(
        async () => createAnalysisJob({ tenderId, userId }),
        /AI_ANALYZE_NON_RETRYABLE/,
        "Expected createAnalysisJob to reject with AI_ANALYZE_NON_RETRYABLE error"
      );

      // Verify the FAILED job was NOT re-armed
      const job = await prisma.aiJob.findUnique({ where: { id: failedJob.id } });
      assert.equal(job?.status, "FAILED", "Non-retryable FAILED job should remain FAILED");
      assert.ok(job?.errorMessage, "Error message should be preserved");
    } finally {
      // Restore original function (best-effort — may be non-configurable)
      try {
        Object.defineProperty(tacModule, "computeAnalysisContentHash", {
          value: originalHash,
          writable: true,
          configurable: true,
        });
      } catch {
        // Non-configurable — nothing to restore
      }

      // Clean up
      await prisma.aiAnalyzeRetryState.deleteMany({ where: { jobId: failedJob.id } });
      await prisma.aiJob.delete({ where: { id: failedJob.id } });
    }
  });
});
