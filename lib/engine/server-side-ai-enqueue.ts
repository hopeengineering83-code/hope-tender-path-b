/**
 * Server-side AI_ANALYZE enqueue for upload-first flow.
 *
 * Replaces the previous client-side `triggerTenderUploadAutoPipeline` which
 * fired `POST /api/tenders/:id/ai-analyze?mode=background` from the browser.
 * If the browser closed before the fetch completed, the job was never
 * enqueued — the user had to manually click "Run AI Analyze".
 *
 * This module enqueues the AI_ANALYZE job SERVER-SIDE as the final step of
 * the upload-first handler, after all batches are committed. The job is
 * durable: it persists in the AiJob table with status QUEUED and will be
 * picked up by the drain-ai-job-queue cron (runs every 5 min on main) or
 * the next /api/ai-jobs/run-next call.
 *
 * The enqueue is idempotent: if a QUEUED or RUNNING AI_ANALYZE job already
 * exists for this tender + analysis revision, it returns the existing job
 * instead of creating a duplicate.
 */

import { prisma, prismaReady } from "../prisma";
import { logger } from "../observability";

export type ServerEnqueueResult = {
  /** Whether a new job was created (false = reused existing). */
  created: boolean;
  /** The job ID (existing or new). */
  jobId: string;
  /** The analysis revision (content hash of the source files). */
  analysisRevision: string;
  /** Short status label for the UI. */
  status: "queued" | "already_running";
  /** Human-readable message. */
  message: string;
};

/**
 * Compute the analysis revision for a tender. This is a content hash of the
 * active source files — used as the idempotency key for the AI_ANALYZE job.
 *
 * The revision changes when:
 *   - A source file is added, removed, or replaced.
 *   - A source file's extracted text changes (re-extraction).
 *
 * This ensures a stale AI_ANALYZE job is never reused after the source
 * files change.
 */
export async function computeAnalysisRevision(
  tenderId: string,
): Promise<string | null> {
  await prismaReady;
  const files = await prisma.tenderFile.findMany({
    where: { tenderId, isActive: true },
    select: { id: true, integrityHash: true, extractedTextHash: true, originalFileName: true },
    orderBy: { createdAt: "asc" },
  });
  if (files.length === 0) return null;

  // Build a deterministic hash from the file IDs + integrity hashes
  const parts = files.map(
    (f) => `${f.id}:${f.integrityHash ?? ""}:${f.extractedTextHash ?? ""}:${f.originalFileName}`,
  );
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);
}

/**
 * Enqueue an AI_ANALYZE job server-side. Idempotent — if a QUEUED or RUNNING
 * AI_ANALYZE job already exists for this tender + analysis revision, returns
 * the existing job.
 *
 * This is called by the upload-first handler AFTER all batches are committed.
 * The client does NOT fire this — the server owns the orchestration.
 */
export async function enqueueAiAnalyzeServerSide(
  tenderId: string,
  userId: string,
  options: { source?: string } = {},
): Promise<ServerEnqueueResult | null> {
  await prismaReady;

  const analysisRevision = await computeAnalysisRevision(tenderId);
  if (!analysisRevision) {
    logger.warn("[server-enqueue] no active source files — skipping AI_ANALYZE", { tenderId });
    return null;
  }

  // Idempotency: check for an existing QUEUED or RUNNING AI_ANALYZE job
  // with the same analysis revision.
  const existing = await prisma.aiJob.findFirst({
    where: {
      tenderId,
      jobType: "AI_ANALYZE",
      status: { in: ["QUEUED", "RUNNING"] },
      analysisInputHash: analysisRevision,
    },
    select: { id: true, status: true },
  });

  if (existing) {
    return {
      created: false,
      jobId: existing.id,
      analysisRevision,
      status: "already_running",
      message: `AI Analyze is already ${existing.status === "RUNNING" ? "running" : "queued"} for this tender. Job: ${existing.id.slice(0, 8)}.`,
    };
  }

  // Create a new AI_ANALYZE job
  const job = await prisma.aiJob.create({
    data: {
      jobType: "AI_ANALYZE",
      status: "QUEUED",
      userId,
      tenderId,
      analysisInputHash: analysisRevision,
      input: JSON.stringify({
        source: options.source ?? "upload-first-server-enqueue",
        tenderId,
        analysisRevision,
      }),
    },
    select: { id: true },
  });

  logger.info("[server-enqueue] AI_ANALYZE job enqueued server-side", {
    tenderId,
    jobId: job.id,
    analysisRevision,
    source: options.source ?? "upload-first-server-enqueue",
  });

  return {
    created: true,
    jobId: job.id,
    analysisRevision,
    status: "queued",
    message: `AI Analyze queued server-side. Job: ${job.id.slice(0, 8)}. The job will run even if you close this browser.`,
  };
}
