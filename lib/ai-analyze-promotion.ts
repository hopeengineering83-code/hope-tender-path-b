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

// Returns false when a newer analysisVersion job exists for this tender (even if
// still RUNNING), preventing a stale concurrent run from overwriting canonical data.
// Also fails closed when job tracking is unavailable. Canonical AI promotion must
// be versioned by a durable AiJob row; otherwise a job-record failure could allow
// an unversioned analysis to delete and replace trusted canonical requirements.
export async function canPromoteToCanonical(jobId: string | null, tenderId: string): Promise<boolean> {
  if (!jobId) return false;
  const thisJob = await prisma.aiJob.findUnique({
    where: { id: jobId },
    select: { analysisVersion: true },
  }).catch(() => null);
  if (!thisJob) return false;

  const newerJob = await prisma.aiJob.findFirst({
    where: {
      tenderId,
      jobType: "AI_ANALYZE",
      id: { not: jobId },
      analysisVersion: { gt: thisJob.analysisVersion },
      // Any newer-version job (including RUNNING) supersedes this one.
    },
    select: { id: true },
  }).catch(() => ({ id: "promotion-check-failed" }));

  return newerJob === null;
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
