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
  });
}

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
  });
}

export async function canPromoteToCanonical(jobId: string | null, tenderId: string): Promise<boolean> {
  if (!jobId) return false;
  const thisJob = await prisma.aiJob.findUnique({
    where: { id: jobId },
    select: { analysisVersion: true },
  });
  if (!thisJob) return false;

  const newerJob = await prisma.aiJob.findFirst({
    where: {
      tenderId,
      jobType: "AI_ANALYZE",
      id: { not: jobId },
      analysisVersion: { gt: thisJob.analysisVersion },
    },
    select: { id: true },
  });

  return newerJob === null;
}

export async function promoteAnalysisToCanonical(
  jobId: string,
  runId: string,
): Promise<void> {
  const job = await prisma.aiJob.findUnique({
    where: { id: jobId },
    select: { userId: true },
  });
  if (!job) throw new Error("AI_ANALYZE_PROMOTION_JOB_NOT_FOUND");

  await prisma.aiJob.update({
    where: { id: jobId },
    data: {
      promotedAt: new Date(),
      promotedBy: job.userId,
      runId,
    },
  });
}

export type { AnalysisWithMeta };
