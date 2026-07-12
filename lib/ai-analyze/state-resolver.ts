/**
 * AI Analyze State Resolver
 *
 * Single authoritative source of truth for tender analysis state.
 * Queries durable AiJob + AiAnalyzeChunk tables.
 * Never consults Tender.notes as source of truth.
 * Fails closed when database is unreachable.
 */

import type { PrismaClient } from "@prisma/client";
import { buildAndHashTenderAnalysisContent } from "./content-hash";

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
 * 2. Canonical promotion and current-content hash binding
 * 3. AiAnalyzeChunk completion status
 * 4. If no job exists: NOT_STARTED
 *
 * Returns fail-closed error if database is unreachable.
 */
export async function getTenderAnalysisState(
  tenderId: string,
  userId: string,
  prismaClient: PrismaClient,
): Promise<AnalysisStateResult> {
  try {
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
        promotedAt: true,
        analyzeChunks: {
          select: {
            chunkIndex: true,
            status: true,
          },
        },
      },
    });

    if (!latestJob) {
      return {
        state: "NOT_STARTED",
        canGenerate: false,
      };
    }

    const jobStatus = latestJob.status as string;
    const jobId = latestJob.id;
    const analysisVersion = Number(latestJob.analysisVersion);

    if (jobStatus === "QUEUED") {
      return {
        state: "QUEUED",
        jobId,
        analysisVersion,
        canGenerate: false,
      };
    }

    if (jobStatus === "RUNNING") {
      const completedCount = latestJob.analyzeChunks.filter(
        (chunk) => chunk.status === "SUCCEEDED",
      ).length;
      const totalCount = latestJob.analyzeChunks.length;

      if (completedCount > 0 && totalCount > 0 && completedCount < totalCount) {
        return {
          state: "PARTIAL_NEEDS_RESUME",
          jobId,
          analysisVersion,
          requiresResume: true,
          canGenerate: false,
        };
      }

      return {
        state: "RUNNING",
        jobId,
        analysisVersion,
        canGenerate: false,
      };
    }

    if (jobStatus === "PARTIAL_SUCCESS") {
      return {
        state: "PARTIAL_NEEDS_RESUME",
        jobId,
        analysisVersion,
        canGenerate: false,
        requiresResume: true,
      };
    }

    if (jobStatus === "SUCCEEDED") {
      if (!latestJob.promotedAt) {
        return {
          state: "FAILED",
          jobId,
          analysisVersion,
          canGenerate: false,
          error: "Analysis succeeded but was not promoted to the canonical state",
        };
      }

      if (!latestJob.analysisInputHash) {
        return {
          state: "SUPERSEDED",
          jobId,
          analysisVersion,
          canGenerate: false,
          error: "Analysis has no content-hash binding",
        };
      }

      const { hash: currentHash } = await buildAndHashTenderAnalysisContent(
        tenderId,
        userId,
        prismaClient,
      );
      if (currentHash !== latestJob.analysisInputHash) {
        return {
          state: "SUPERSEDED",
          jobId,
          analysisVersion,
          canGenerate: false,
          error: "Tender content changed after AI Analyze",
        };
      }

      if (
        latestJob.analyzeChunks.length > 0
        && latestJob.analyzeChunks.some((chunk) => chunk.status !== "SUCCEEDED")
      ) {
        return {
          state: "PARTIAL_NEEDS_RESUME",
          jobId,
          analysisVersion,
          canGenerate: false,
          requiresResume: true,
          error: "Analysis chunks are incomplete",
        };
      }

      return {
        state: "AI_SUCCEEDED",
        jobId,
        analysisVersion,
        canGenerate: true,
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
        canGenerate: false,
        error: "Human review records the fallback for audit only; regex fallback cannot authorize generation or export",
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

    return {
      state: "FAILED",
      jobId,
      analysisVersion,
      canGenerate: false,
      error: `Unknown job status: ${jobStatus}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      state: "FAILED",
      canGenerate: false,
      error: `State resolver unavailable: ${message}`,
    };
  }
}

/**
 * Check if analysis state permits generation/export/final-zip.
 *
 * Only a promoted, current-hash, complete AI success may authorize downstream
 * work. Regex, deterministic, partial, legacy, stale, or human-approved
 * fallback states remain audit/recovery states only.
 */
export function canGenerateFromState(state: AnalysisState): boolean {
  return state === "AI_SUCCEEDED";
}

/** Get a user-facing message for analysis state. */
export function getStateMessage(state: AnalysisState): string {
  const messages: Record<AnalysisState, string> = {
    NOT_STARTED: "Analysis not started. Click AI Analyze to begin.",
    QUEUED: "AI Analyze queued. Processing will start shortly.",
    RUNNING: "Analysis in progress. Please wait.",
    PARTIAL_NEEDS_RESUME: "Analysis partially complete. Click Resume Analysis to continue.",
    AI_SUCCEEDED: "Analysis complete and current. Ready to proceed.",
    REGEX_FALLBACK_UNAPPROVED: "AI Analyze did not complete. A regex diagnostic draft is available, but it cannot authorize generation or export.",
    HUMAN_APPROVED_FALLBACK: "Fallback reviewed for audit only. Re-run AI Analyze before generation or export.",
    FAILED: "Analysis failed. Click Retry AI Analyze.",
    SUPERSEDED: "Tender content changed or a newer analysis exists. Run AI Analyze again.",
  };
  return messages[state];
}
