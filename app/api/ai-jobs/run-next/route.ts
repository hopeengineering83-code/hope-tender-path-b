import { NextResponse } from "next/server";
import { logger } from "../../../../lib/observability";
import { requireRole, unauthorizedResponse } from "../../../../lib/auth";
import { completeJob, failJob, rearmDurableStageJob } from "../../../../lib/ai-jobs";
import { classifyStageRetry, isDurableRetryJobType, isSupersededStageFailure } from "../../../../lib/engine/stage-retry-policy";
import { continueSuccessfulAnalysis } from "../../../../lib/ai-jobs/engine-continuation-service";
import { continueSuccessfulEngineToProposal } from "../../../../lib/ai-jobs/proposal-continuation-service";
import { ensureAutoFinalizeContinuationJob } from "../../../../lib/ai-jobs/auto-finalize-continuation-job";
import { claimJobForCaller } from "../../../../lib/job-claim-policy";
import { scheduleRequestScopedWorkerWake } from "../../../../lib/ai-jobs/request-scoped-worker-wake";
import { getHandler, isTerminalHandlerResult } from "../../../../lib/ai-job-handlers";
import { parseJobTypeFilter, SUPPORTED_JOB_TYPES } from "../../../../lib/job-type-policy";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { recordRetryStateForJob, findJobsDueForRetry, rearmJobForRetry } from "../../../../lib/ai-analyze/retry-service";
import { restoreHealthFromDbBounded } from "../../../../lib/ai-provider-health-db";
import { failStuckJobs } from "../../../../lib/ai-jobs";
import { reapStaleQueuedJobs } from "../../../../lib/engine/stale-job-reaper";
import { publicJobFailureMessage } from "../../../../lib/prisma-schema-compatibility";

