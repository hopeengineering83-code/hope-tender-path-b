/**
 * Vercel Cron endpoint for draining the AI analysis job queue.
 *
 * This endpoint is called on a schedule (e.g., every 5 minutes) to process
 * queued analysis jobs in the background.
 *
 * Vercel Cron configuration in vercel.json:
 * {
 *   "crons": [
 *     {
 *       "path": "/api/cron/drain-ai-jobs",
 *       "schedule": "*/5 * * * *"  // Every 5 minutes
 *     }
 *   ]
 * }
 */

import { NextResponse } from "next/server";
import { prismaReady } from "../../../lib/prisma";
import { drainAnalysisJobQueue, getJobQueueStats } from "../../../lib/ai-jobs/worker";

export const maxDuration = 50; // Cron jobs can run up to 5 min on Pro, we use 50s to be safe

export async function GET(req: Request) {
  // Verify this is a Vercel Cron request by checking the Authorization header
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.VERCEL_CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: "Unauthorized — invalid or missing VERCEL_CRON_SECRET" },
      { status: 401 }
    );
  }

  try {
    await prismaReady;

    console.log("[cron] starting AI job queue drain...");
    const startTime = Date.now();

    // Drain the job queue
    const result = await drainAnalysisJobQueue({
      maxConcurrentJobs: 3,
      deadlineMs: 45000,
      maxRetries: 3,
      retryBackoffMs: 5000,
    });

    const duration = Date.now() - startTime;

    // Get queue statistics for monitoring
    const stats = await getJobQueueStats();

    const summary = {
      success: true,
      durationMs: duration,
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      queueStats: stats,
      timestamp: new Date().toISOString(),
    };

    console.log("[cron] queue drain complete:", JSON.stringify(summary, null, 2));

    // Log a warning if queue is backing up
    const queuedCount = stats.jobsByStatus.find(
      (s) => s.jobType === "AI_ANALYZE" && s.status === "QUEUED"
    )?._count ?? 0;

    if (queuedCount > 10) {
      console.warn(`[cron] WARNING: ${queuedCount} jobs still queued, consider increasing frequency`);
    }

    return NextResponse.json(summary);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[cron] queue drain failed:", errorMsg);

    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
