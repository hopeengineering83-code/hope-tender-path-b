import { NextResponse } from "next/server";
import { logger } from "../../../../lib/observability";
import { requireRole, unauthorizedResponse } from "../../../../lib/auth";
import { completeJob, failJob, rearmDurableStageJob } from "../../../../lib/ai-jobs";
import { classifyStageRetry, isDurableRetryJobType, isSupersededStageFailure } from "../../../../lib/engine/stage-retry-policy";
import { continueSuccessfulAnalysis } from "../../../../lib/ai-jobs/engine-continuation-service";
import { continueSuccessfulEngineToProposal } from "../../../../lib/ai-jobs/proposal-continuation-service";
import { claimJobForCaller } from "../../../../lib/job-claim-policy";
import { getHandler, isTerminalHandlerResult } from "../../../../lib/ai-job-handlers";
import { parseJobTypeFilter, SUPPORTED_JOB_TYPES } from "../../../../lib/job-type-policy";
import { prismaReady } from "../../../../lib/prisma";
import { recordRetryStateForJob, findJobsDueForRetry, rearmJobForRetry } from "../../../../lib/ai-analyze/retry-service";
import { restoreHealthFromDbBounded } from "../../../../lib/ai-provider-health-db";
import { failStuckJobs } from "../../../../lib/ai-jobs";
import { reapStaleQueuedJobs } from "../../../../lib/engine/stale-job-reaper";
import { publicJobFailureMessage } from "../../../../lib/prisma-schema-compatibility";

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
    generationBlockerCode?: string;
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

    // Unattended stuck-job recovery: a worker killed mid-run (Vercel's 60s
    // cap, an uncaught crash) leaves its AiJob row RUNNING forever unless
    // something notices. Previously this only ran lazily (a browser polling
    // that exact job's status endpoint) or manually (an admin visiting
    // /admin/release-stuck-jobs) — neither fires without a human present.
    // Running it here means every automated drain tick (the GitHub Actions
    // cron) also sweeps for and fails stuck jobs, closing the "unattended
    // stuck-job recovery" gap. failStuckJobs is idempotent (WHERE status =
    // 'RUNNING') so this is safe to run on every tick.
    try {
      const recovery = await failStuckJobs();
      if (recovery.recovered > 0) {
        logger.error(`[run-next] Stuck-job recovery failed ${recovery.recovered} job(s): ${recovery.ids.join(", ")}`);
      }
    } catch (err) {
      logger.error(`[run-next] Stuck-job recovery sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Complementary to the RUNNING-job sweep above: a job that was never
    // claimed at all (QUEUED forever) is a different failure mode and is
    // covered by reapStaleQueuedJobs rather than duplicating failStuckJobs'
    // RUNNING-only logic.
    try {
      const reaped = await reapStaleQueuedJobs();
      if (reaped.reaped > 0) {
        logger.error(`[run-next] Stale-queued-job reaper failed ${reaped.reaped} job(s)`);
      }
    } catch (err) {
      logger.error(`[run-next] Stale-queued-job reaper sweep failed: ${err instanceof Error ? err.message : String(err)}`);
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
      // retryCount threaded through so handlers' own classifyStageRetry
      // calls (used for telemetry only — the real retry GATE is this
      // route's catch block below, using claimed.retries directly) report
      // the genuine attempt number instead of always reading undefined/0.
      const result = await handler({
        jobId: claimed.id,
        userId: claimed.userId,
        tenderId: claimed.tenderId,
        input: { ...claimed.input, retryCount: claimed.retries },
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
          // The canonical AI handler performs Vault verification and persists
          // a source-revision-bound Engine job before returning success. Reuse
          // that durable row instead of invoking the historical continuation
          // service and creating a second ENGINE_RUN job whose input is bound
          // only to the analysis hash.
          const automaticEngineJob = result.output?.automaticEngineJob as
            | Record<string, unknown>
            | null
            | undefined;
          if (
            automaticEngineJob &&
            typeof automaticEngineJob === "object" &&
            typeof automaticEngineJob.jobId === "string"
          ) {
            nextJobId = automaticEngineJob.jobId;
            nextJobType = "ENGINE_RUN";
            continuationReused = automaticEngineJob.reusedActiveJob === true;
            analysisRevision = typeof automaticEngineJob.sourceRevision === "string"
              ? automaticEngineJob.sourceRevision
              : undefined;
          } else {
            // Compatibility for an older/custom AI handler that has not yet
            // adopted canonical automatic enqueueing.
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

        let nextJobId: string | undefined;
        let nextJobType: string | undefined;
        let continuationReason: string | undefined;
        let continuationReused: boolean | undefined;
        let analysisRevision: string | undefined;
        let generationBlockerCode: string | undefined;

        if (claimed.jobType === "ENGINE_RUN") {
          try {
            const continuation = await continueSuccessfulEngineToProposal(claimed.id);
            if (continuation.queued) {
              nextJobId = continuation.jobId;
              nextJobType = "PROPOSAL_GENERATION";
              continuationReused = continuation.reused;
              analysisRevision = continuation.analysisRevision;
            } else {
              continuationReason = continuation.reason;
              generationBlockerCode = continuation.blockerCode;
            }
          } catch (error) {
            continuationReason = "PROPOSAL_CONTINUATION_ERROR";
            logger.error("[run-next] Proposal continuation failed after successful engine job", {
              jobId: claimed.id,
              errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
            });
          }
        }

        // Gap 3: after PROPOSAL_GENERATION succeeds, enqueue a DURABLE
        // AUTO_FINALIZE job instead of calling runAutoFinalizeAfterGeneration
        // inline. The durable job runs in its own worker budget (not the
        // request-bound 60s Vercel Hobby limit), is automatically retried by
        // the durable-stage retry policy on transient failure, and is
        // idempotent. No failure falls back to "manual retry" when it can be
        // safely automated.
        if (claimed.jobType === "PROPOSAL_GENERATION") {
          try {
            const { enqueueJob } = await import("../../../../lib/ai-jobs");
            const analysisRevision = typeof claimed.input?.analysisRevision === "string"
              ? claimed.input.analysisRevision
              : null;
            const autoFinalizeJob = await enqueueJob({
              userId: claimed.userId,
              tenderId: claimed.tenderId ?? null,
              jobType: "AUTO_FINALIZE",
              input: {
                tenderId: claimed.tenderId,
                analysisRevision,
                source: "post-proposal-generation",
              },
            });
            nextJobId = autoFinalizeJob.id;
            nextJobType = "AUTO_FINALIZE";
            continuationReused = false;
          } catch (error) {
            continuationReason = "AUTO_FINALIZE_ENQUEUE_ERROR";
            logger.error("[run-next] Failed to enqueue AUTO_FINALIZE after proposal generation", {
              jobId: claimed.id,
              errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
            });
          }
        }

        processedJobs.push({
          jobId: claimed.id,
          jobType: claimed.jobType,
          status: "SUCCEEDED",
          terminalStatus: "SUCCEEDED",
          resultCode: "OK",
          retryable: false,
          nextJobId,
          nextJobType,
          continuationReason,
          continuationReused,
          analysisRevision,
          generationBlockerCode,
        });
      }
    } catch (error) {
      const correlationId = require("crypto").randomUUID().slice(0, 8);
      const message = error instanceof Error ? error.message : String(error);
      // A supersede is an expected, self-healing outcome — the newer revision's
      // job is already queued — so it is reported at warn. Emitting it at error
      // put a benign race at the top of runtime error monitoring and buried
      // real incidents underneath it.
      if (isSupersededStageFailure(message)) {
        logger.warn(`[run-next] Job ${claimed.id} superseded by a newer Engine source revision correlationId=${correlationId}`);
      } else {
        logger.error(`[run-next] Job ${claimed.id} execution failed correlationId=${correlationId}: ${message}`);
      }
      const publicFailure = publicJobFailureMessage(error, correlationId);

      // Durable-stage bounded backoff: EXTRACT_TEXT / VAULT_INGEST /
      // ENGINE_RUN / PROPOSAL_GENERATION failures are classified retryable
      // vs non-retryable (lib/engine/stage-retry-policy.ts) using the SAME
      // policy VAULT_INGEST already computed a blockerCode from. A
      // retryable, budget-remaining failure is re-armed (QUEUED with a
      // future nextAttemptAt, gated by claimJobForCaller) instead of
      // terminally failed — closing the gap where these job types had no
      // automatic recovery path at all (only AI_ANALYZE did, via
      // AiAnalyzeRetryState).
      let retryScheduled = false;
      let stageBlockerCode: string | undefined;
      if (isDurableRetryJobType(claimed.jobType)) {
        const decision = classifyStageRetry(message, claimed.retries);
        stageBlockerCode = decision.blockerCode;
        if (decision.retryable && decision.delayMs !== null) {
          retryScheduled = await rearmDurableStageJob(claimed.id, {
            errorMessage: publicFailure,
            delayMs: decision.delayMs,
          });
        }
      }

      if (!retryScheduled) {
        // Persist only a stable, user-actionable category plus correlation
        // reference. Raw ORM errors remain in server logs; they must never be
        // copied into AiJob.errorMessage because that field is rendered in the
        // authenticated browser UI.
        await failJob(claimed.id, publicFailure);
      }

      processedJobs.push({
        jobId: claimed.id,
        jobType: claimed.jobType,
        status: retryScheduled ? "QUEUED" : "FAILED",
        terminalStatus: retryScheduled ? undefined : "FAILED",
        resultCode: retryScheduled ? "STAGE_RETRY_SCHEDULED" : "JOB_EXECUTION_FAILED",
        correlationId,
        retryable: !retryScheduled,
        retryScheduled,
        generationBlockerCode: stageBlockerCode,
      });
    }

    if (["ENGINE_RUN", "PROPOSAL_GENERATION", "EVALUATOR_SIM", "EXTRACT_TEXT", "AI_ANALYZE", "VAULT_INGEST", "AUTO_FINALIZE"].includes(claimed.jobType)) break;
  }

  if (processedJobs.length === 0) {
    return NextResponse.json({
      ran: 0,
      message: "queue empty",
      processed: false,
      jobId: null,
      jobType: null,
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
    jobType: worst.jobType,
    retryable: Boolean(worst.retryable),
    correlationId: worst.correlationId ?? null,
    retryScheduled: Boolean(worst.retryScheduled),
    nextJobId: worst.nextJobId ?? null,
    nextJobType: worst.nextJobType ?? null,
    continuationReason: worst.continuationReason ?? null,
    continuationReused: worst.continuationReused ?? null,
    analysisRevision: worst.analysisRevision ?? null,
    generationBlockerCode: worst.generationBlockerCode ?? null,
    workerNotice: "HTTP 200 indicates the worker ran, NOT that the job succeeded. Inspect terminalStatus and continuationReason.",
  });
}
