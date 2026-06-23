/**
 * Background enqueue for AI Analyze — the single durable entry point.
 *
 * Escapes the 60s Vercel Hobby cap by enqueuing a durable AI_ANALYZE
 * job and returning HTTP 202 immediately. The caller then triggers
 * /api/ai-jobs/run-next?jobType=AI_ANALYZE to start the worker.
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
 * Verifies ownership, validates extraction quality, and creates the job
 * via createAnalysisJob (which is idempotent by tenderId + contentHash —
 * it reuses an existing QUEUED/RUNNING/PARTIAL_SUCCESS job for the same
 * hash instead of creating a duplicate).
 *
 * Returns:
 *   - 404 if the tender is not found or not owned by the user
 *   - 422 if extraction is corrupted/missing or content is too short
 *   - 202 with { jobId, status: "QUEUED", totalChunks } on success
 */
export async function enqueueBackgroundAnalysis(
  tenderId: string,
  userId: string,
): Promise<Response> {
  // 1. Verify ownership
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

  // 2. Extraction-quality gate
  const activeFiles = tender.files.filter(
    (f) => (f as { deletionStatus?: string | null }).deletionStatus !== "DELETED",
  );

  if (activeFiles.length === 0) {
    return NextResponse.json(
      {
        error: "No active tender files found. Upload and extract a tender document before running AI analysis.",
        code: "EXTRACTION_NOT_READY",
        nextAction: "UPLOAD_TENDER_DOCUMENT",
      },
      { status: 422 },
    );
  }

  const corruptedFiles = activeFiles.filter((f) => {
    const report = assessExtractionQuality(f.extractedText ?? "", f.originalFileName || f.fileName);
    return report.corrupted;
  });

  if (corruptedFiles.length > 0) {
    return NextResponse.json(
      {
        error: "AI analysis skipped: extracted tender text is corrupted/gibberish and requires OCR or re-upload.",
        code: "EXTRACTION_CORRUPTED_AI_SKIPPED",
        nextAction: "RUN_OCR_OR_UPLOAD_CLEARER_SCAN",
      },
      { status: 422 },
    );
  }

  // 3. Create the durable job (idempotent by content hash)
  let jobResult: { jobId: string; totalChunks: number; status: string; nextAction: string };
  try {
    jobResult = await createAnalysisJob({ tenderId, userId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create analysis job";
    const isNotReady = /not ready|too short|extraction/i.test(message);
    return NextResponse.json(
      { error: message, code: isNotReady ? "EXTRACTION_NOT_READY" : "ENQUEUE_FAILED" },
      { status: isNotReady ? 422 : 500 },
    );
  }

  // 4. Return 202 Accepted
  const body: BackgroundEnqueueResult = {
    jobId: jobResult.jobId,
    status: "QUEUED",
    totalChunks: jobResult.totalChunks,
  };
  return NextResponse.json(body, { status: 202 });
}
