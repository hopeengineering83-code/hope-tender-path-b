import { PrismaClient } from "@prisma/client";
import {
  resolveTenderAnalysisState as resolveInternal,
  type AnalysisState,
} from "../analysis-state-resolver";

export type TenderAnalysisState = AnalysisState | "SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED";

export type AnalysisResolverResult = {
  state: TenderAnalysisState;
  latestJobId: string | null;
  canonicalJobId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  analysisSource: "AI" | "REGEX_FALLBACK" | "LEGACY_NOTES" | "NONE" | "UNKNOWN";
  successfulProvider: string | null;
  attemptedProviders: string[];
  providerFailureCategories: Record<string, string>;
  requirementsExtracted: number;
  requirementsPersisted: number;
  sourceReferencesCreated: number;
  metadataFieldsPersisted: number;
  completedChunks: number;
  totalChunks: number;
  resumableJobId: string | null;
  nextAction: string | null;
  safeDiagnosticSummary: string;
};

export async function resolveTenderAnalysisState(
  prisma: PrismaClient,
  tenderId: string,
  userId?: string
): Promise<AnalysisResolverResult> {
  // If userId is missing, we must fetch it from the tender to ensure tenant isolation
  let effectiveUserId = userId;
  if (!effectiveUserId) {
    const tender = await (prisma as any).tender?.findUnique ? await (prisma as any).tender.findUnique({
      where: { id: tenderId },
      select: { userId: true }
    }).catch(() => null) : null;
    if (!tender) throw new Error("Tender not found");
    effectiveUserId = tender.userId;
  }

  // Delegate to the consolidated internal resolver
  const detail = await resolveInternal(prisma, tenderId, effectiveUserId!);

  // Map to the public legacy response shape
  const attemptedProviders = detail.providerAttempts.map(p => p.provider);
  const providerFailureCategories: Record<string, string> = {};
  for (const p of detail.providerAttempts) {
    if (p.status === "FAILED") {
        providerFailureCategories[p.provider] = "UNKNOWN";
    }
  }

  // Calculate metadata count for UI compatibility
  const tender = await (prisma as any).tender?.findUnique ? await (prisma as any).tender.findUnique({
    where: { id: tenderId },
    select: { clientName: true, deadline: true, submissionMethod: true, reference: true, files: true }
  }).catch(() => null) : null;
  const metadataCount = [tender?.clientName, tender?.deadline, tender?.submissionMethod, tender?.reference].filter(Boolean).length;

  // We need the raw sourceReferencesCreated count for the legacy API
  const sourceReferencesCount = await (prisma as any).tenderRequirement?.count ? await (prisma as any).tenderRequirement.count({
    where: {
        tenderId,
        OR: [
            { sourceTenderFileId: { not: null } },
            { sourcePageNumber: { not: null } },
            { sourceExactQuote: { not: null } }
        ]
    }
  }).catch(() => 0) : 0;

  // Check for detected sections in files (Stage 2 legacy compatibility)
  let sectionsDetected = false;
  if (tender?.files && Array.isArray(tender.files)) {
    for (const file of tender.files) {
        try {
            const pageStatus = JSON.parse(file.pageStatusJson || "[]");
            if (Array.isArray(pageStatus)) {
                if (pageStatus.some((p: any) => p.hasSubmissionInstructions || p.hasEvaluationCriteria || p.hasRequiredDocuments)) {
                    sectionsDetected = true;
                    break;
                }
            }
        } catch (e) {}
    }
  }

  let state: TenderAnalysisState = detail.state as TenderAnalysisState;
  let nextAction = detail.nextAction;
  let safeDiagnosticSummary = detail.safeDiagnosticSummary;

  if (state === "AI_SUCCEEDED" && detail.requirementsExtracted === 0 && sectionsDetected) {
    state = "SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED";
    nextAction = "RETRY_AI_EXTRACTION";
    safeDiagnosticSummary = "AI analysis finished but could not find specific requirements within the detected pages. Manual review or re-extraction is recommended.";
  } else if (state === "NOT_STARTED" && sectionsDetected) {
    state = "SECTION_DETECTED_REQUIREMENTS_NOT_STRUCTURED";
    nextAction = "RETRY_AI_EXTRACTION";
    safeDiagnosticSummary = "Important tender sections (like Evaluation or Submission) were detected, but no structured requirements could be saved. Try re-running the extraction.";
  }

  return {
    state,
    latestJobId: detail.latestJobId,
    canonicalJobId: detail.canonicalJobId,
    startedAt: detail.startedAt,
    finishedAt: detail.finishedAt,
    analysisSource: detail.analysisSource as any,
    successfulProvider: detail.successfulProvider,
    attemptedProviders,
    providerFailureCategories,
    requirementsExtracted: detail.requirementsExtracted,
    requirementsPersisted: detail.requirementsExtracted,
    sourceReferencesCreated: sourceReferencesCount,
    metadataFieldsPersisted: metadataCount,
    completedChunks: detail.completedChunks,
    totalChunks: detail.totalChunks,
    resumableJobId: detail.resumable ? detail.latestJobId : null,
    nextAction,
    safeDiagnosticSummary,
  };
}
