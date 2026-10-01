import { NextRequest, NextResponse } from "next/server";
import { logger } from "../../../../lib/observability";
import { prismaReady } from "../../../../lib/prisma";
import { findJobsDueForRetry, rearmJobForRetry, isAnyProviderEligible } from "../../../../lib/ai-analyze/retry-service";

export const dynamic = "force-dynamic";

/**
 * Provider-aware AI Analyze retry scheduler (cron).
 *
 * This is the server-side backstop that makes the durable retry "actually
 * fire" without a browser open: find AI_ANALYZE jobs that stopped short and are
 * due for another attempt, re-arm the ones whose tender content is unchanged
 * and whose providers are eligible, then trigger run-next to resume them from
 * their last completed chunk.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. We also
 * accept the worker secret so an external scheduler can poll this more
 * frequently than the platform's cron minimum.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const workerSecret = process.env.AI_JOBS_WORKER_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const workerHeader = req.headers.get("x-worker-secret");

  const isCron = Boolean(cronSecret && cronSecret.length >= 16 && auth === `Bearer ${cronSecret}`);
  const isWorker = Boolean(workerSecret && workerSecret.length >= 16 && workerHeader === workerSecret);
  if (!isCron && !isWorker) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prismaReady;

    // Short-circuit when nothing can run anyway — keeps the cron cheap and
    // avoids re-arming jobs only to have run-next fail on cooldown.
    if (!isAnyProviderEligible()) {
      return NextResponse.json({ rearmed: 0, due: 0, providersEligible: false });
    }

    const due = await findJobsDueForRetry(10);
    const rearmedJobIds: string[] = [];
    for (const job of due) {
      const ok = await rearmJobForRetry(job.jobId).catch(() => false);
      if (ok) rearmedJobIds.push(job.jobId);
    }

    // Kick the durable worker so re-armed jobs resume immediately rather than
    // waiting for the next run-next cron. Reuse the cron Bearer so run-next
    // accepts us as an automated caller. Best-effort — re-armed jobs are
    // QUEUED and a later run-next will pick them up regardless.
    if (rearmedJobIds.length > 0) {
      const origin = new URL(req.url).origin;
      const secret = cronSecret ?? "";
      await fetch(`${origin}/api/ai-jobs/run-next?jobType=AI_ANALYZE`, {
        method: "POST",
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
      }).catch(() => {});
    }

    return NextResponse.json({
      providersEligible: true,
      due: due.length,
      rearmed: rearmedJobIds.length,
      rearmedJobIds,
    });
  } catch (error) {
    logger.error("[ai-analyze-retry] failed", { detail: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Retry failed. Check server logs." }, { status: 500 });
  }
}
