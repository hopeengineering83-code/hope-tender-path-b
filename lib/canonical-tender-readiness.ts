import type { PrismaClient } from "@prisma/client";
import { getTenderGenerationReadiness } from "./tender-generation-readiness";
import { assessMatchingQuality } from "./matching-quality";
import { getCompanyIngestionReadiness } from "./company-ingestion-readiness";
import { buildSubmissionPlan, findMissingGeneratedDocuments } from "./engine/submission-plan";

export type CanonicalTenderReadiness = {
  readyForAnalysis: boolean;
  readyForMatchingAttempt: boolean;
  matchingComplete: boolean;
  matchingState: string;
  readyForSupportPackage: boolean;
  readyForFullProposal: boolean;
  readyForFinalExport: boolean;
  blockers: string[];
  warnings: string[];
  nextActions: string[];
};

export async function getCanonicalTenderReadiness(client: PrismaClient, userId: string, tenderId: string): Promise<CanonicalTenderReadiness | null> {
  const readiness = await getTenderGenerationReadiness(client, userId, tenderId);
  if (!readiness) return null;

  const tender = await client.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      requirements: true,
      expertMatches: { include: { expert: { select: { trustLevel: true } } } },
      projectMatches: { include: { project: { select: { trustLevel: true } } } },
      generatedDocuments: { where: { generationStatus: { not: "SUPERSEDED" } } },
    },
  });
  if (!tender) return null;
  const company = await client.company.findUnique({ where: { userId }, select: { id: true } });
  if (!company) return null;
  const companyReadiness = await getCompanyIngestionReadiness(company.id, {}, client);
  const matching = assessMatchingQuality({
    requirements: tender.requirements,
    expertMatches: tender.expertMatches,
    projectMatches: tender.projectMatches,
    vaultReviewedExperts: companyReadiness.totals.reviewedExperts,
    vaultReviewedProjects: companyReadiness.totals.reviewedProjects,
  });
  const plan = buildSubmissionPlan(tender);
  const missing = findMissingGeneratedDocuments(plan, tender.generatedDocuments);

  const blockers = [
    ...readiness.fullProposalBlockers.map((b) => b.code),
    ...(tender.generatedDocuments.length === 0 ? ["NO_ACTIVE_GENERATED_DOCUMENTS"] : []),
    ...(missing.length > 0 ? ["MISSING_PLANNED_FILES"] : []),
  ];

  const nextActions = Array.from(new Set([
    ...readiness.fullProposalBlockers.map((b) => b.nextAction).filter(Boolean) as string[],
    ...(matching.state === "VAULT_AWAITS_ENGINE" ? ["RUN_ENGINE"] : []),
  ]));

  return {
    readyForAnalysis: readiness.analysisQuality.severity !== "POOR",
    readyForMatchingAttempt: true,
    matchingComplete: readiness.matchingComplete,
    matchingState: matching.state,
    readyForSupportPackage: readiness.supportPackageReady,
    readyForFullProposal: readiness.fullProposalReady,
    readyForFinalExport: readiness.fullProposalReady && tender.generatedDocuments.length > 0 && missing.length === 0,
    blockers,
    warnings: readiness.warnings.map((w) => w.code),
    nextActions,
  };
}

