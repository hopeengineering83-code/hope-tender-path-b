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
import { createAnalysisJob, finalizeJob } from "../ai-jobs/analysis-job-service";
import type { AnalysisJobCreateInput } from "../ai-jobs/analysis-job-service";
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
   * BLOCKER 2: When provided, executeAnalysis() loads THIS existing job
   * instead of calling createAnalysisJob(). The worker should always pass
   * this — it received the jobId from the claim. When absent (legacy path),
   * createAnalysisJob() is called for backwards compatibility.
   */
  existingJobId?: string;
  /**
   * Manual authority forwarded from the authenticated caller. Required when
   * existingJobId is NOT provided (legacy createAnalysisJob path).
   */
  manualAuthority?: {
    source: "manual-ai-analyze";
    actorUserId: string;
    authorizedAt: string;
  };
};

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
  options: AnalysisOrchestrationOptions = {},
): Promise<AnalysisOrchestrationResult> {
  const {
    force = false,
    deadlineMs = 48000,
    onProgress,
    onChunkStart,
    onChunkComplete,
    onChunkFailure,
    manualAuthority,
    existingJobId,
  } = options;

  // Content hash that keys the durable AiAnalyzeChunk rows. Assigned once the
  // shared content is built below; the wrapped chunk callbacks persist each
  // chunk under this hash so finalizeJob() can read SUCCEEDED chunk rows and
  // promote canonical data. It is identical to the hash createAnalysisJob used
  // (both call buildTenderAnalysisContent + computeAnalysisContentHash on the
  // same tender/company), so the upserts UPDATE the existing rows in place.
  let checkpointHash: string | null = null;

  // Phase: Preparing
  await onProgress?.({
    phase: "preparing",
    message: "Preparing tender content for analysis…",
  });

  // BLOCKER 2: When existingJobId is provided, load THAT job instead of
  // calling createAnalysisJob(). The worker should always pass this — it
  // received the jobId from the claim. When absent (legacy path),
  // createAnalysisJob() is called for backwards compatibility.
  let jobId: string;
  let totalChunks: number;

  if (existingJobId) {
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
    jobId = existingJob.id;
    // Derive totalChunks from the snapshot if present; otherwise compute below.
    const snapshot = (existingInput as any)?.snapshot;
    totalChunks = snapshot?.totalChunks ?? 0;
  } else {
    // Legacy path: create or resume job via createAnalysisJob.
    if (!manualAuthority) {
      throw new Error("MANUAL_AUTHORITY_REQUIRED: executeAnalysis requires manual authority forwarded from an authenticated caller (or existingJobId)");
    }
    const jobInput: AnalysisJobCreateInput = { tenderId, userId, manualAuthority };
    const jobResult = await createAnalysisJob(jobInput);
    jobId = jobResult.jobId;
    totalChunks = jobResult.totalChunks;
  }

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
  // Enable durable per-chunk checkpoint persistence now that the hash exists.
  checkpointHash = contentHash;

  if (!tenderContent || tenderContent.length < 100) {
    throw new Error("Tender extraction not ready or content too short");
  }

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
