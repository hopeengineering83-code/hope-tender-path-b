/**
 * Stale QUEUED-job reaper — marks AI jobs stuck in QUEUED status as FAILED
 * after a configurable timeout.
 *
 * Problem: a job can sit QUEUED forever if no worker ever claims it (a
 * jobType with no scheduled drain, a worker outage longer than the queue's
 * intended latency, or a bug in job-type filtering). Nothing else in the
 * codebase surfaces this — RUNNING-job recovery is handled separately by
 * `failStuckJobs` (lib/ai-jobs.ts), which is wired into the automated branch
 * of /api/ai-jobs/run-next. This reaper covers the complementary case
 * (never claimed at all) so the two don't duplicate the same RUNNING-job
 * sweep with different thresholds.
 *
 * Solution: call reapStaleQueuedJobs() periodically (wired into the run-next
 * worker's automated branch). Jobs older than STALE_THRESHOLD_MS are marked
 * FAILED with a stale-reaper error message.
 *
 * This is idempotent — safe to call multiple times (WHERE status='QUEUED').
 */

import { prisma } from "../prisma";
import { logger } from "../observability";

// 30 minutes — matches the trigger's 30-minute active-job window
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

export async function reapStaleQueuedJobs(): Promise<{ reaped: number; errors: string[] }> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
  const errors: string[] = [];
  let reaped = 0;

  try {
    // Find jobs that are QUEUED but created >30min ago (never claimed)
    const staleQueued = await prisma.aiJob.findMany({
      where: {
        status: "QUEUED",
        createdAt: { lt: cutoff },
      },
      select: { id: true, tenderId: true, createdAt: true },
    });

    for (const job of staleQueued) {
      try {
        const updated = await prisma.aiJob.updateMany({
          where: { id: job.id, status: "QUEUED" },
          data: {
            status: "FAILED",
            errorMessage: "Job was never claimed by a worker — marked as failed by stale job reaper",
            finishedAt: new Date(),
          },
        });
        if (updated.count > 0) {
          reaped++;
          logger.warn("Stale queued job reaped", {
            jobId: job.id,
            tenderId: job.tenderId,
            createdAt: job.createdAt,
          } as Record<string, unknown>);
        }
      } catch (e) {
        errors.push(`Failed to reap job ${job.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (reaped > 0) {
      logger.info("Stale queued job reaper completed", { reaped, total: staleQueued.length });
    }
  } catch (e) {
    errors.push(`Reaper failed: ${e instanceof Error ? e.message : String(e)}`);
    logger.error("Stale queued job reaper failed", { error: e });
  }

  return { reaped, errors };
}
