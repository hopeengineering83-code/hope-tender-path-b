import { NextResponse } from "next/server";
import { logger } from "../../../../lib/observability";
import { requireRole, unauthorizedResponse } from "../../../../lib/auth";
import { completeJob, failJob } from "../../../../lib/ai-jobs";
import { continueSuccessfulAnalysis } from "../../../../lib/ai-jobs/engine-continuation-service";
import { claimJobForCaller } from "../../../../lib/job-claim-policy";
import { getHandler, isTerminalHandlerResult } from "../../../../lib/ai-job-handlers";
import { parseJobTypeFilter, SUPPORTED_JOB_TYPES } from "../../../../lib/job-type-policy";
import { prismaReady } from "../../../../lib/prisma";
import { recordRetryStateForJob, findJobsDueForRetry, rearmJobForRetry } from "../../../../lib/ai-analyze/retry-service";
import { restoreHealthFromDbBounded } from "../../../../lib/ai-provider-health-db";

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
  type WorkerJobResult = {
    jobId: string;
    jobType: string;
    status: string;
    terminalStatus?: string;
    resultCode?: string;
    error?: string;
    retryable?: boolean;
    correlationId?: string;
    retryScheduled?: boolean;
    nextJobId?: string;
    nextJobType?: string;
    continuationReason?: string;
    continuationReused?: boolean;
    analysisRevision?: string;
  };
  const processedJobs: WorkerJobResult[] = [];

  if (isAutomatedCaller) {
    try {
      const healthRestore = await restoreHealthFromDbBounded(2_000);
      if (healthRestore.warning) logger.error(`[run-next] Provider health restore warning before retry re-arm: ${healthRestore.warning}`);
      const due = await findJobsDueForRetry(10);
      for (const job of due) {
        await rearmJobForRetry(job.jobId).catch((err: unknown) => {
          logger.error(`[run-next] Retry re-arm failed for job ${job.jobId}: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    } catch (err) {
      logger.error(`[run-next] Retry due-job lookup failed: ${err instanceof Error ? err.message : String(err)}`);
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
      processedJobs.push({
        jobId: claimed.id,
        jobType: claimed.jobType,
        status: "FAILED",
        terminalStatus: "FAILED",
        resultCode: "NO_HANDLER_REGISTERED",
        error: `No handler registered for jobType=${claimed.jobType}`,
        retryable: false,
      });
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
        if (
          claimed.jobType === "AI_ANALYZE" &&
          (result.terminalStatus === "PARTIAL_SUCCESS" || result.terminalStatus === "FAILED")
        ) {
          await recordRetryStateForJob(claimed.id, result.terminalStatus).catch((err: unknown) => {
            logger.error(`[run-next] Retry-state persistence failed for job ${claimed.id}: ${err instanceof Error ? err.message : String(err)}. Job remains ${result.terminalStatus}; generation blocked.`);
          });
        }

        let nextJobId: string | undefined;
        let nextJobType: string | undefined;
        let continuationReason: string | undefined;
        let continuationReused: boolean | undefined;
        let analysisRevision: string | undefined;

        if (claimed.jobType === "AI_ANALYZE") {
          const continuation = await continueSuccessfulAnalysis(claimed.id);
          if (continuation.queued) {
            nextJobId = continuation.jobId;
            nextJobType = "ENGINE_RUN";
            continuationReused = continuation.reused;
            analysisRevision = continuation.analysisRevision;
          } else {
            continuationReason = continuation.reason;
          }
        }

        processedJobs.push({
          jobId: claimed.id,
          jobType: claimed.jobType,
          status: result.terminalStatus,
          terminalStatus: result.terminalStatus,
          resultCode: result.code,
          retryable: result.terminalStatus === "FAILED" ? Boolean(result.retryable) : undefined,
          correlationId: result.correlationId,
          retryScheduled: claimed.jobType === "AI_ANALYZE" && (result.terminalStatus === "PARTIAL_SUCCESS" || result.terminalStatus === "FAILED"),
          nextJobId,
          nextJobType,
          continuationReason,
          continuationReused,
          analysisRevision,
        });
      } else {
        await completeJob(claimed.id, result);
        processedJobs.push({
          jobId: claimed.id,
          jobType: claimed.jobType,
          status: "SUCCEEDED",
          terminalStatus: "SUCCEEDED",
          resultCode: "OK",
          retryable: false,
        });
      }
    } catch (error) {
      const correlationId = require("crypto").randomUUID().slice(0, 8);
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[run-next] Job ${claimed.id} execution failed correlationId=${correlationId}: ${message}`);
      await failJob(claimed.id, `JOB_EXECUTION_FAILED (ref: ${correlationId})`);
      processedJobs.push({
        jobId: claimed.id,
        jobType: claimed.jobType,
        status: "FAILED",
        terminalStatus: "FAILED",
        resultCode: "JOB_EXECUTION_FAILED",
        correlationId,
        retryable: true,
      });
    }

    if (["ENGINE_RUN", "PROPOSAL_GENERATION", "AI_REMATCH", "EVALUATOR_SIM", "EXTRACT_TEXT", "AI_ANALYZE"].includes(claimed.jobType)) break;
  }

  if (processedJobs.length === 0) {
    return NextResponse.json({
      ran: 0,
      message: "queue empty",
      processed: false,
      terminalStatus: null,
      resultCode: "QUEUE_EMPTY",
      retryable: false,
    });
  }

  const statusPriority: Record<string, number> = {
    FAILED: 4,
    PARTIAL_SUCCESS: 3,
    SUPERSEDED: 2,
    SUCCEEDED: 1,
  };
  const worst = processedJobs.reduce((worstSoFar, job) => {
    const priority = statusPriority[job.terminalStatus ?? ""] ?? 0;
    const worstPriority = statusPriority[worstSoFar.terminalStatus ?? ""] ?? 0;
    return priority > worstPriority ? job : worstSoFar;
  });

  return NextResponse.json({
    ran: processedJobs.length,
    processed: true,
    processedJobs,
    durationMs: Date.now() - startTime,
    terminalStatus: worst.terminalStatus ?? "UNKNOWN",
    resultCode: worst.resultCode ?? "UNKNOWN",
    jobId: worst.jobId,
    retryable: Boolean(worst.retryable),
    correlationId: worst.correlationId ?? null,
    retryScheduled: Boolean(worst.retryScheduled),
    nextJobId: worst.nextJobId ?? null,
    nextJobType: worst.nextJobType ?? null,
    continuationReason: worst.continuationReason ?? null,
    continuationReused: worst.continuationReused ?? null,
    analysisRevision: worst.analysisRevision ?? null,
    workerNotice: "HTTP 200 indicates the worker ran, NOT that the job succeeded. Inspect terminalStatus.",
  });
}
