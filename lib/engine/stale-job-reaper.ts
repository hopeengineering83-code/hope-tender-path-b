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

/**
 * Did a worker actually look at this job and decline to take it?
 *
 * Age was previously the whole test, and age alone is not evidence of
 * anything. The queue drains ONE job per tick (run-next breaks after any
 * pipeline job type) and the only unattended driver is a GitHub Actions cron
 * on a 5-minute schedule whose own documentation notes 5–15 minutes of drift.
 * So a healthy backlog of seven jobs, or a worker outage of half an hour,
 * pushed perfectly good work past 30 minutes — and the reaper marked it
 * FAILED with "never claimed by a worker", which was not true and destroyed
 * work that would have run on the next tick. Worse, the reaper runs at the
 * start of the same tick that would have claimed the job, so the tick that
 * should have rescued it killed it first.
 *
 * Claiming is strictly FIFO within a job type: claimJobForCaller selects
 * `ORDER BY "createdAt" ASC LIMIT 1`, with an optional jobType filter. An
 * older job of a given type is therefore ALWAYS preferred over a newer one of
 * that type. So if a job of the same type created LATER has already been
 * started, this one was demonstrably passed over — that is a real orphan
 * (an unregistered handler, a job-type filtering bug), not a queue waiting
 * its turn.
 *
 * If no newer sibling has started, the worker either has not run (outage) or
 * has not reached this job yet (backlog). Both resolve on their own, so the
 * job is left alone.
 */
async function wasPassedOver(job: { id: string; jobType: string; createdAt: Date }): Promise<boolean> {
  const overtakenBy = await prisma.aiJob.count({
    where: {
      id: { not: job.id },
      jobType: job.jobType,
      createdAt: { gt: job.createdAt },
      startedAt: { not: null },
    },
  });
  return overtakenBy > 0;
}

export async function reapStaleQueuedJobs(): Promise<{ reaped: number; errors: string[] }> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
  const errors: string[] = [];
  let reaped = 0;

  try {
    // Candidates: QUEUED for longer than the threshold. Age alone does NOT
    // mean orphaned — see wasPassedOver below.
    const staleQueued = await prisma.aiJob.findMany({
      where: {
        status: "QUEUED",
        createdAt: { lt: cutoff },
      },
      select: { id: true, tenderId: true, createdAt: true, jobType: true },
    });

    for (const job of staleQueued) {
      if (!(await wasPassedOver(job))) continue;
      try {
        const updated = await prisma.aiJob.updateMany({
          where: { id: job.id, status: "QUEUED" },
          data: {
            status: "FAILED",
            errorMessage: "Job was passed over by the worker while newer jobs of the same type ran — marked as failed by stale job reaper",
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
