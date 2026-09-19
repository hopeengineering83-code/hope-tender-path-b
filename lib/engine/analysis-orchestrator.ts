/**
 * Analysis Orchestrator — coordinates AI analysis execution through the durable job service.
 *
 * This module unifies both streaming and non-streaming analysis paths by providing
 * a single execution engine that manages:
 * - Job creation and resumption
 * - Chunk-based analysis with provider fallback
 * - Progress tracking and callbacks
 * - Result merging and promotion
 * - Error handling and recovery
 *
 * The orchestrator uses AnalysisJobService as the authoritative state manager,
 * eliminating duplicate job logic from the HTTP route.
 */

import { prisma } from "../prisma";
import {
  analyzeWithAI,
  type AnalysisWithMeta,
  type AIAnalysisResult,
} from "../ai";
// createAnalysisJob import removed — the orchestrator must NEVER create new AI_ANALYZE jobs.
import { finalizeJob, verifyAnalysisSnapshot } from "../ai-jobs/analysis-job-service";
import { ANALYSIS_SUPERSEDED_STATUS } from "../ai-analyze-promotion";
import { buildTenderAnalysisContent, computeAnalysisContentHash } from "./tender-analysis-content";
import { upsertAnalyzeChunkSucceeded, upsertAnalyzeChunkFailed, getCompletedChunkResults } from "../ai-analyze-checkpoints";
import { getMinCooldownExpiryMs } from "../ai-provider-health";
import { restoreHealthFromDbBounded, persistAllHealthToDbBounded } from "../ai-provider-health-db";
import { logger } from "../observability";
import { getExtractedRequirementCount } from "./analysis-result-metrics";

export type AnalysisOrchestrationOptions = {
  force?: boolean;
  deadlineMs?: number;
  onProgress?: (event: AnalysisProgressEvent) => void | Promise<void>;
  onChunkStart?: (info: { chunkIndex: number; totalChunks: number }) => void | Promise<void>;
  onChunkComplete?: (info: { chunkIndex: number; totalChunks: number; result: AIAnalysisResult; provider?: string | null }) => void | Promise<void>;
  onChunkFailure?: (info: { chunkIndex: number; totalChunks: number; errorMessage: string; provider?: string | null }) => void | Promise<void>;
  /**
   * MANDATORY. The orchestrator loads THIS existing job and verifies its
   * manual authority. It must NEVER call createAnalysisJob() — only the
   * manual route POST /api/tenders/:id/manual-ai-analyze creates jobs.
   */
  existingJobId: string;
};

/**
 * Thrown (and persisted as a terminal SUPERSEDED job) when the tender's
 * canonical analysis input no longer matches the revision the manual AI Analyze
 * click authorized. Callers must treat this as a non-success terminal outcome:
 * no provider spend, no promotion, no Engine unlock.
 */
export const ANALYSIS_SOURCE_DRIFT_ERROR = "ANALYSIS_SOURCE_DRIFT" as const;

/**
 * Terminal status written for a run whose authorized source revision drifted.
 * Deliberately NOT "SUCCEEDED"/"PARTIAL_SUCCESS": a superseded run never
 * promoted canonical data, so it must never claim a success state. Re-exported
 * from the promotion module, which owns the invariant.
 */
export { ANALYSIS_SUPERSEDED_STATUS };

/**
 * Compare the CURRENT canonical analysis input against the revision the job was
 * authorized for. Returns a machine-readable drift reason, or null when the
 * current sources are byte-identical to the authorized revision.
 *
 * Two independent checks, both fail-closed:
 *  1. `analysisInputHash` equality — the exact bytes that will be sent to the
 *     provider must hash to the value frozen at manual-click time.
 *  2. Canonical snapshot verification — file set, per-file extracted-text
 *     integrity, and stored hash. A missing/legacy/malformed snapshot is
 *     drift, never a soft pass.
 */
