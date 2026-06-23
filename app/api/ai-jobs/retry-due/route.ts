import { NextResponse } from "next/server";
import { prismaReady } from "../../../../lib/prisma";
import { findJobsDueForRetry, rearmJobForRetry } from "../../../../lib/ai-analyze/retry-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/ai-jobs/retry-due
 *
 * Server-side scheduled retry drain. Called by Vercel cron or GitHub
 * Actions (NOT by the browser) to re-arm AI_ANALYZE jobs that are due
 * for provider-aware automatic retry.
 *
 * Auth: requires EITHER:
 *   - x-worker-secret header matching AI_JOBS_WORKER_SECRET (automated caller)
 *   - Authorization: Bearer <CRON_SECRET> (Vercel cron)
 *   - Authenticated ADMIN session (manual operator trigger)
 *
 * This is NOT a public endpoint. It does not expose provider keys,
 * error bodies, or sensitive data. It only re-arms jobs that:
 *   - Are non-retryable=false
 *   - Have nextRetryAt <= now
 *   - Have at least one provider currently eligible
 *   - Pass content-hash validation
 *
 * Does NOT create duplicate active jobs. Reuses the existing AiJob row
 * and preserves SUCCEEDED AiAnalyzeChunk checkpoints.
 */
export async function POST(req: Request) {
  const workerSecret = req.headers.get("x-worker-secret");
  const aiJobsSecret = process.env.AI_JOBS_WORKER_SECRET;
  const isWorkerSecret = Boolean(aiJobsSecret && aiJobsSecret.length >= 16 && workerSecret === aiJobsSecret);

  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = Boolean(cronSecret && cronSecret.length >= 16 && authHeader === `Bearer ${cronSecret}`);

  const isAutomatedCaller = isWorkerSecret || isVercelCron;

  if (!isAutomatedCaller) {
    try {
      const { requireRole } = await import("../../../../lib/auth");
      await requireRole("ADMIN");
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  await prismaReady;

  // Find jobs due for retry (server-side provider check is inside findJobsDueForRetry)
  const dueJobs = await findJobsDueForRetry(5);
  const reamed: string[] = [];
  const skipped: string[] = [];

  for (const job of dueJobs) {
    try {
      const ok = await rearmJobForRetry(job.jobId);
      if (ok) {
        reamed.push(job.jobId);
      } else {
        skipped.push(job.jobId);
      }
    } catch {
      // Log a safe error but do NOT silently swallow — the job stays
      // PARTIAL_SUCCESS/FAILED, generation remains blocked, and the
      // retry state is preserved for the next scheduler tick.
      skipped.push(job.jobId);
    }
  }

  // If any jobs were re-armed, trigger the worker to process them.
  // The worker trigger is best-effort — cron will call again if it fails.
  if (reamed.length > 0) {
    try {
      const origin = new URL(req.url).origin;
      await fetch(`${origin}/api/ai-jobs/run-next?jobType=AI_ANALYZE`, {
        method: "POST",
        headers: isWorkerSecret && aiJobsSecret ? { "x-worker-secret": aiJobsSecret } : {},
      }).catch(() => {});
    } catch {
      // Best-effort — the re-armed jobs are QUEUED and will be picked up
    }
  }

  return NextResponse.json({
    reamedCount: reamed.length,
    skippedCount: skipped.length,
    reamed,
    skipped,
  });
}
