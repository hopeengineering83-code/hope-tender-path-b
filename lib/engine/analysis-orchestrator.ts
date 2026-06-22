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

export type AnalysisOrchestrationOptions = {
  force?: boolean;
  deadlineMs?: number;
  onProgress?: (event: AnalysisProgressEvent) => void | Promise<void>;
  onChunkStart?: (info: { chunkIndex: number; totalChunks: number }) => void | Promise<void>;
  onChunkComplete?: (info: { chunkIndex: number; totalChunks: number; result: AIAnalysisResult; provider?: string | null }) => void | Promise<void>;
  onChunkFailure?: (info: { chunkIndex: number; totalChunks: number; errorMessage: string; provider?: string | null }) => void | Promise<void>;
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
  } = options;

  // Phase: Preparing
  await onProgress?.({
    phase: "preparing",
    message: "Preparing tender content for analysis…",
  });

  // Create or resume job
  const jobInput: AnalysisJobCreateInput = { tenderId, userId };
  const jobResult = await createAnalysisJob(jobInput);
  const jobId = jobResult.jobId;
  const totalChunks = jobResult.totalChunks;

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
    await onChunkFailure?.(info);
    await onProgress?.({
      phase: "analyzing",
      chunk: info.chunkIndex + 1,
      totalChunks: info.totalChunks,
      message: `Chunk ${info.chunkIndex + 1} failed: ${info.errorMessage.slice(0, 100)}`,
    });
  };

  // Fetch tender for access check and to load companyId
  const tenderForAccess = await prisma.tender.findUnique({
    where: { id: tenderId },
    select: {
      id: true,
      userId: true,
      companyId: true,
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
      files: {
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

  // Load company if exists for shared builder input
  let company: Parameters<typeof buildTenderAnalysisContent>[1] | undefined;
  if (tenderForAccess.companyId) {
    const companyRecord = await prisma.company.findUnique({
      where: { id: tenderForAccess.companyId },
      select: {
        documents: {
          select: {
            category: true,
            originalFileName: true,
            extractedText: true,
          },
          take: 5,
          orderBy: { createdAt: "desc" as const },
        },
      },
    });
    if (companyRecord) {
      company = companyRecord;
    }
  }

  // Use Stage 1 shared builder for deterministic content
  const tenderContent = buildTenderAnalysisContent(tender, company);
  const contentHash = computeAnalysisContentHash(tenderContent);

  if (!tenderContent || tenderContent.length < 100) {
    throw new Error("Tender extraction not ready or content too short");
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
    analysisMeta = {
      result: { summary: "", requirements: [], exactFileNaming: [], exactFileOrder: [], evaluationMethodology: "", submissionNotes: "" },
      isPartial: true,
      totalChunks,
      completedChunks: 0,
      failedChunks: totalChunks,
      skippedChunks: 0,
      chunkProviders: Array(totalChunks).fill(null),
      chunkResults: [],
    };
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

  // Update job with analysis results
  if (analysisMeta) {
    await prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: analysisMeta.isPartial ? "PARTIAL_SUCCESS" : "SUCCEEDED",
        finishedAt: new Date(),
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
        }),
        errorMessage,
      },
    }).catch((err) => {
      console.error(`[orchestrator] Failed to update job ${jobId} status:`, err instanceof Error ? err.message : String(err));
    });
  }

  // Phase: Complete
  await onProgress?.({
    phase: "complete",
    status: analysisMeta?.isPartial ? "PARTIAL" : "SUCCESS",
    message: `Analysis complete — ${analysisMeta?.chunkResults.length ?? 0} requirements extracted`,
  });

  return {
    jobId,
    success: !errorMessage && !analysisMeta?.isPartial,
    analysisSource,
    requirementCount: analysisMeta?.chunkResults.length ?? 0,
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
