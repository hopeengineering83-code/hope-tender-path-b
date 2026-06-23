/**
 * Background enqueue for AI Analyze — the single durable entry point.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The user-facing "Run AI Analyze" button used to POST directly to the
 * SSE route (/api/tenders/[id]/ai-analyze with Accept: text/event-stream).
 * That route is bounded by Vercel Hobby's 60 s execution cap and runs
 * inside the request/response cycle — it is NOT a durable worker path.
 * Large tenders hit the cap mid-analysis and the work is lost.
 *
 * This module is the durable replacement. It:
 *   1. Verifies the caller is ADMIN or PROPOSAL_MANAGER (done by the route,
 *      but we re-assert ownership here so the helper is safe to call).
 *   2. Validates extraction quality BEFORE enqueueing — corrupted or
 *      missing extraction is rejected with HTTP 422 so the user is told
 *      to OCR / re-upload instead of waiting for an inevitable failure.
 *   3. Creates one durable AI_ANALYZE job via createAnalysisJob().
 *   4. Returns HTTP 202 Accepted with { jobId, status: "QUEUED" }.
 *
 * After the route returns 202, the caller (AIAnalyzePanel) triggers
 * /api/ai-jobs/run-next?jobType=AI_ANALYZE with the authenticated
 * session to start the worker immediately. GitHub Actions / Vercel cron
 * remain as recovery support only.
 */

import { NextResponse } from "next/server";
import { prisma } from "../prisma";
import { createAnalysisJob } from "../ai-jobs/analysis-job-service";
import { assessExtractionQuality } from "../extraction-quality";

export interface BackgroundEnqueueResult {
  jobId: string;
  status: "QUEUED";
  totalChunks: number;
}

/**
 * Enqueue a durable AI_ANALYZE job for the given tender.
 *
 * The caller MUST have already authenticated (requireRole) and passed
 * the authenticated userId. This function performs:
 *   - tender ownership verification (findFirst by id + userId)
 *   - extraction-quality gate (corrupted → 422)
 *   - job creation via createAnalysisJob
 *
 * Returns a NextResponse suitable for direct return from a route handler:
 *   - 404 if the tender is not found or not owned by the user
 *   - 422 if extraction is corrupted/missing or content is too short
 *   - 202 with { jobId, status: "QUEUED", totalChunks } on success
 */
export async function enqueueBackgroundAnalysis(
  tenderId: string,
  userId: string,
): Promise<Response> {
  // ── 1. Verify ownership ──────────────────────────────────────────────
  // findFirst by (id, userId) enforces tenant isolation — a user cannot
  // enqueue analysis for another tenant's tender.
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      files: {
        select: {
          id: true,
          fileName: true,
          originalFileName: true,
          extractedText: true,
          deletionStatus: true,
        },
      },
    },
  });

  if (!tender) {
    return NextResponse.json(
      { error: "Tender not found or access denied.", code: "TENDER_NOT_FOUND" },
      { status: 404 },
    );
  }

  // ── 2. Extraction-quality gate ───────────────────────────────────────
  // Mirror the SSE route's corrupted-extraction rejection so the user
  // gets an immediate, actionable error instead of a queued job that
  // is guaranteed to fail. Only ACTIVE files are considered.
  const activeFiles = tender.files.filter(
    (f) => (f as { deletionStatus?: string | null }).deletionStatus !== "DELETED",
  );

  if (activeFiles.length === 0) {
    return NextResponse.json(
      {
        error:
          "No active tender files found. Upload and extract a tender document before running AI analysis.",
        code: "EXTRACTION_NOT_READY",
        nextAction: "UPLOAD_TENDER_DOCUMENT",
      },
      { status: 422 },
    );
  }

  const corruptedFiles = activeFiles.filter((f) => {
    const report = assessExtractionQuality(
      f.extractedText ?? "",
      f.originalFileName || f.fileName,
    );
    return report.corrupted;
  });

  if (corruptedFiles.length > 0) {
    return NextResponse.json(
      {
        error:
          "AI analysis skipped: extracted tender text is corrupted/gibberish and requires OCR or re-upload before reliable analysis.",
        code: "EXTRACTION_CORRUPTED_AI_SKIPPED",
        nextAction: "RUN_OCR_OR_UPLOAD_CLEARER_SCAN",
        blockers: corruptedFiles.map((f) => ({
          fileName: f.originalFileName || f.fileName,
        })),
      },
      { status: 422 },
    );
  }

  // ── 3. Create the durable job ────────────────────────────────────────
  // createAnalysisJob builds the shared analysis content, computes the
  // content hash, creates (or reuses) an AiJob row, and provisions the
  // AiAnalyzeChunk rows. It throws when extraction content is too short.
  let jobResult: { jobId: string; totalChunks: number; status: string; nextAction: string };
  try {
    jobResult = await createAnalysisJob({ tenderId, userId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create analysis job";
    // Distinguish "not ready" (422) from genuine server errors (500).
    const isNotReady = /not ready|too short|extraction/i.test(message);
    return NextResponse.json(
      {
        error: message,
        code: isNotReady ? "EXTRACTION_NOT_READY" : "ENQUEUE_FAILED",
      },
      { status: isNotReady ? 422 : 500 },
    );
  }

  // ── 4. Return 202 Accepted ───────────────────────────────────────────
  // The job is now QUEUED. The caller triggers run-next to start the
  // worker immediately; cron/GitHub Actions remain as recovery.
  const body: BackgroundEnqueueResult = {
    jobId: jobResult.jobId,
    status: "QUEUED",
    totalChunks: jobResult.totalChunks,
  };
  return NextResponse.json(body, { status: 202 });
}
