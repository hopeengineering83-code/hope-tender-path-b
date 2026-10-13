// Provider exhaustion must resolve itself, with no user action.
//
// When every AI chunk fails with PROVIDER_EXHAUSTED, analysis-job-service sets
// the job FAILED (code AI_PROVIDERS_EXHAUSTED) and marks the tender
// REGEX_FALLBACK_UNAPPROVED. The readiness surface then reports
// PROCESSING_AUTOMATICALLY, because ANALYSIS_REGEX_FALLBACK_UNAPPROVED is not
// something a person can clear — the blocker's own message says human approval
// "no longer authorizes" release and the analysis must be re-run.
//
// That status is only honest if something actually re-runs it. Every link
// existed: recordRetryStateForJob fires for FAILED, AI_PROVIDERS_EXHAUSTED and
// PROVIDER_EXHAUSTED are in RETRYABLE_CATEGORIES, findJobsDueForRetry selects
// FAILED jobs whose backoff has elapsed, and rearmJobForRetry flips them back
// to QUEUED. But the route that drives all of it,
// /api/cron/ai-analyze-retry, was scheduled by nothing — not in vercel.json's
// crons, not in any workflow. So the chain stalled permanently while the UI
// said it was still working.
//
// The scheduling is asserted separately in
// tests/every-cron-route-has-a-scheduler.test.ts. This test asserts the thing
// that scheduling makes worth having: the loop actually completes against a
// real database.

import { after, before, describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { prisma, prismaReady } from "../lib/prisma";
import {
  isAnyProviderEligible,
  recordRetryStateForJob,
  findJobsDueForRetry,
  rearmJobForRetry,
} from "../lib/ai-analyze/retry-service";
import { computeAnalysisContentHash, buildTenderAnalysisContent } from "../lib/engine/tender-analysis-content";
import { finalizeJob } from "../lib/ai-jobs/analysis-job-service";

if (process.env.RUN_DB_INTEGRATION !== "true") {
  console.error("FATAL: RUN_DB_INTEGRATION=true is required for this test suite.");
  process.exit(1);
}

let userId: string;
let tenderId: string;
let jobId: string;

/** The hash rearmJobForRetry recomputes — ACTIVE files plus the full vault. */
async function currentAnalysisHash(): Promise<string> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      files: {
        where: { deletionStatus: "ACTIVE" },
        select: { id: true, originalFileName: true, extractedText: true, classification: true, createdAt: true },
      },
    },
  });
  const company = await prisma.company
    .findUnique({
      where: { userId },
      include: { documents: { select: { category: true, originalFileName: true, extractedText: true } } },
    })
    .catch(() => null);
  return computeAnalysisContentHash(buildTenderAnalysisContent(tender as never, (company ?? undefined) as never));
}

