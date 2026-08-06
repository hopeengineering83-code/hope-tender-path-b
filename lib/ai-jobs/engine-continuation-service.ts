import { createHash } from "node:crypto";
import { prisma, prismaReady } from "../prisma";
import { logger } from "../observability";

export type AnalysisContinuationRecord = {
  id: string;
  jobType: string;
  status: string;
  userId: string;
  tenderId: string | null;
  analysisInputHash: string | null;
  promotedAt: Date | null;
  supersededBy: string | null;
  input: string;
  tenderOwnedByUser: boolean;
  companyId: string | null;
};

export type EngineContinuationResult =
  | { queued: true; jobId: string; reused: boolean; analysisRevision: string }
  | {
      queued: false;
      reason:
        | "ANALYSIS_NOT_FOUND"
        | "NOT_AI_ANALYSIS"
        | "ANALYSIS_NOT_SUCCEEDED"
        | "ANALYSIS_NOT_PROMOTED"
        | "ANALYSIS_SUPERSEDED"
        | "ANALYSIS_REVISION_MISSING"
        | "TENDER_OR_COMPANY_OWNERSHIP_INVALID"
        | "AUTO_CONTINUE_NOT_REQUESTED"
        | "MANUAL_ENGINE_REQUIRED";
    };

export interface EngineContinuationRepository {
  loadAnalysis(analysisJobId: string): Promise<AnalysisContinuationRecord | null>;
  upsertEngine(input: {
    runId: string;
    analysis: AnalysisContinuationRecord;
    analysisRevision: string;
  }): Promise<{ id: string; status: string; created: boolean }>;
  rearmFailedEngine(jobId: string): Promise<void>;
}

function parseInput(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch (error) {
    logger.warn("[engine-continuation-service] failed to parse analysis input", { detail: error });
    return {};
  }
}

export function engineContinuationRunId(input: {
  companyId: string;
  tenderId: string;
  userId: string;
  analysisRevision: string;
}): string {
  const digest = createHash("sha256")
    .update([
      "ENGINE_RUN",
      input.companyId,
      input.tenderId,
      input.userId,
      input.analysisRevision,
    ].join("\u001f"))
    .digest("hex");
  return `pipeline:engine:${digest}`;
}

/**
 * Evaluate whether the analysis record authorizes an automatic Engine
 * continuation. When autoContinue is true, the Engine job is enqueued
 * automatically. When autoContinue is false (or missing), the result is
 * AUTO_CONTINUE_NOT_REQUESTED and the user must click "Run Engine" manually.
 *
 * The manual-ai-analyze route sets autoContinue=false, so the automatic
 * continuation path is only reached by the extraction service (which no
 * longer calls this function) or by tests verifying the contract.
 */
export function evaluateEngineContinuation(
  analysis: AnalysisContinuationRecord | null,
): Exclude<EngineContinuationResult, { queued: true }> {
  if (!analysis) return { queued: false, reason: "ANALYSIS_NOT_FOUND" };
  if (analysis.jobType !== "AI_ANALYZE") return { queued: false, reason: "NOT_AI_ANALYSIS" };
  if (analysis.status !== "SUCCEEDED") return { queued: false, reason: "ANALYSIS_NOT_SUCCEEDED" };
  if (!analysis.promotedAt) return { queued: false, reason: "ANALYSIS_NOT_PROMOTED" };
  if (analysis.supersededBy) return { queued: false, reason: "ANALYSIS_SUPERSEDED" };
  if (!analysis.analysisInputHash) return { queued: false, reason: "ANALYSIS_REVISION_MISSING" };
  if (!analysis.tenderId || !analysis.companyId || !analysis.tenderOwnedByUser) {
    return { queued: false, reason: "TENDER_OR_COMPANY_OWNERSHIP_INVALID" };
  }

  // Explicitly consume the legacy autoContinue field so malformed input remains
  // observable, but never act on it. Run Engine must be started by an authorized user.
  const input = parseInput(analysis.input);
  if (input.autoContinue !== true) {
    return { queued: false, reason: "AUTO_CONTINUE_NOT_REQUESTED" };
  }

  // autoContinue is true — retained for contract compatibility and tests.
  // The extraction service does NOT call this function; it returns
  // EXTRACTION_COMPLETE_MANUAL_AI_ANALYZE_REQUIRED instead.
  return { queued: false, reason: "MANUAL_ENGINE_REQUIRED" };
}

