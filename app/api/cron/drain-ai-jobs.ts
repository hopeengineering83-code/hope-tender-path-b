// Vercel Cron endpoint for draining the AI analysis job queue.
// This endpoint is called on a schedule (every 5 minutes) to process
// queued analysis jobs in the background.
//
// Vercel Cron configuration in vercel.json:
// {
//   "crons": [
//     {
//       "path": "/api/cron/drain-ai-jobs",
//       "schedule": "0 0/5 * * * *"
//     }
//   ]
// }

import { NextResponse } from "next/server";
import { prismaReady } from "../../../lib/prisma";
import { drainAnalysisJobQueue, getJobQueueStats } from "../../../lib/ai-jobs/worker";
import { logger } from "../../../lib/observability";

export const maxDuration = 50;

export async function GET(req: Request) {
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

    logger.info("[cron] starting AI job queue drain...");
    const startTime = Date.now();

    const result = await drainAnalysisJobQueue({
      maxConcurrentJobs: 3,
      deadlineMs: 45000,
      maxRetries: 3,
      retryBackoffMs: 5000,
    });

    const duration = Date.now() - startTime;

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

    logger.info("[cron] queue drain complete", { summary });

    const queuedCount = stats.jobsByStatus.find(
      (s) => s.jobType === "AI_ANALYZE" && s.status === "QUEUED"
    )?._count ?? 0;

    if (queuedCount > 10) {
      logger.warn(`[cron] WARNING: ${queuedCount} jobs still queued, consider increasing frequency`);
    }

    return NextResponse.json(summary);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("[cron] queue drain failed", { error: errorMsg });

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
