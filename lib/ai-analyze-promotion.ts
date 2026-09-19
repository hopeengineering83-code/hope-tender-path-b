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

/**
 * Terminal `AiJob.status` for an AI_ANALYZE run that finished but never became
 * the canonical promoted analysis for its authorized source revision.
 *
 * INVARIANT: `SUCCEEDED` means "this exact job successfully became the canonical
 * promoted analysis for its exact authorized source revision". A superseded run
 * satisfies neither half, so it must never be recorded as SUCCEEDED or
 * PARTIAL_SUCCESS. Both are success states that downstream gates, UI badges and
 * the analysis-state resolver read as usable work.
 *
 * Defined here (not in the orchestrator) so both the orchestrator and the
 * finalizer can share it without an import cycle.
 */
export const ANALYSIS_SUPERSEDED_STATUS = "SUPERSEDED" as const;

/**
 * Sentinel thrown inside the promotion transaction when the transactional
 * re-check finds a newer authoritative run. Matched by the finalizer's catch to
 * distinguish "lost the promotion race" from a genuine persistence failure.
 */
export const STALE_JOB_SUPERSEDED_SENTINEL = "STALE_JOB_SUPERSEDED" as const;

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

/**
 * Identify the newer AI_ANALYZE job that superseded `jobId`, if any.
 *
 * Same predicate as `canPromoteToCanonical` (a strictly greater
 * `analysisVersion` on the same tender), but returns the winning job's id so a
 * superseded run can record `supersededBy`. That makes the canonical analysis
 * state resolver report SUPERSEDED explicitly instead of falling through to its
 * unknown-status branch.
 *
 * Returns null when this job is still the newest — i.e. when
 * `canPromoteToCanonical` would return true.
 */
export async function findSupersedingJobId(
  jobId: string | null,
  tenderId: string,
  store: AiJobStore = prisma,
): Promise<string | null> {
  if (!jobId) return null;
  const thisJob = await store.aiJob.findUnique({
    where: { id: jobId },
    select: { analysisVersion: true },
  });
  if (!thisJob) return null;

  const newerJob = await store.aiJob.findFirst({
    where: {
      tenderId,
      jobType: "AI_ANALYZE",
      id: { not: jobId },
      analysisVersion: { gt: thisJob.analysisVersion },
    },
    orderBy: { analysisVersion: "desc" },
    select: { id: true },
  });

  return newerJob?.id ?? null;
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
