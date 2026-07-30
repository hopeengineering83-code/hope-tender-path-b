/**
 * Server-side AI_ANALYZE enqueue — durable, idempotent.
 *
 * Enqueues AI_ANALYZE as a server-side step in the upload-first handler.
 * The job persists in the AiJob table and runs even if the browser is
 * closed. The drain-ai-job-queue GitHub Actions cron (every 5 min on main)
 * or the next /api/ai-jobs/run-next call picks it up.
 *
 * Idempotent: if a QUEUED or RUNNING AI_ANALYZE job already exists for this
 * tender + analysis revision, it returns the existing job.
 */

import type { PrismaClient } from "@prisma/client";

export type ServerEnqueueResult =
  | { status: "ENQUEUED"; jobId: string }
  | { status: "ALREADY_ACTIVE"; jobId: string }
  | { status: "SKIPPED_NO_MEANINGFUL_TEXT"; jobId: null };

/**
 * Durably enqueue AI analysis before an upload request returns. The lookup
 * and create share one serializable transaction so browser lifetime is
 * irrelevant and concurrent upload responses cannot create duplicate active
 * analysis jobs.
 */
export async function enqueueAiAnalyzeServerSide(
  client: PrismaClient,
  input: {
    tenderId: string;
    userId: string;
    hasMeaningfulText: boolean;
    sourceRevision?: string | null;
  },
): Promise<ServerEnqueueResult> {
  if (!input.hasMeaningfulText) return { status: "SKIPPED_NO_MEANINGFUL_TEXT", jobId: null };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await client.$transaction(
        async (tx) => {
          const tender = await tx.tender.findFirst({
            where: { id: input.tenderId, userId: input.userId },
            select: { id: true },
          });
          if (!tender) throw new Error("TENDER_NOT_FOUND_OR_FORBIDDEN");

          const active = await tx.aiJob.findFirst({
            where: {
              tenderId: input.tenderId,
              userId: input.userId,
              jobType: "AI_ANALYZE",
              status: { in: ["QUEUED", "RUNNING", "PARTIAL_SUCCESS"] },
              ...(input.sourceRevision
                ? { analysisInputHash: input.sourceRevision }
                : {}),
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          if (active) return { status: "ALREADY_ACTIVE" as const, jobId: active.id };

          const job = await tx.aiJob.create({
            data: {
              tenderId: input.tenderId,
              userId: input.userId,
              jobType: "AI_ANALYZE",
              status: "QUEUED",
              analysisInputHash: input.sourceRevision ?? null,
              input: JSON.stringify({
                tenderId: input.tenderId,
                source: "upload-first-server",
                sourceRevision: input.sourceRevision ?? null,
              }),
            },
            select: { id: true },
          });
          return { status: "ENQUEUED" as const, jobId: job.id };
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if ((error as { code?: string }).code !== "P2034" || attempt === 2) throw error;
    }
  }
  throw new Error("AI_ANALYZE_ENQUEUE_SERIALIZATION_RETRY_EXHAUSTED");
}
