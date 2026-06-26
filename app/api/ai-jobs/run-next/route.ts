import { NextResponse } from "next/server";
import { requireRole, unauthorizedResponse } from "../../../../lib/auth";
import { completeJob, failJob } from "../../../../lib/ai-jobs";
import { restoreHealthFromDb } from "../../../../lib/ai-provider-health-db";
import { claimJobForCaller } from "../../../../lib/job-claim-policy";
import { getHandler, isTerminalHandlerResult } from "../../../../lib/ai-job-handlers";
import { parseJobTypeFilter, SUPPORTED_JOB_TYPES } from "../../../../lib/job-type-policy";
import { prismaReady } from "../../../../lib/prisma";
import { recordRetryStateForJob, findJobsDueForRetry, rearmJobForRetry } from "../../../../lib/ai-analyze/retry-service";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return POST(req);
}

export async function POST(req: Request) {
  const workerSecret = req.headers.get("x-worker-secret");
  const aiJobsSecret = process.env.AI_JOBS_WORKER_SECRET;
  const isWorkerSecret = Boolean(aiJobsSecret && aiJobsSecret.length >= 16 && workerSecret === aiJobsSecret);

  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = Boolean(cronSecret && cronSecret.length >= 16 && authHeader === `Bearer ${cronSecret}`);
  const isAutomatedCaller = isWorkerSecret || isVercelCron;

  let userId: string | null = null;
  if (!isAutomatedCaller) {
    try {
      const actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
      userId = actor.id;
    } catch {
      return unauthorizedResponse();
    }
  }

  await prismaReady;
  // Restore provider health (cooldowns, verified status) before processing the
  // first job. This ensures that if the daily run-next cron starts a cold worker
  // instance, it doesn't immediately retry known-bad providers that were cooling
  // down at the time of the previous failure.
  await restoreHealthFromDb().catch((err: unknown) => {
    console.error(`[run-next] Failed to restore provider health from DB (non-critical): ${err instanceof Error ? err.message : String(err)}`);
  });

  const { searchParams } = new URL(req.url);
  const parsedJobType = parseJobTypeFilter(searchParams.get("jobType"));
  if (!parsedJobType.ok) {
    return NextResponse.json({
      error: "Invalid jobType filter",
      code: parsedJobType.code,
      supportedJobTypes: SUPPORTED_JOB_TYPES,
    }, { status: 400 });
  }

  const startTime = Date.now();
  const maxRunMs = 40_000;
  const processedJobs: Array<{ jobId: string; jobType: string; status: string; error?: string }> = [];

  // Provider-aware retry backstop. When an automated caller (Vercel cron or the
  // worker secret) drives the queue, first re-arm any AI_ANALYZE jobs that
  // stopped short and are now due — but only when a provider is eligible and
  // the tender content is unchanged. This lets the EXISTING daily run-next cron
  // resume stalled analyses with no extra cron entry (Vercel Hobby caps crons
  // at two). UI-triggered calls (session auth) skip this so a user only ever
  // drives their own job. Best-effort — never block the claim loop.
  if (isAutomatedCaller) {
    try {
      const due = await findJobsDueForRetry(10);
      for (const job of due) {
        await rearmJobForRetry(job.jobId).catch((err: unknown) => {
          console.error(`[run-next] Retry re-arm failed for job ${job.jobId}: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    } catch (err) {
      console.error(`[run-next] Retry due-job lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  while (Date.now() - startTime < maxRunMs) {
    const claimed = await claimJobForCaller({
      jobType: parsedJobType.value,
      userId: userId ?? undefined,
      global: isAutomatedCaller,
    });
    if (!claimed) break;

    const handler = getHandler(claimed.jobType);
    if (!handler) {
      await failJob(claimed.id, `No handler registered for jobType=${claimed.jobType}`);
      processedJobs.push({ jobId: claimed.id, jobType: claimed.jobType, status: "FAILED", error: "No handler" });
      continue;
    }

    try {
      const result = await handler({
        jobId: claimed.id,
        userId: claimed.userId,
        tenderId: claimed.tenderId,
        input: claimed.input,
      });
      if (isTerminalHandlerResult(result)) {
        // The handler already drove the job to its terminal state (e.g.
        // AI_ANALYZE: SUCCEEDED only after canonical promotion, otherwise
        // PARTIAL_SUCCESS/FAILED). Respect it — calling completeJob() here
        // would corrupt a partial/failed analysis into SUCCEEDED and falsely
        // unlock generation/export. The handler owns output persistence.
        //
        // When an AI_ANALYZE run stops short, record durable retry state so the
        // provider-aware scheduler (cron /api/cron/ai-analyze-retry) can re-arm
        // it once a provider is eligible again — resuming from the last
        // completed chunk. Best-effort: a bookkeeping failure must not break
        // the worker loop. SUCCEEDED needs no retry.
        if (
          claimed.jobType === "AI_ANALYZE" &&
          (result.terminalStatus === "PARTIAL_SUCCESS" || result.terminalStatus === "FAILED")
        ) {
          await recordRetryStateForJob(claimed.id, result.terminalStatus).catch((err: unknown) => {
            console.error(`[run-next] Retry-state persistence failed for job ${claimed.id}: ${err instanceof Error ? err.message : String(err)}. Job remains ${result.terminalStatus}; generation blocked.`);
          });
        }
        processedJobs.push({ jobId: claimed.id, jobType: claimed.jobType, status: result.terminalStatus });
      } else {
        await completeJob(claimed.id, result);
        processedJobs.push({ jobId: claimed.id, jobType: claimed.jobType, status: "SUCCEEDED" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failJob(claimed.id, message);
      processedJobs.push({ jobId: claimed.id, jobType: claimed.jobType, status: "FAILED", error: "Job execution failed" });
    }

    if (["ENGINE_RUN", "PROPOSAL_GENERATION", "AI_REMATCH", "EVALUATOR_SIM", "AI_ANALYZE"].includes(claimed.jobType)) break;
  }

  if (processedJobs.length === 0) {
    return NextResponse.json({ ran: 0, message: "queue empty" });
  }

  return NextResponse.json({
    ran: processedJobs.length,
    processedJobs,
    durationMs: Date.now() - startTime,
  });
}
