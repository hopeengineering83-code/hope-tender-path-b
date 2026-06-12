import { prisma } from "./prisma";
import type { AIAnalysisResult, AnalysisWithMeta } from "./ai";

export interface StagedAnalysisPayload {
  requirements: AIAnalysisResult["requirements"];
  summary: string;
  chunkResults?: Array<{ index: number; result: AIAnalysisResult; provider?: string | null }>;
  contentHash: string;
  isPartial: boolean;
  completedChunks: number;
  totalChunks: number;
  analysisSource: "PARTIAL_AI" | "FALLBACK_DRAFT";
  stagedAt: string;
}

// Write partial AI result to AiJob.stagedMergedResult without touching canonical tender data.
export async function stagePartialResult(
  jobId: string,
  payload: Omit<StagedAnalysisPayload, "analysisSource" | "stagedAt">,
): Promise<void> {
  const staged: StagedAnalysisPayload = {
    ...payload,
    analysisSource: "PARTIAL_AI",
    stagedAt: new Date().toISOString(),
  };
  await prisma.aiJob.update({
    where: { id: jobId },
    data: { stagedMergedResult: JSON.stringify(staged) },
  }).catch(() => {});
}

// Write regex fallback result to AiJob.stagedMergedResult without touching canonical tender data.
export async function stageFallbackDraft(
  jobId: string,
  payload: Omit<StagedAnalysisPayload, "analysisSource" | "stagedAt">,
): Promise<void> {
  const staged: StagedAnalysisPayload = {
    ...payload,
    analysisSource: "FALLBACK_DRAFT",
    stagedAt: new Date().toISOString(),
  };
  await prisma.aiJob.update({
    where: { id: jobId },
    data: { stagedMergedResult: JSON.stringify(staged) },
  }).catch(() => {});
}

// Returns false when a newer analysisVersion has already been promoted for this tender,
// meaning this run is stale and should not overwrite canonical data.
export async function canPromoteToCanonical(jobId: string, tenderId: string): Promise<boolean> {
  if (!jobId) return false;
  const thisJob = await prisma.aiJob.findUnique({
    where: { id: jobId },
    select: { analysisVersion: true },
  }).catch(() => null);
  if (!thisJob) return false;

  const newerPromotion = await prisma.aiJob.findFirst({
    where: {
      tenderId,
      jobType: "AI_ANALYZE",
      promotedAt: { not: null },
      id: { not: jobId },
      analysisVersion: { gt: thisJob.analysisVersion },
    },
    select: { id: true },
  }).catch(() => null);

  return newerPromotion === null;
}

// Record that a full AI analysis has been atomically promoted to canonical state.
// Must be called AFTER the canonical $transaction completes successfully.
export async function promoteAnalysisToCanonical(
  jobId: string,
  runId: string,
): Promise<void> {
  await prisma.aiJob.update({
    where: { id: jobId },
    data: {
      promotedAt: new Date(),
      promotedBy: "system",
      runId,
    },
  }).catch(() => {});
}

// Re-export AnalysisWithMeta so callers can avoid a separate import.
export type { AnalysisWithMeta };