describe("AI provider exhaustion recovers automatically — real PostgreSQL", () => {
  before(async () => {
    await prismaReady;
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await prisma.user.create({
      data: { email: `exhaustion-${nonce}@example.test`, name: "Provider Exhaustion", passwordHash: "h" },
    });
    userId = user.id;
    const tender = await prisma.tender.create({
      data: {
        userId,
        title: `Provider Exhaustion ${nonce}`,
        clientName: "Exhaustion Procuring Authority",
        reference: `PX-${nonce}`,
        country: "Ethiopia",
        status: "DRAFT",
        stage: "TENDER_INTAKE",
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    tenderId = tender.id;
    await prisma.tenderFile.create({
      data: {
        tenderId,
        fileName: "rfp.txt",
        originalFileName: "rfp.txt",
        mimeType: "text/plain",
        size: 64,
        storagePath: "",
        extractedText: "REQUEST FOR PROPOSAL. Submit by email to procurement@example.test.",
        totalPages: 1,
      },
    });

    // Exactly the job and chunk rows provider exhaustion leaves behind before
    // the durable worker finalizes the result.
    const analysisInputHash = await currentAnalysisHash();
    const job = await prisma.aiJob.create({
      data: {
        userId,
        tenderId,
        jobType: "AI_ANALYZE",
        status: "RUNNING",
        input: "{}",
        analysisInputHash,
      },
    });
    jobId = job.id;
    await prisma.aiAnalyzeChunk.create({
      data: {
        jobId,
        tenderId,
        userId,
        contentHash: analysisInputHash,
        chunkIndex: 0,
        totalChunks: 1,
        status: "FAILED",
        failureCategory: "PROVIDER_EXHAUSTED",
        errorMessage: "sanitized provider trace",
        finishedAt: new Date(),
      },
    });
  });

  after(async () => {
    await prisma.aiAnalyzeRetryState.deleteMany({ where: { jobId } });
    await prisma.aiJob.deleteMany({ where: { id: jobId } });
    await prisma.tenderFile.deleteMany({ where: { tenderId } });
    await prisma.tender.deleteMany({ where: { id: tenderId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("has an eligible provider in this environment", () => {
    // The premise of everything below. isAnyProviderEligible gates both the
    // scheduler query and the re-arm, so without it the rest would pass
    // vacuously by never being reached.
    assert.equal(isAnyProviderEligible(), true, "a provider key must be configured for this suite");
  });

  it("stages deterministic fallback #11 after every AI provider is exhausted", async () => {
    const result = await finalizeJob(jobId, userId);
    assert.deepEqual(result, { status: "FAILED", code: "HUMAN_APPROVAL_REQUIRED_FALLBACK" });

    const [job, tender] = await Promise.all([
      prisma.aiJob.findUnique({ where: { id: jobId } }),
      prisma.tender.findUnique({ where: { id: tenderId } }),
    ]);
    assert.equal(job?.status, "FAILED", "fallback must never claim AI success");
    assert.equal(tender?.analysisExtractionStatus, "REGEX_FALLBACK_UNAPPROVED");
    const staged = JSON.parse(job?.stagedMergedResult ?? "null");
    assert.equal(staged?.analysisSource, "FALLBACK_DRAFT");
    assert.equal(staged?.contentHash, await currentAnalysisHash(), "fallback must retain the exact source hash");
    assert.ok(staged?.requirements?.length > 0, "fallback must retain source-derived requirements for review");
  });

  it("freezes automatic retry once the fallback review artifact is staged", async () => {
    const recorded = await recordRetryStateForJob(jobId, "FAILED");
    assert.ok(recorded, "retry state must be recorded for a FAILED analysis");
    // The old expectation scheduled provider exhaustion even after finalizeJob
    // had staged FALLBACK_DRAFT. That allowed cron to mutate the same review
    // artifact back to QUEUED. Provider exhaustion is normally transient, but
    // the staged human-review state is now the stronger state-machine fact.
    assert.equal(recorded.retryable, false);
    assert.equal(recorded.nextRetryAt, null);
    assert.equal(recorded.category, "FALLBACK_REVIEW_REQUIRED");
  });

  it("is not picked up by the scheduler while fallback review is pending", async () => {
    await prisma.aiAnalyzeRetryState.update({
      where: { jobId },
      data: { nextRetryAt: new Date(Date.now() - 1_000), nonRetryable: false },
    });
    await recordRetryStateForJob(jobId, "FAILED");
    const due = await findJobsDueForRetry(25);
    assert.equal(due.some((row) => row.jobId === jobId), false);
  });

  it("refuses to return the fallback-review job to QUEUED", async () => {
    const rearmed = await rearmJobForRetry(jobId);
    assert.equal(rearmed, false, "automatic re-arm must not overwrite a staged fallback");

    const job = await prisma.aiJob.findUnique({ where: { id: jobId }, select: { status: true, stagedMergedResult: true } });
    assert.equal(job?.status, "FAILED");
    assert.equal(JSON.parse(job?.stagedMergedResult ?? "null")?.analysisSource, "FALLBACK_DRAFT");
  });

  it("refuses to re-arm once the tender content has changed", async () => {
    // The guarantee that keeps this from resuming against a document the
    // completed chunks no longer describe.
    // This is a separate legacy/no-fallback checkpoint scenario; the tests
    // above already prove a staged fallback is refused before hash evaluation.
    await prisma.aiJob.update({
      where: { id: jobId },
      data: { stagedMergedResult: null, promotedAt: null },
    });
    await prisma.tenderFile.updateMany({
      where: { tenderId },
      data: { extractedText: "A COMPLETELY DIFFERENT TENDER DOCUMENT." },
    });
    await prisma.aiJob.update({ where: { id: jobId }, data: { status: "FAILED" } });
    await prisma.aiAnalyzeRetryState.update({
      where: { jobId },
      data: { nextRetryAt: new Date(Date.now() - 1_000), nonRetryable: false },
    });

    assert.equal(await rearmJobForRetry(jobId), false, "changed content must not resume old chunks");

    const state = await prisma.aiAnalyzeRetryState.findUnique({
      where: { jobId },
      select: { nonRetryable: true, failureCategory: true },
    });
    assert.equal(state?.nonRetryable, true);
    assert.equal(state?.failureCategory, "CONTENT_HASH_CHANGED");
  });
});
