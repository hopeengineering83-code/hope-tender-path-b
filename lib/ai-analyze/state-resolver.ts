/**
 * AI Analyze State Resolver
 *
 * Single authoritative source of truth for tender analysis state.
 * Queries durable AiJob + AiAnalyzeChunk tables.
 * Never consults Tender.notes as source of truth.
 * Fails closed when database is unreachable.
 */

import type { PrismaClient } from "@prisma/client";

export type AnalysisState =
  | "NOT_STARTED"
  | "QUEUED"
  | "RUNNING"
  | "PARTIAL_NEEDS_RESUME"
  | "AI_SUCCEEDED"
  | "REGEX_FALLBACK_UNAPPROVED"
  | "HUMAN_APPROVED_FALLBACK"
  | "FAILED"
  | "SUPERSEDED";

export interface AnalysisStateResult {
  state: AnalysisState;
  jobId?: string;
  analysisVersion?: number;
  requiresResume?: boolean;
  canGenerate: boolean;
  error?: string;
}

/**
 * Get the authoritative analysis state for a tender.
 *
 * Authority hierarchy:
 * 1. Latest non-superseded AiJob status
 * 2. AiAnalyzeChunk completion status (for PARTIAL_NEEDS_RESUME detection)
 * 3. If no job exists: NOT_STARTED
 *
 * Returns fail-closed error if database is unreachable.
 */
export async function getTenderAnalysisState(
  tenderId: string,
  userId: string,
  prismaClient: PrismaClient,
): Promise<AnalysisStateResult> {
  try {
    // Query latest non-superseded job for this tender
    const latestJob = await prismaClient.aiJob.findFirst({
      where: {
        tenderId,
        userId,
        supersededBy: null,
        jobType: "AI_ANALYZE",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        analysisVersion: true,
        analysisInputHash: true,
        analyzeChunks: {
          select: {
            chunkIndex: true,
            status: true,
          },
        },
      },
    });

    // No job found: NOT_STARTED
    if (!latestJob) {
      return {
        state: "NOT_STARTED",
        canGenerate: false,
      };
    }

    const jobStatus = latestJob.status as string;
    const jobId = latestJob.id;
    const analysisVersion = Number(latestJob.analysisVersion);

    // Map job status to analysis state
    if (jobStatus === "QUEUED") {
      return {
        state: "QUEUED",
        jobId,
        analysisVersion,
        canGenerate: false,
      };
    }

    if (jobStatus === "RUNNING") {
      // Check if we have completed chunks
      const completedCount = latestJob.analyzeChunks.filter(
        (c) => c.status === "SUCCEEDED",
      ).length;
      const totalCount = latestJob.analyzeChunks.length;

      // If some chunks completed but status is still RUNNING, it's partial
      if (completedCount > 0 && totalCount > 0 && completedCount < totalCount) {
        return {
          state: "PARTIAL_NEEDS_RESUME",
          jobId,
          analysisVersion,
          requiresResume: true,
          canGenerate: false,
        };
      }

      // Still running, no chunks yet
      return {
        state: "RUNNING",
        jobId,
        analysisVersion,
        canGenerate: false,
      };
    }

    if (jobStatus === "SUCCEEDED" || jobStatus === "PARTIAL_SUCCESS") {
      // SUCCEEDED allows generation
      // PARTIAL_SUCCESS blocks generation (user must resume and complete)
      const canGenerate = jobStatus === "SUCCEEDED";
      return {
        state: canGenerate ? "AI_SUCCEEDED" : "PARTIAL_NEEDS_RESUME",
        jobId,
        analysisVersion,
        canGenerate,
        requiresResume: !canGenerate,
      };
    }

    if (jobStatus === "REGEX_FALLBACK_UNAPPROVED") {
      return {
        state: "REGEX_FALLBACK_UNAPPROVED",
        jobId,
        analysisVersion,
        canGenerate: false,
      };
    }

    if (jobStatus === "HUMAN_APPROVED_FALLBACK") {
      return {
        state: "HUMAN_APPROVED_FALLBACK",
        jobId,
        analysisVersion,
        canGenerate: true, // Only approved fallback can generate
      };
    }

    if (jobStatus === "FAILED") {
      return {
        state: "FAILED",
        jobId,
        analysisVersion,
        canGenerate: false,
        error: "Analysis failed",
      };
    }

    if (jobStatus === "CANCELED") {
      return {
        state: "SUPERSEDED",
        jobId,
        analysisVersion,
        canGenerate: false,
      };
    }

    // Unknown status
    return {
      state: "FAILED" as AnalysisState,
      jobId,
      analysisVersion,
      canGenerate: false,
      error: `Unknown job status: ${jobStatus}`,
    };
  } catch (err) {
    // Fail closed: database error prevents state determination
    const message = err instanceof Error ? err.message : String(err);
    return {
      state: "FAILED" as AnalysisState,
      canGenerate: false,
      error: `State resolver unavailable: ${message}`,
    };
  }
}

/**
 * Check if analysis state permits generation/export/final-zip.
 *
 * Only AI_SUCCEEDED and HUMAN_APPROVED_FALLBACK allow generation.
 */
export function canGenerateFromState(state: AnalysisState): boolean {
  return state === "AI_SUCCEEDED" || state === "HUMAN_APPROVED_FALLBACK";
}

/**
 * Get user-facing message for analysis state.
 */
export function getStateMessage(state: AnalysisState): string {
  const messages: Record<AnalysisState, string> = {
    NOT_STARTED: "Analysis not started. Click AI Analyze to begin.",
    QUEUED: "AI Analyze queued. Processing will start shortly.",
    RUNNING: "Analysis in progress. Please wait.",
    PARTIAL_NEEDS_RESUME: "Analysis partially complete. Click Resume Analysis to continue.",
    AI_SUCCEEDED: "Analysis complete. Ready to proceed.",
    REGEX_FALLBACK_UNAPPROVED: "Analysis failed — using regex fallback. Click Retry or Approve Fallback.",
    HUMAN_APPROVED_FALLBACK: "Analysis complete (human-approved fallback). Proceed with caution.",
    FAILED: "Analysis failed. Click Retry AI Analyze.",
    SUPERSEDED: "A newer analysis exists. Review the latest analysis.",
  };
  return messages[state];
}
