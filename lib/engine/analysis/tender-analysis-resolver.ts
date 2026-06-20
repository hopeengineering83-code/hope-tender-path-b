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
  let effectiveUserId = userId;
  if (!effectiveUserId) {
    const tender = await prisma.tender.findUnique({
      where: { id: tenderId },
      select: { userId: true }
    });
    if (!tender) throw new Error("Tender not found");
    effectiveUserId = tender.userId;
  }

  const detail = await resolveInternal(prisma, tenderId, effectiveUserId);

  const attemptedProviders = detail.providerAttempts.map(p => p.provider);
  const providerFailureCategories: Record<string, string> = {};
  for (const p of detail.providerAttempts) {
    if (p.status === "FAILED") {
        providerFailureCategories[p.provider] = "UNKNOWN";
    }
  }

  const tender = await prisma.tender.findUnique({
    where: { id: tenderId },
    select: { clientName: true, deadline: true, submissionMethod: true, reference: true }
  });
  const metadataCount = [tender?.clientName, tender?.deadline, tender?.submissionMethod, tender?.reference].filter(Boolean).length;

  const sourceReferencesCount = await prisma.tenderRequirement.count({
    where: {
        tenderId,
        OR: [
            { sourceTenderFileId: { not: null } },
            { sourcePageNumber: { not: null } },
            { sourceExactQuote: { not: null } }
        ]
    }
  });

  return {
    state: detail.state as TenderAnalysisState,
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
    nextAction: detail.nextAction,
    safeDiagnosticSummary: detail.safeDiagnosticSummary,
  };
}
