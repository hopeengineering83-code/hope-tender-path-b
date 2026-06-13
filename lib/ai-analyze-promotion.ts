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

type AiJobStore = Pick<typeof prisma, "aiJob">;

export async function stagePartialResult(
  jobId: string,
  payload: Omit<StagedAnalysisPayload, "analysisSource" | "stagedAt">,
  store: AiJobStore = prisma,
): Promise<void> {
  const staged: StagedAnalysisPayload = {
    ...payload,
    analysisSource: "PARTIAL_AI",
    stagedAt: new Date().toISOString(),
  };
  await store.aiJob.update({
    where: { id: jobId },
    data: { stagedMergedResult: JSON.stringify(staged) },
  });
}

export async function stageFallbackDraft(
  jobId: string,
  payload: Omit<StagedAnalysisPayload, "analysisSource" | "stagedAt">,
  store: AiJobStore = prisma,
): Promise<void> {
  const staged: StagedAnalysisPayload = {
    ...payload,
    analysisSource: "FALLBACK_DRAFT",
    stagedAt: new Date().toISOString(),
  };
  await store.aiJob.update({
    where: { id: jobId },
    data: { stagedMergedResult: JSON.stringify(staged) },
  });
}

export async function canPromoteToCanonical(
  jobId: string | null,
  tenderId: string,
  store: AiJobStore = prisma,
): Promise<boolean> {
  if (!jobId) return false;
  const thisJob = await store.aiJob.findUnique({
    where: { id: jobId },
    select: { analysisVersion: true },
  });
  if (!thisJob) return false;

  const newerJob = await store.aiJob.findFirst({
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
  store: AiJobStore = prisma,
): Promise<void> {
  const job = await store.aiJob.findUnique({
    where: { id: jobId },
    select: { userId: true },
  });
  if (!job) throw new Error("AI_ANALYZE_PROMOTION_JOB_NOT_FOUND");

  await store.aiJob.update({
    where: { id: jobId },
    data: {
      promotedAt: new Date(),
      promotedBy: job.userId,
      runId,
    },
  });
}

export type { AnalysisWithMeta };
