/**
 * AI Job Worker — processes durable analysis jobs from the queue.
 *
 * This service runs periodically (via Vercel Cron) to drain the AiJob queue:
 * 1. Find QUEUED/resumable jobs (status QUEUED, RUNNING, PARTIAL_SUCCESS)
 * 2. Execute analysis via orchestrator
 * 3. Handle retries and backoff on transient failures
 * 4. Persist final results and mark complete
 *
 * Jobs can be resumed from checkpoints if previous chunks completed.
 */

import { prisma } from "../prisma";
import { executeAnalysis, finalizeAnalysisJob, type AnalysisOrchestrationOptions } from "../engine/analysis-orchestrator";
import type { AnalysisJobCreateInput } from "./analysis-job-service";
import { logger } from "../observability";
import { restoreProviderHealthBeforeResponse } from "../ai-provider-health";
import { persistAllHealthToDb } from "../ai-provider-health-db";

export type JobWorkerOptions = {
  maxConcurrentJobs?: number;
  deadlineMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
};

/**
 * Process one batch of queued analysis jobs.
 * Called by Vercel Cron endpoint to drain the job queue.
 */
export async function drainAnalysisJobQueue(options: JobWorkerOptions = {}) {
  const {
    maxConcurrentJobs = 3,
    deadlineMs = 45000,
    maxRetries = 3,
    retryBackoffMs = 5000,
  } = options;

  logger.info("[worker] draining analysis job queue...");
  await restoreProviderHealthBeforeResponse();

  // Find jobs ready to process
  const queuedJobs = await prisma.aiJob.findMany({
    where: {
      jobType: "AI_ANALYZE",
      status: { in: ["QUEUED", "RUNNING", "PARTIAL_SUCCESS"] },
      startedAt: {
        // Don't process jobs that are currently running (started < 2 min ago)
        lt: new Date(Date.now() - 120_000),
      },
    },
    orderBy: [
      { status: "asc" }, // QUEUED first, then PARTIAL_SUCCESS, then RUNNING (likely timed out)
      { createdAt: "asc" }, // Oldest first (FIFO)
    ],
    take: maxConcurrentJobs,
  });

  logger.info(`[worker] found ${queuedJobs.length} jobs to process`);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const job of queuedJobs) {
    try {
      processed++;
      logger.info(`[worker] processing job ${job.id} (${processed}/${queuedJobs.length})`);

      // Mark job as RUNNING
      await prisma.aiJob.update({
        where: { id: job.id },
        data: { status: "RUNNING", startedAt: new Date() },
      });

      // Parse job input to get tenderId, userId
      const input = job.input ? JSON.parse(job.input) : {};
      const { tenderId, contentHash } = input;

      if (!tenderId || !job.userId) {
        throw new Error("Missing tenderId or userId in job input");
      }

      // Execute analysis with orchestrator
      const result = await executeAnalysis(tenderId, job.userId, {
        force: false,
        deadlineMs,
        onProgress: (event) => {
          // Log progress for monitoring
          if (event.phase === "complete") {
            logger.info(`[worker] job ${job.id} phase complete`, { message: event.message });
          }
        },
      });

      // Determine terminal state. SUCCEEDED is reserved for a full AI success
      // that the finalizer actually promoted to canonical — the recovery
      // worker must use the SAME promotion path as the interactive worker so
      // a partial/failed run can never be silently completed as SUCCEEDED.
      let finalStatus: string;
      if (result.success && !result.isPartial && !result.errorMessage) {
        const finalize = await finalizeAnalysisJob(result.jobId, job.userId);
        finalStatus = finalize.status;
      } else {
        // executeAnalysis already wrote PARTIAL_SUCCESS/FAILED; record metrics
        // without overriding its terminal state.
        finalStatus = result.completedChunks > 0 || result.isPartial ? "PARTIAL_SUCCESS" : "FAILED";
        await prisma.aiJob.update({
          where: { id: job.id },
          data: { status: finalStatus, finishedAt: new Date(), retries: job.retries },
        });
      }

      if (finalStatus === "SUCCEEDED") succeeded++;
      await persistAllHealthToDb();
      logger.info(`[worker] job ${job.id} ${finalStatus}`);
    } catch (err) {
      failed++;
      await persistAllHealthToDb();
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error(`[worker] job ${job.id} failed`, { error: errorMsg });

      // Handle retry logic
      const shouldRetry = job.retries < maxRetries && isTransientError(errorMsg);

      if (shouldRetry) {
        const nextRetry = new Date(Date.now() + retryBackoffMs * Math.pow(2, job.retries));
        await prisma.aiJob.update({
          where: { id: job.id },
          data: {
            status: "QUEUED",
            retries: job.retries + 1,
            errorMessage: `Retry ${job.retries + 1}: ${errorMsg}`,
            startedAt: nextRetry, // Reschedule for later
          },
        });
        logger.info(`[worker] job ${job.id} scheduled for retry ${job.retries + 1}`);
      } else {
        // Permanent failure
        await prisma.aiJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            finishedAt: new Date(),
            errorMessage: errorMsg,
            retries: job.retries,
          },
        });
        logger.info(`[worker] job ${job.id} permanently failed`);
      }
    }
  }

  return {
    processed,
    succeeded,
    failed,
    timestamp: new Date(),
  };
}

/**
 * Determine if an error is transient (should retry) or permanent (give up).
 * Transient: network timeouts, rate limits, temp service outages
 * Permanent: invalid input, auth failures, extraction not ready
 */
function isTransientError(message: string): boolean {
  const transientPatterns = [
    /timeout/i,
    /ECONNREFUSED/i,
    /ENOTFOUND/i,
    /ETIMEDOUT/i,
    /rate.?limit/i,
    /too.?many.?requests/i,
    /service.?unavailable/i,
    /temporarily/i,
  ];

  const permanentPatterns = [
    /not found or access denied/i,
    /extraction not ready/i,
    /content too short/i,
    /invalid.*input/i,
    /unauthorized/i,
    /forbidden/i,
  ];

  // Check permanent first (higher priority)
  if (permanentPatterns.some((p) => p.test(message))) {
    return false;
  }

  // Check transient patterns
  if (transientPatterns.some((p) => p.test(message))) {
    return true;
  }

  // Default: transient (try again) to avoid losing work
  return true;
}

/**
 * Get current job queue statistics for monitoring.
 */
export async function getJobQueueStats() {
  const stats = await prisma.aiJob.groupBy({
    by: ["jobType", "status"],
    where: { jobType: "AI_ANALYZE" },
    _count: true,
  });

  const avgRetries = await prisma.aiJob.aggregate({
    where: { jobType: "AI_ANALYZE" },
    _avg: { retries: true },
  });

  const oldestRunning = await prisma.aiJob.findFirst({
    where: { jobType: "AI_ANALYZE", status: "RUNNING" },
    orderBy: { startedAt: "asc" },
    select: { id: true, startedAt: true },
  });

  return {
    jobsByStatus: stats,
    avgRetries: avgRetries._avg.retries ?? 0,
    oldestRunningJob: oldestRunning,
    timestamp: new Date(),
  };
}
