/**
 * Stale job reaper — marks AI jobs stuck in RUNNING/QUEUED status as FAILED
 * after a configurable timeout.
 *
 * Problem: if the server crashes mid-job, the AiJob row stays in RUNNING
 * forever, blocking the dashboard's "latest job" view and preventing retries.
 *
 * Solution: call reapStaleJobs() periodically (e.g., from a cron endpoint or
 * the run-next worker). Jobs older than STALE_THRESHOLD_MS are marked FAILED
 * with a stale-reaper error message.
 *
 * This is idempotent — safe to call multiple times.
 */

import { prisma } from "../prisma";
import { logger } from "../observability";

// 30 minutes — matches the trigger's 30-minute active-job window
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

export async function reapStaleJobs(): Promise<{ reaped: number; errors: string[] }> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
  const errors: string[] = [];
  let reaped = 0;

  try {
    // Find jobs that are RUNNING but started >30min ago
    const staleRunning = await prisma.aiJob.findMany({
      where: {
        status: "RUNNING",
        startedAt: { lt: cutoff },
      },
      select: { id: true, tenderId: true, startedAt: true },
    });

    // Find jobs that are QUEUED but created >30min ago (never started)
    const staleQueued = await prisma.aiJob.findMany({
      where: {
        status: "QUEUED",
        createdAt: { lt: cutoff },
      },
      select: { id: true, tenderId: true, createdAt: true },
    });

    const allStale = [...staleRunning, ...staleQueued];

    for (const job of allStale) {
      try {
        await prisma.aiJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            errorMessage: "Job timed out — marked as failed by stale job reaper",
            finishedAt: new Date(),
          },
        });
        reaped++;
        logger.warn("Stale job reaped", {
          jobId: job.id,
          tenderId: job.tenderId,
          startedAt: "startedAt" in job ? job.startedAt : job.createdAt,
        } as Record<string, unknown>);
      } catch (e) {
        errors.push(`Failed to reap job ${job.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (reaped > 0) {
      logger.info("Stale job reaper completed", { reaped, total: allStale.length });
    }
  } catch (e) {
    errors.push(`Reaper failed: ${e instanceof Error ? e.message : String(e)}`);
    logger.error("Stale job reaper failed", { error: e });
  }

  return { reaped, errors };
}
