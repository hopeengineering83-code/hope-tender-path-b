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

export type EngineContinuationResult = {
  queued: false;
  reason:
    | "ANALYSIS_NOT_FOUND"
    | "NOT_AI_ANALYSIS"
    | "ANALYSIS_NOT_SUCCEEDED"
    | "ANALYSIS_NOT_PROMOTED"
    | "ANALYSIS_SUPERSEDED"
    | "ANALYSIS_REVISION_MISSING"
    | "TENDER_OR_COMPANY_OWNERSHIP_INVALID"
    | "MANUAL_ENGINE_REQUIRED";
};

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
 * Evaluate whether the analysis record is valid. This function NEVER enqueues
 * or creates an Engine job. It only validates the analysis state.
 *
 * A historical autoContinue flag is parsed for audit observability but is
 * never treated as authority to create an Engine job. Run Engine must be
 * started by an authorized user clicking the manual Run Engine button
 * (POST /api/tenders/:id/engine).
 *
 * This function always returns { queued: false, reason: "MANUAL_ENGINE_REQUIRED" }
 * when the analysis is valid — signaling that the user must manually click
 * Run Engine. It returns other failure reasons only when the analysis itself
 * is invalid.
 */
export function evaluateEngineContinuation(
  analysis: AnalysisContinuationRecord | null,
): EngineContinuationResult {
  if (!analysis) return { queued: false, reason: "ANALYSIS_NOT_FOUND" };
  if (analysis.jobType !== "AI_ANALYZE") return { queued: false, reason: "NOT_AI_ANALYSIS" };
  if (analysis.status !== "SUCCEEDED") return { queued: false, reason: "ANALYSIS_NOT_SUCCEEDED" };
  if (!analysis.promotedAt) return { queued: false, reason: "ANALYSIS_NOT_PROMOTED" };
  if (analysis.supersededBy) return { queued: false, reason: "ANALYSIS_SUPERSEDED" };
  if (!analysis.analysisInputHash) return { queued: false, reason: "ANALYSIS_REVISION_MISSING" };
  if (!analysis.tenderId || !analysis.companyId || !analysis.tenderOwnedByUser) {
    return { queued: false, reason: "TENDER_OR_COMPANY_OWNERSHIP_INVALID" };
  }

  // Parse and discard the legacy autoContinue field for audit observability.
  // Never act on it. Run Engine must be started by an authorized user.
  try {
    const parsed = JSON.parse(analysis.input) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      void (parsed as Record<string, unknown>).autoContinue;
    }
  } catch {
    // Malformed input is not an error — the analysis was already promoted.
  }

  return { queued: false, reason: "MANUAL_ENGINE_REQUIRED" };
}

/**
 * This function is retained for compatibility with the run-next worker's
 * AI_ANALYZE handler, which calls it to check whether automatic Engine
 * continuation should happen. It NEVER creates, enqueues, or re-arms
 * an Engine job. It always returns MANUAL_ENGINE_REQUIRED when the
 * analysis is valid.
 *
 * Only POST /api/tenders/:id/engine, invoked by an authorized manual user
 * action, may create an Engine job.
 */
export async function continueSuccessfulAnalysis(
  analysisJobId: string,
): Promise<EngineContinuationResult> {
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

  if (!analysis) return { queued: false, reason: "ANALYSIS_NOT_FOUND" };

  const company = await prisma.company.findUnique({
    where: { userId: analysis.userId },
    select: { id: true },
  });

  return evaluateEngineContinuation({
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
  });
}