const prismaRepository: EngineContinuationRepository = {
  async loadAnalysis(analysisJobId) {
    await prismaReady;
    const analysis = await prisma.aiJob.findUnique({
      where: { id: analysisJobId },
      select: {
        id: true,
        jobType: true,
        status: true,
        userId: true,
        tenderId: true,
        analysisInputHash: true,
        promotedAt: true,
        supersededBy: true,
        input: true,
        tender: { select: { userId: true } },
      },
    });
    if (!analysis) return null;
    const company = await prisma.company.findUnique({
      where: { userId: analysis.userId },
      select: { id: true },
    });
    return {
      id: analysis.id,
      jobType: analysis.jobType,
      status: analysis.status,
      userId: analysis.userId,
      tenderId: analysis.tenderId,
      analysisInputHash: analysis.analysisInputHash,
      promotedAt: analysis.promotedAt,
      supersededBy: analysis.supersededBy,
      input: analysis.input,
      tenderOwnedByUser: Boolean(analysis.tender && analysis.tender.userId === analysis.userId),
      companyId: company?.id ?? null,
    };
  },

  async upsertEngine({ runId, analysis, analysisRevision }) {
    if (!analysis.tenderId || !analysis.companyId) {
      throw new Error("ENGINE_CONTINUATION_OWNERSHIP_NOT_RESOLVED");
    }
    const existing = await prisma.aiJob.findUnique({ where: { runId }, select: { id: true } });
    const job = await prisma.aiJob.upsert({
      where: { runId },
      create: {
        runId,
        userId: analysis.userId,
        tenderId: analysis.tenderId,
        jobType: "ENGINE_RUN",
        status: "QUEUED",
        analysisInputHash: analysisRevision,
        input: JSON.stringify({
          source: "canonical-ai-analysis-success",
          parentJobId: analysis.id,
          companyId: analysis.companyId,
          analysisRevision,
          autoContinue: true,
        }),
      },
      update: {},
      select: { id: true, status: true },
    });
    return { ...job, created: !existing };
  },

  async rearmFailedEngine(jobId) {
    await prisma.aiJob.updateMany({
      where: { id: jobId, status: { in: ["FAILED", "CANCELED", "PARTIAL_SUCCESS"] } },
      data: {
        status: "QUEUED",
        startedAt: null,
        finishedAt: null,
        errorMessage: null,
        output: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        retries: { increment: 1 },
      },
    });
  },
};

export async function continueSuccessfulAnalysis(
  analysisJobId: string,
  repository: EngineContinuationRepository = prismaRepository,
): Promise<EngineContinuationResult> {
  const analysis = await repository.loadAnalysis(analysisJobId);
  if (!analysis) return { queued: false, reason: "ANALYSIS_NOT_FOUND" };
  if (analysis.jobType !== "AI_ANALYZE") return { queued: false, reason: "NOT_AI_ANALYSIS" };
  if (analysis.status !== "SUCCEEDED") return { queued: false, reason: "ANALYSIS_NOT_SUCCEEDED" };
  if (!analysis.promotedAt) return { queued: false, reason: "ANALYSIS_NOT_PROMOTED" };
  if (analysis.supersededBy) return { queued: false, reason: "ANALYSIS_SUPERSEDED" };
  if (!analysis.analysisInputHash) return { queued: false, reason: "ANALYSIS_REVISION_MISSING" };
  if (!analysis.tenderId || !analysis.companyId || !analysis.tenderOwnedByUser) {
    return { queued: false, reason: "TENDER_OR_COMPANY_OWNERSHIP_INVALID" };
  }

  const input = parseInput(analysis.input);
  if (input.autoContinue !== true) {
    return { queued: false, reason: "AUTO_CONTINUE_NOT_REQUESTED" };
  }

  // autoContinue is true — enqueue the Engine job.
  const runId = engineContinuationRunId({
    companyId: analysis.companyId,
    tenderId: analysis.tenderId,
    userId: analysis.userId,
    analysisRevision: analysis.analysisInputHash,
  });
  const job = await repository.upsertEngine({
    runId,
    analysis,
    analysisRevision: analysis.analysisInputHash,
  });
  return {
    queued: true,
    jobId: job.id,
    reused: !job.created,
    analysisRevision: analysis.analysisInputHash,
  };
}