async function resolvePreProviderDriftReason(params: {
  jobId: string;
  tenderId: string;
  userId: string;
  authorizedHash: string | null;
  currentHash: string;
}): Promise<string | null> {
  const { jobId, tenderId, userId, authorizedHash, currentHash } = params;

  // A job with no authorized hash was never bound to a source revision, so
  // nothing proves the provider would receive what the user approved.
  if (!authorizedHash) return "MISSING_AUTHORIZED_ANALYSIS_INPUT_HASH";
  if (authorizedHash !== currentHash) return "ANALYSIS_INPUT_HASH_DRIFT";

  const snapshotCheck = await verifyAnalysisSnapshot(jobId, tenderId, userId).catch(() => ({
    valid: false,
    superseded: true,
    reason: "SNAPSHOT_VERIFY_ERROR",
  }));
  if (!snapshotCheck.valid || snapshotCheck.superseded) {
    return snapshotCheck.reason ?? "SNAPSHOT_INVALID";
  }

  return null;
}

/**
 * Persist the terminal superseded state for a drifted run. Best-effort by
 * design: if this write fails the orchestrator still throws, so the worker's
 * own error path marks the job FAILED — also fail-closed.
 */
async function markAnalysisSuperseded(jobId: string, reason: string): Promise<void> {
  await prisma.aiJob
    .update({
      where: { id: jobId },
      data: {
        status: ANALYSIS_SUPERSEDED_STATUS,
        finishedAt: new Date(),
        errorMessage: `${ANALYSIS_SOURCE_DRIFT_ERROR}: ${reason} — tender sources changed after this analysis was authorized. Run AI Analyze again.`,
      },
    })
    .catch((err) => {
      logger.error("[orchestrator] Failed to persist SUPERSEDED status for drifted analysis", {
        jobId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

export type AnalysisProgressEvent = {
  phase: "preparing" | "analyzing" | "merging" | "promoting" | "complete";
  status?: string;
  message?: string;
  chunk?: number;
  totalChunks?: number;
  resumedFromChunk?: number;
};

export type AnalysisOrchestrationResult = {
  jobId: string;
  success: boolean;
  analysisSource: "AI" | "PARTIAL_AI";
  requirementCount: number;
  isPartial: boolean;
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  analysisProvider?: string | null;
  errorMessage?: string;
};

/**
 * Execute complete analysis for a tender, coordinating through the durable job service.
 *
 * Handles:
 * - Job creation or resumption from previous chunks
 * - Chunk-based AI analysis with provider fallback
 * - Progress callbacks for streaming/UI updates
 * - Result merging and canonical promotion
 * - Error categorization and fallback to regex
 *
 * @param tenderId Tender to analyze
 * @param userId User performing analysis
 * @param options Configuration for analysis execution
 * @returns Analysis result with job ID and status
 */
export async function executeAnalysis(
  tenderId: string,
  userId: string,
  options: AnalysisOrchestrationOptions,
): Promise<AnalysisOrchestrationResult> {
  const {
    force = false,
    deadlineMs = 48000,
    onProgress,
    onChunkStart,
    onChunkComplete,
    onChunkFailure,
    existingJobId,
  } = options;

  // Content hash that keys the durable AiAnalyzeChunk rows.
  let checkpointHash: string | null = null;

  // Phase: Preparing
  await onProgress?.({
    phase: "preparing",
    message: "Preparing tender content for analysis…",
  });

  // DIRECTIVE 3: existingJobId is MANDATORY. The orchestrator must NEVER
  // call createAnalysisJob() — only the manual route has that authority.
  if (!existingJobId) {
    throw new Error("EXISTING_JOB_ID_REQUIRED: executeAnalysis requires an existing manually-authorized jobId");
  }

  // Load the existing job — do NOT create a new one.
  const existingJob = await prisma.aiJob.findFirst({
    where: { id: existingJobId, tenderId, userId, jobType: "AI_ANALYZE" },
    select: { id: true, analysisInputHash: true, input: true },
  });
  if (!existingJob) {
    throw new Error("JOB_NOT_FOUND: executeAnalysis could not find the specified existing AI_ANALYZE job");
  }
  // Verify the existing job has valid manual authority.
  let existingInput: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(existingJob.input ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existingInput = parsed as Record<string, unknown>;
    }
  } catch { /* treat as invalid */ }
  if (
    existingInput.manualRequested !== true ||
    existingInput.source !== "manual-ai-analyze" ||
    typeof existingInput.actorUserId !== "string" ||
    existingInput.actorUserId !== userId
  ) {
    throw new Error("MANUAL_AUTHORITY_INVALID: existing job lacks valid manual authority for this user");
  }
  const jobId = existingJob.id;
  const snapshot = (existingInput as any)?.snapshot;
  const totalChunks = snapshot?.totalChunks ?? 0;

  // Load existing progress if resuming
  let startFromChunk = 0;
  let previousChunkResults: Array<{ index: number; result: AIAnalysisResult; provider?: string | null }> = [];

  if (!force) {
    const job = await prisma.aiJob.findUnique({
      where: { id: jobId },
      include: { analyzeChunks: true },
    });

    if (job?.output) {
      try {
        const parsed = JSON.parse(job.output);
        if (parsed.chunkResults && Array.isArray(parsed.chunkResults)) {
          previousChunkResults = parsed.chunkResults.filter(
            (r: any) => r.index !== undefined && r.result !== undefined
          );
          startFromChunk = previousChunkResults.length > 0 ? previousChunkResults.length : (parsed.completedChunks ?? 0);
        }
      } catch {
        // If output can't be parsed, start fresh
      }
    }
  }

  const resumedFromChunk = startFromChunk;
  await onProgress?.({
    phase: "analyzing",
    chunk: startFromChunk + 1,
    totalChunks,
    resumedFromChunk,
    message:
      startFromChunk > 0
        ? `Resuming at chunk ${startFromChunk + 1} of ${totalChunks}…`
        : `Analyzing chunk 1 of ${totalChunks}…`,
  });

  // Phase: Analyzing
  const deadlineAt = Date.now() + deadlineMs;

  // Wrap progress callbacks for analyzeWithAI
  const wrappedOnChunkStart = async (info: { chunkIndex: number; totalChunks: number }) => {
    await onChunkStart?.(info);
    await onProgress?.({
      phase: "analyzing",
      chunk: info.chunkIndex + 1,
      totalChunks: info.totalChunks,
      message: `Starting chunk ${info.chunkIndex + 1} of ${info.totalChunks}…`,
    });
  };

  const wrappedOnChunkComplete = async (snapshot: any) => {
    const info = {
      chunkIndex: snapshot.chunkIndex ?? 0,
      totalChunks: snapshot.totalChunks,
      result: snapshot.result,
      provider: snapshot.provider,
    };
    // Persist the completed chunk to the durable AiAnalyzeChunk row so
    // finalizeJob() sees it as SUCCEEDED and can promote canonical data.
    if (checkpointHash && typeof snapshot.chunkIndex === "number" && snapshot.result) {
      await upsertAnalyzeChunkSucceeded({
        tenderId,
        userId,
        contentHash: checkpointHash,
        chunkIndex: snapshot.chunkIndex,
        totalChunks: snapshot.totalChunks,
        result: snapshot.result,
        provider: snapshot.provider ?? null,
      }).catch((e) => {
        logger.error("[orchestrator] chunk SUCCEEDED checkpoint persist failed", { error: e instanceof Error ? e.message : String(e) });
      });
    }
    await onChunkComplete?.(info);
    await onProgress?.({
      phase: "analyzing",
      chunk: (snapshot.chunkIndex ?? 0) + 1,
      totalChunks: snapshot.totalChunks,
      message: `Completed chunk ${(snapshot.chunkIndex ?? 0) + 1} of ${snapshot.totalChunks}${snapshot.provider ? ` using ${snapshot.provider}` : ""}`,
    });
  };

  const wrappedOnChunkFailure = async (info: {
    chunkIndex: number;
    totalChunks: number;
    errorMessage: string;
    provider?: string | null;
  }) => {
    if (checkpointHash && typeof info.chunkIndex === "number") {
      await upsertAnalyzeChunkFailed({
        tenderId,
        userId,
        contentHash: checkpointHash,
        chunkIndex: info.chunkIndex,
        totalChunks: info.totalChunks,
        errorMessage: info.errorMessage,
        provider: info.provider ?? null,
      }).catch((e) => {
        logger.error("[orchestrator] chunk FAILED checkpoint persist failed", { error: e instanceof Error ? e.message : String(e) });
      });
    }
    await onChunkFailure?.(info);
    await onProgress?.({
      phase: "analyzing",
      chunk: info.chunkIndex + 1,
      totalChunks: info.totalChunks,
      message: `Chunk ${info.chunkIndex + 1} failed: ${info.errorMessage.slice(0, 100)}`,
    });
  };

  // Fetch tender for access check
  const tenderForAccess = await prisma.tender.findUnique({
    where: { id: tenderId },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!tenderForAccess || tenderForAccess.userId !== userId) {
    throw new Error("Tender not found or access denied");
  }

  // Fetch tender with fields needed for content builder
  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    select: {
      title: true,
      description: true,
      intakeSummary: true,
      // ACTIVE files only — the content hash (used here as the durable
      // chunk-checkpoint key) MUST match the canonical hash the route/createAnalysisJob
      // persist and the snapshot/gate recompute (all filter deletionStatus === "ACTIVE").
      // Hashing soft-deleted files would key this run's chunks under a hash that
      // does not match the promoted analysisInputHash, breaking resume + state.
      files: {
        where: { deletionStatus: "ACTIVE" },
        select: {
          id: true,
          originalFileName: true,
          extractedText: true,
          classification: true,
          createdAt: true,
        },
      },
    },
  });

  if (!tender) {
    throw new Error("Tender not found");
  }

  // Load company if exists for shared builder input (user has a 1:1 company relation).
  // UNBOUNDED, unordered — must match the vault-document set the snapshot/gate
  // recompute the hash from; a `take`/`orderBy` cap would diverge the chunk-key hash.
  const companyRecord = await prisma.company.findUnique({
    where: { userId },
    select: {
      documents: {
        select: {
          category: true,
          originalFileName: true,
          extractedText: true,
        },
      },
    },
  }).catch(() => null);

  let company: Parameters<typeof buildTenderAnalysisContent>[1] | undefined;
  if (companyRecord?.documents?.length) {
    company = companyRecord;
  }

  // Use Stage 1 shared builder for deterministic content
  const tenderContent = buildTenderAnalysisContent(tender, company);
  const contentHash = computeAnalysisContentHash(tenderContent);

  // ─── PRE-PROVIDER SOURCE-DRIFT BLOCK ───────────────────────────────────
  // The manual click froze an exact source revision onto the job:
  // `analysisInputHash` plus the immutable CanonicalAnalysisSnapshot. Between
  // that click and this worker invocation the sources can change — the tender
  // title/description/intake notes, a file's extracted text, an added or
  // deleted ACTIVE file, or a Company Vault document that feeds the canonical
  // builder.
  //
  // Recompute the canonical input from the CURRENT sources with the SAME
  // builder and require exact equality before ANY provider request. On drift we
  // must not spend provider tokens, must not continue this job's checkpoints,
  // must not promote, and must not unlock Engine. The run fails closed as
  // superseded and the user has to issue a new explicit AI Analyze for the new
  // revision.
  //
  // This runs BEFORE `checkpointHash` is armed so a drifted revision can never
  // write AiAnalyzeChunk checkpoint rows under a hash the job was not
  // authorized for.
  const driftReason = await resolvePreProviderDriftReason({
    jobId,
    tenderId,
    userId,
    authorizedHash: existingJob.analysisInputHash,
    currentHash: contentHash,
  });
  if (driftReason) {
    await markAnalysisSuperseded(jobId, driftReason);
    await onProgress?.({
      phase: "complete",
      status: "SUPERSEDED",
      message: `Tender sources changed since AI Analyze was authorized (${driftReason}). Run AI Analyze again.`,
    });
    throw new Error(`${ANALYSIS_SOURCE_DRIFT_ERROR}: ${driftReason}`);
  }

  // Only once the revision is proven identical is a short/empty input a genuine
  // extraction problem. Checked after the drift block so that deleting the last
  // authorized source file is reported as drift (terminal, superseded) rather
  // than as "extraction not ready" (which would leave the job resumable against
  // a revision the user never authorized).
  if (!tenderContent || tenderContent.length < 100) {
    throw new Error("Tender extraction not ready or content too short");
  }

  // Enable durable per-chunk checkpoint persistence only after the current
  // sources are proven identical to the authorized revision.
  checkpointHash = contentHash;

  // RESUME from the durable checkpoints — the source of truth for "where it
  // left off". A re-armed job (or even a fresh job row with the same content
  // hash) continues from the last SUCCEEDED chunk, so when providers recover
  // only the remaining chunks are analyzed. analyzeWithAI skips any chunk
  // present in previousChunkResults (indexed), so we pass them and reset
  // startFromChunk to 0.
  if (!force) {
    const durableCompleted = await getCompletedChunkResults(tenderId, userId, contentHash).catch(() => []);
    if (durableCompleted.length > previousChunkResults.length) {
      previousChunkResults = durableCompleted;
      startFromChunk = 0;
    }
  }

  // Restore durable provider health before starting the analysis deadline so a
  // slow ProviderHealthSnapshot read cannot consume the worker's AI budget.
  const healthRestore = await restoreHealthFromDbBounded(2_000);
  if (healthRestore.warning) {
    logger.warn("[orchestrator] Provider health restore warning before durable AI Analyze", { warning: healthRestore.warning });
  }

  // Execute analysis through AI system
  let analysisMeta: AnalysisWithMeta | null = null;
  let analysisProvider: string | null = null;
  let analysisSource: "AI" | "PARTIAL_AI" = "AI";
  let errorMessage: string | undefined;

  try {
    analysisMeta = await analyzeWithAI(tenderContent, {
      deadlineAt,
      startFromChunk,
      previousChunkResults,
      onChunkStart: wrappedOnChunkStart,
      onChunkComplete: wrappedOnChunkComplete,
      onChunkFailure: wrappedOnChunkFailure,
    });

    // Determine provider from analysis
    const providers = analysisMeta.chunkProviders.filter((p): p is string => p !== null);
    analysisProvider = providers[0] ?? null;

    if (analysisMeta.isPartial) {
      analysisSource = "PARTIAL_AI";
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Analysis failed";
    errorMessage = msg;
    // Preserve any partial progress made before failure
    const chunkProviders: Array<string | null> = Array(totalChunks).fill(null);
    for (const prev of previousChunkResults) {
      if (Number.isInteger(prev.index) && prev.index >= 0 && prev.index < totalChunks) {
        chunkProviders[prev.index] = prev.provider ?? null;
      }
    }
    analysisMeta = {
      result: { summary: "", requirements: [], exactFileNaming: [], exactFileOrder: [], evaluationMethodology: "", submissionNotes: "" },
      isPartial: true,
      totalChunks,
      completedChunks: previousChunkResults.length,
      failedChunks: totalChunks - previousChunkResults.length,
      skippedChunks: 0,
      chunkProviders,
      chunkResults: previousChunkResults,
    };
  } finally {
    // Best-effort only and after job output/status persistence: provider-health
    // persistence must never delay or change the AI Analyze terminal outcome.
    void persistAllHealthToDbBounded(1_500).catch((err) => {
      logger.warn("[orchestrator] Provider health persistence failed after durable AI Analyze", { error: err instanceof Error ? err.message : String(err) });
    });
  }

  // Phase: Merging (implicit in analyzeWithAI)
  await onProgress?.({
    phase: "merging",
    message: "Merging analysis results…",
  });

  // Phase: Promoting
  await onProgress?.({
    phase: "promoting",
    message: "Promoting requirements to canonical…",
  });

  // Update job with analysis results.
  //
  // CRITICAL: executeAnalysis must NEVER write SUCCEEDED. SUCCEEDED means
  // "canonical requirements + canonical tender metadata have been promoted",
  // and promotion happens ONLY in finalizeJob(). On a full AI success we
  // therefore leave the job RUNNING (output persisted for resume) so the
  // caller's finalizer can promote and then set SUCCEEDED. A partial run, an
  // error, or a fallback gets a terminal PARTIAL_SUCCESS (any progress) or
  // FAILED (no progress) here so downstream gates keep blocking generation,
  // export, and the final ZIP.
  if (analysisMeta) {
    const completed = analysisMeta.completedChunks ?? 0;
    const fullAiSuccess = !errorMessage && !analysisMeta.isPartial;
    const interimStatus: "RUNNING" | "PARTIAL_SUCCESS" | "FAILED" = fullAiSuccess
      ? "RUNNING"
      : completed > 0
        ? "PARTIAL_SUCCESS"
        : "FAILED";
    // When the run stopped short, surface the min provider-cooldown expiry so
    // the UI can auto-retry exactly when providers become available again. Null
    // on full success (nothing to retry) and when no provider is cooling down
    // (e.g. no provider configured — a non-recoverable config issue).
    const providerRetryAfterMs = fullAiSuccess ? null : getMinCooldownExpiryMs();
    await prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: interimStatus,
        // Only stamp finishedAt on a terminal interim status; a full success is
        // not finished until the finalizer promotes.
        ...(interimStatus === "RUNNING" ? {} : { finishedAt: new Date() }),
        output: JSON.stringify({
          isPartial: analysisMeta.isPartial,
          totalChunks: analysisMeta.totalChunks,
          completedChunks: analysisMeta.completedChunks,
          failedChunks: analysisMeta.failedChunks,
          skippedChunks: analysisMeta.skippedChunks,
          chunkProviders: analysisMeta.chunkProviders,
          chunkResults: analysisMeta.chunkResults,
          contentHash,
          analysisSource,
          result: analysisMeta.result,
          providerRetryAfterMs,
          resumableJobId: completed > 0 ? jobId : null,
        }),
        errorMessage,
      },
    }).catch((err) => {
      logger.error(`[orchestrator] Failed to update job ${jobId} status`, { error: err instanceof Error ? err.message : String(err) });
    });
  }

  // Phase: Complete
  const requirementCount = getExtractedRequirementCount(analysisMeta?.result);
  await onProgress?.({
    phase: "complete",
    status: analysisMeta?.isPartial ? "PARTIAL" : "SUCCESS",
    message: `Analysis complete — ${requirementCount} requirements extracted`,
  });

  return {
    jobId,
    success: !errorMessage && !analysisMeta?.isPartial,
    analysisSource,
    requirementCount,
    isPartial: analysisMeta?.isPartial ?? false,
    totalChunks: analysisMeta?.totalChunks ?? totalChunks,
    completedChunks: analysisMeta?.completedChunks ?? 0,
    failedChunks: analysisMeta?.failedChunks ?? 0,
    analysisProvider,
    errorMessage,
  };
}

/**
 * Finalize a completed analysis job by promoting requirements to canonical.
 * This is called after the user approves the analysis or after async processing.
 *
 * @param jobId Job to finalize
 * @param userId User owning the job
 * @returns Finalization status
 */
export async function finalizeAnalysisJob(jobId: string, userId: string) {
  return finalizeJob(jobId, userId);
}