// A real Pharo-shaped Preview run reaches the source-verified Build Plan only
// after matching and requirement persistence. The former 60s function cap
// killed the request at that exact boundary and left the durable job RUNNING
// forever even though every completed stage had been persisted. Vercel's
// configured runtime supports the longer bounded invocation; keep a generous
// persistence reserve below it and continue to pass an absolute deadline into
// every claimed handler.
export const maxDuration = 300;
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

  const tenderId = searchParams.get("tenderId")?.trim() || undefined;
  const startTime = Date.now();
  const maxRunMs = 240_000;
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

  // DIRECTIVE 5: Request-level absolute deadline. Stop a full minute before
  // the 300s hard cap, and also
  // enforce a MINIMUM_REMAINING_BUDGET before claiming a new job — if less
  // than 10 seconds remain, we stop claiming to ensure every claimed job
  // has enough time to either complete or persist its checkpoint safely.
  const MINIMUM_REMAINING_BUDGET_MS = 10_000;
  const PERSISTENCE_RESERVE_MS = 5_000;
  const absoluteDeadline = startTime + maxRunMs;

  // The stage this invocation is currently draining. It starts as the caller's
  // filter and may advance to a continuation this worker itself enqueued — see
  // the hand-off note at the end of the claim loop.
  let activeJobType = parsedJobType.value;

  while (Date.now() - startTime < maxRunMs) {
    // DIRECTIVE 5: Don't start a new job when insufficient budget remains.
    const remainingMs = absoluteDeadline - Date.now();
    if (remainingMs < MINIMUM_REMAINING_BUDGET_MS) {
      logger.info(`[run-next] Stopping claim loop — only ${remainingMs}ms remaining (minimum ${MINIMUM_REMAINING_BUDGET_MS}ms required)`);
      break;
    }

    const claimed = await claimJobForCaller({
      jobType: activeJobType,
      tenderId,
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

    // DIRECTIVE 5: Pass the remaining time budget (minus persistence reserve)
    // into the handler so it can cooperatively check and checkpoint before
    // the hard deadline. The handler should never start an expensive provider
    // request that cannot safely finish before this budget expires.
    const handlerBudgetMs = Math.max(5_000, remainingMs - PERSISTENCE_RESERVE_MS);

    try {
      const result = await handler({
        jobId: claimed.id,
        userId: claimed.userId,
        tenderId: claimed.tenderId,
        input: { ...claimed.input, retryCount: claimed.retries, deadlineMs: handlerBudgetMs, absoluteDeadline },
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
          // FIX 4: The dead `automaticEngineJob` continuation branch has been
          // removed entirely. The previous code branched on
          // `result.output?.automaticEngineJob` and, if present, advanced to
          // `nextJobType = "ENGINE_RUN"` — an automatic Engine continuation
          // that contradicts the manual workflow contract. Although the
          // canonical AI handler never returned this field, the branch was a
          // latent footgun: any future handler (or a malicious test fixture)
          // returning `output.automaticEngineJob` would have triggered
          // automatic Engine enqueue.
          //
          // After successful AI_ANALYZE, the only valid next Engine state is
          // MANUAL_ENGINE_REQUIRED. continueSuccessfulAnalysis always returns
          // that — it NEVER creates or enqueues an Engine job. The user must
          // manually click Run Engine via POST /api/tenders/:id/engine.
          //
          // Defence in depth: if a handler ever returns `automaticEngineJob`
          // anyway, ignore it. Log a warning so the contract violation is
          // visible to operators.
          const maliciousAutomaticEngineJob = result.output?.automaticEngineJob as
            | Record<string, unknown>
            | null
            | undefined;
          if (maliciousAutomaticEngineJob && typeof maliciousAutomaticEngineJob === "object") {
            logger.error(
              `[run-next] AI_ANALYZE handler returned output.automaticEngineJob — contract violation. Ignoring. job=${claimed.id}`,
            );
          }
          const continuation = await continueSuccessfulAnalysis(claimed.id);
          continuationReason = continuation.reason;
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
        // Check if this is a transient retry result (e.g. Engine interrupted
        // by Vercel function timeout). If so, leave the job RUNNING so the
        // next worker invocation can resume it.
        const isTransientRetry = Boolean(
          result &&
            typeof result === "object" &&
            "retryable" in result &&
            (result as Record<string, unknown>).retryable === true &&
            "code" in result &&
            typeof (result as Record<string, unknown>).code === "string" &&
            String((result as Record<string, unknown>).code).includes("TRANSIENT_RETRY"),
        );

        if (isTransientRetry) {
          // FIX 5: Durable Engine checkpoint state machine. Previously the
          // worker left the job RUNNING, but `claimJobForCaller` only claims
          // QUEUED rows — so a RUNNING transient-retry job could never be
          // resumed by the next normal worker invocation. It relied on
          // `failStuckJobs()` after ~180s, which is not a real resume path.
          //
          // Now: atomically re-arm the job back to QUEUED with a bounded
          // `nextAttemptAt` (exponential backoff) and an incremented retry
          // counter. The next worker invocation will claim it via the normal
          // path and continue from the last safely persisted checkpoint.
          //
          // Retry budget: 8 attempts. After the budget is exhausted, the job
          // transitions to FAILED terminal state with an actionable safe
          // reason — no infinite loop.
          const MAX_TRANSIENT_RETRIES = 8;
          const currentRetries = (claimed.retries ?? 0) + 1;
          const resultCode = String((result as Record<string, unknown>).code ?? "");
          if (currentRetries > MAX_TRANSIENT_RETRIES) {
            // Budget exhausted → terminal FAILED.
            await failJob(
              claimed.id,
              `Transient retry budget exhausted after ${MAX_TRANSIENT_RETRIES} attempts (last code: ${resultCode})`,
            ).catch((failErr: unknown) => {
              logger.error(`[run-next] Failed to mark job ${claimed.id} as FAILED after retry budget exhaustion: ${failErr instanceof Error ? failErr.message : String(failErr)}`);
            });
            processedJobs.push({
              jobId: claimed.id,
              jobType: claimed.jobType,
              status: "FAILED",
              terminalStatus: "FAILED",
              resultCode: "TRANSIENT_RETRY_BUDGET_EXHAUSTED",
              retryable: false,
              correlationId: undefined,
              retryScheduled: false,
              nextJobId: undefined,
              nextJobType: undefined,
              continuationReason: `Retry budget exhausted after ${MAX_TRANSIENT_RETRIES} transient failures`,
              continuationReused: undefined,
              analysisRevision: undefined,
            });
          } else {
            // Re-arm QUEUED with bounded backoff: 2^attempt seconds, capped at 60s.
            // attempt 1 → 2s, 2 → 4s, 3 → 8s, 4 → 16s, 5 → 32s, 6 → 60s, 7 → 60s, 8 → 60s.
            const backoffSeconds = Math.min(60, Math.pow(2, currentRetries));
            const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);
            await prisma.aiJob.update({
              where: { id: claimed.id },
              data: {
                status: "QUEUED",
                // Reset startedAt so failStuckJobs's RUNNING-only sweep doesn't
                // re-fail the re-armed job before nextAttemptAt elapses.
                startedAt: null,
                // Persist the last failure category so the next worker can
                // surface it in diagnostics.
                errorMessage: `Transient retry ${currentRetries}/${MAX_TRANSIENT_RETRIES}: ${resultCode}`,
                nextAttemptAt,
                retries: currentRetries,
                // Release the claim/lease so the next worker can claim it.
                leaseOwner: null,
                leaseExpiresAt: null,
              },
            }).catch((rearmErr: unknown) => {
              logger.error(`[run-next] Failed to re-arm transient-retry job ${claimed.id}: ${rearmErr instanceof Error ? rearmErr.message : String(rearmErr)}`);
            });
            processedJobs.push({
              jobId: claimed.id,
              jobType: claimed.jobType,
              status: "QUEUED",
              terminalStatus: undefined,
              resultCode,
              retryable: true,
              correlationId: undefined,
              retryScheduled: true,
              nextJobId: undefined,
              nextJobType: undefined,
              continuationReason: `Transient retry ${currentRetries}/${MAX_TRANSIENT_RETRIES} — re-armed QUEUED with ${backoffSeconds}s backoff`,
              continuationReused: undefined,
              analysisRevision: undefined,
            });
          }
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
            } else if (continuation.state === "ALREADY_SUCCEEDED") {
              // Generation already succeeded for this exact analysis revision,
              // so the stage that still has to run is the one after it.
              //
              // This is the owner's real history: the first run generated the
              // proposal and then stalled at AUTO_FINALIZE, and the rerun
              // resolved the deterministic proposal runId back to that
              // SUCCEEDED row. The continuation used to answer "queued", the
              // worker went looking for a claimable PROPOSAL_GENERATION job,
              // found none — a SUCCEEDED row is not claimable — and the whole
              // pipeline stopped with nothing logged as wrong.
              //
              // Re-running generation to manufacture something claimable would
              // write a duplicate proposal version, duplicate CVs and
              // duplicate documents for work already correctly done.
              analysisRevision = continuation.analysisRevision;
              continuationReused = true;
              const finalize = await ensureAutoFinalizeContinuationJob({
                tenderId: claimed.tenderId!,
                userId: claimed.userId,
                analysisRevision: continuation.analysisRevision,
                parentJobId: continuation.jobId,
              });
              if (finalize.claimable) {
                nextJobId = finalize.jobId;
                nextJobType = "AUTO_FINALIZE";
                continuationReason = "PROPOSAL_ALREADY_SUCCEEDED_ADVANCED_TO_AUTO_FINALIZE";
              } else if (finalize.state === "ALREADY_SUCCEEDED") {
                // Finalization already passed its own readiness gate for this
                // revision. The package exists; rebuilding it would duplicate
                // a reconciled ZIP.
                continuationReason = "PIPELINE_ALREADY_COMPLETE";
              } else {
                continuationReason = `AUTO_FINALIZE_${finalize.state}`;
              }
              logger.info("[run-next] Proposal already generated for this revision; advancing downstream", {
                jobId: claimed.id,
                proposalJobId: continuation.jobId,
                autoFinalizeJobId: finalize.jobId,
                autoFinalizeState: finalize.state,
              });
            } else if (continuation.state === "BLOCKED") {
              continuationReason = continuation.reason;
              generationBlockerCode = continuation.blockerCode;
            } else {
              // ALREADY_RUNNING or NOT_CLAIMABLE: a real row exists that this
              // invocation must not claim, re-arm or duplicate. Recorded as the
              // reason rather than as a generation blocker — nothing about the
              // tender is wrong.
              continuationReason = continuation.reason;
              analysisRevision = continuation.analysisRevision;
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
        //
        // "Idempotent" was true of the handler and false of the enqueue. This
        // was a bare create, so every proposal success minted another
        // AUTO_FINALIZE row for the same tender and revision — two finalize
        // jobs, each able to reconcile and package independently. The stage it
        // follows had a deterministic runId guarding exactly that; this one now
        // does too, enforced by the unique index rather than by a check two
        // concurrent workers could both pass.
        if (claimed.jobType === "PROPOSAL_GENERATION") {
          try {
            const revision = typeof claimed.input?.analysisRevision === "string"
              ? claimed.input.analysisRevision
              : null;
            if (!claimed.tenderId || !revision) {
              // Without a tender and a revision there is no identity to be
              // idempotent about, and a finalize job that cannot be located
              // again is the duplicate this guards against.
              continuationReason = "AUTO_FINALIZE_IDENTITY_MISSING";
              logger.error("[run-next] Cannot enqueue AUTO_FINALIZE without a tender and analysis revision", {
                jobId: claimed.id,
                hasTender: Boolean(claimed.tenderId),
                hasRevision: Boolean(revision),
              });
            } else {
              const finalize = await ensureAutoFinalizeContinuationJob({
                tenderId: claimed.tenderId,
                userId: claimed.userId,
                analysisRevision: revision,
                parentJobId: claimed.id,
              });
              analysisRevision = revision;
              continuationReused = finalize.reused;
              if (finalize.claimable) {
                nextJobId = finalize.jobId;
                nextJobType = "AUTO_FINALIZE";
              } else if (finalize.state === "ALREADY_SUCCEEDED") {
                continuationReason = "PIPELINE_ALREADY_COMPLETE";
              } else {
                continuationReason = `AUTO_FINALIZE_${finalize.state}`;
              }
            }
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
        } // end of else (non-transient result)
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

    if (["ENGINE_RUN", "PROPOSAL_GENERATION", "EVALUATOR_SIM", "EXTRACT_TEXT", "AI_ANALYZE", "VAULT_INGEST", "AUTO_FINALIZE"].includes(claimed.jobType)) {
      // Carry a continuation forward inside THIS invocation while the budget
      // allows it, rather than depending on the HTTP hand-off below.
      //
      // That hand-off is a self-call: this worker POSTs its own deployment's
      // /api/ai-jobs/dispatch, which POSTs its own /api/ai-jobs/run-next. Every
      // stage therefore adds two hops to a single request chain, and the
      // platform refuses a chain that keeps re-entering the same deployment —
      // Vercel answers 508 INFINITE_LOOP_DETECTED. Observed end to end on the
      // exact head: Run Engine → ENGINE_RUN → PROPOSAL_GENERATION all
      // succeeded, then the AUTO_FINALIZE nudge came back 508, the job stayed
      // QUEUED, and nothing was left to claim it. Generation had finished 46
      // seconds into a 300-second budget, so the invocation that gave up still
      // had roughly four minutes it never used.
      //
      // Nothing else would have run that job. No cron drains the durable queue
      // on this plan, no UI control nudges the worker, and the tender page
      // polls read-only endpoints. Since the owner contract requires every
      // stage after Run Engine to continue with no click and no browser open,
      // a hand-off whose success depends on a chain depth the platform may
      // refuse is not a continuation at all.
      //
      // Authority is unchanged. Only a job this worker already enqueued can be
      // claimed; the two manual gates are not continuation types and cannot be
      // reached from here; the transactional claim remains the
      // duplicate-execution guard; and the loop's existing budget floor still
      // decides whether there is room, so no stage starts without time to
      // finish or checkpoint.
      const justProcessed = processedJobs[processedJobs.length - 1];
      const continuation = justProcessed?.jobId === claimed.id ? justProcessed.nextJobType : undefined;
      const roomForContinuation = absoluteDeadline - Date.now() >= MINIMUM_REMAINING_BUDGET_MS;
      if ((continuation === "PROPOSAL_GENERATION" || continuation === "AUTO_FINALIZE") && roomForContinuation) {
        logger.info("[run-next] Continuing to the stage this invocation enqueued", {
          fromJobType: claimed.jobType,
          continuation,
          remainingMs: absoluteDeadline - Date.now(),
        });
        activeJobType = continuation;
        continue;
      }
      break;
    }
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

  // Hand the pipeline on to itself when this invocation could not.
  //
  // The claim loop used to be pinned to one jobType for its whole run — the
  // wake that started it set `jobType=ENGINE_RUN`, so a PROPOSAL_GENERATION job
  // this invocation just enqueued could never be claimed by this invocation.
  // Nothing else was waking it either: the request-scoped wakes cover
  // EXTRACT_TEXT, VAULT_INGEST and ENGINE_RUN only, and the drain cron fires
  // from the default branch, so on a Preview deployment there was no driver at
  // all.
  //
  // The visible result was a workflow that reported "Processing automatically —
  // the workflow is running" while sitting on "No documents have been generated
  // yet" indefinitely, because Run Engine genuinely succeeded and the stage
  // after it was never claimed by anyone.
  //
  // The loop now advances to that stage itself while budget remains, so this
  // wake is the remaining case: the invocation ran out of time and a real
  // hand-off to a fresh one is needed. A stage this invocation already ran is
  // excluded — nudging it would find nothing to claim, and when the platform
  // refuses the self-call the rejection is logged as though a finished stage
  // were still queued, which is exactly the false alarm that made a genuinely
  // stuck pipeline hard to see.
  //
  // This carries the owner's original authority forward rather than creating
  // any: only a continuation the worker already enqueued can be claimed, and
  // the chain terminates on its own when a stage produces no successor.
  const stagesRunHere = new Set(processedJobs.map((job) => job.jobType));
  const continuationJobType = processedJobs
    .map((job) => job.nextJobType)
    .find((type): type is "PROPOSAL_GENERATION" | "AUTO_FINALIZE" =>
      (type === "PROPOSAL_GENERATION" || type === "AUTO_FINALIZE") && !stagesRunHere.has(type));
  if (continuationJobType) {
    scheduleRequestScopedWorkerWake(req, continuationJobType);
  }

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
