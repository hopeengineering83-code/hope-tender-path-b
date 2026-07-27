import type { PrismaClient } from "@prisma/client";
import { getTenderGenerationReadinessStrict } from "./tender-generation-readiness-strict";
import { assessMatchingQuality } from "./matching-quality";
import { getCompanyIngestionReadiness } from "./company-ingestion-readiness";
import { findMissingGeneratedDocuments } from "./engine/submission-plan";
import { getCurrentConfirmedBuildPlan, type BuildPlanItem } from "./engine/build-plan";
import { computeTenderReadinessState } from "./tender-readiness-state";
import { buildCanonicalModulePayload, computeCanonicalModuleStates, type CanonicalModuleStatePayload } from "./engine/canonical-readiness-state";
import { detectAnalysisSourceWithApproval } from "./engine/analysis-source";
import { canUseVaultRecord, VAULT_REVIEW_CONSUMER_SELECT, type ReviewRecordState } from "./vault-review-provenance";

export type CanonicalTenderReadiness = {
  readyForAnalysis: boolean;
  readyForMatchingAttempt: boolean;
  matchingComplete: boolean;
  matchingState: string;
  readyForSupportPackage: boolean;
  readyForFullProposal: boolean;
  readyForFinalExport: boolean;
  modules: CanonicalModuleStatePayload;
  blockers: string[];
  warnings: string[];
  nextActions: string[];
};

export async function getCanonicalTenderReadiness(client: PrismaClient, userId: string, tenderId: string): Promise<CanonicalTenderReadiness | null> {
  const readiness = await getTenderGenerationReadinessStrict(client, userId, tenderId);
  if (!readiness) return null;

  const tender = await client.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      requirements: true,
      expertMatches: { include: { expert: { select: VAULT_REVIEW_CONSUMER_SELECT.EXPERT } } },
      projectMatches: { include: { project: { select: VAULT_REVIEW_CONSUMER_SELECT.PROJECT } } },
      // Feeds computeTenderReadinessState's exportAllowed/complianceCurrent
      // below — without this, unresolved CRITICAL compliance gaps are
      // silently invisible to this resolver's export readiness, even though
      // the actual final ZIP download route hard-blocks on them.
      complianceGaps: { select: { severity: true, isResolved: true } },
      generatedDocuments: {
        where: { generationStatus: { not: "SUPERSEDED" } },
        select: {
          id: true,
          name: true,
          exactFileName: true,
          exactOrder: true,
          documentType: true,
          format: true,
          generationStatus: true,
          validationStatus: true,
          reviewStatus: true,
          contentSummary: true,
        },
      },
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
  // AUTHORITATIVE: only the current CONFIRMED BuildPlan defines the file plan.
  // Without one, final export is blocked (NO_CURRENT_CONFIRMED_BUILD_PLAN) —
  // a derived draft must never stand in for a confirmed plan here.
  const confirmedPlan = await getCurrentConfirmedBuildPlan(client, tenderId, userId);
  const planItems: BuildPlanItem[] = confirmedPlan.ok ? confirmedPlan.items : [];
  const plan = { files: planItems, warnings: confirmedPlan.ok ? [] : [confirmedPlan.blocker] } as any;
  const missing = findMissingGeneratedDocuments(plan, tender.generatedDocuments);
  const expertRequirementExists = tender.requirements.some((r) => r.requirementType === "EXPERT");
  const projectRequirementExists = tender.requirements.some((r) => r.requirementType === "PROJECT_EXPERIENCE");
  const reviewedSelectedExperts = tender.expertMatches.filter((m) => m.isSelected && canUseVaultRecord(m.expert as ReviewRecordState, "GENERATION")).length;
  const reviewedSelectedProjects = tender.projectMatches.filter((m) => m.isSelected && canUseVaultRecord(m.project as ReviewRecordState, "GENERATION")).length;
  const unresolvedCriticalGaps = tender.complianceGaps.filter((g) => !g.isResolved && g.severity === "CRITICAL").length;

  const analysisSource = await detectAnalysisSourceWithApproval(client, tenderId, tender);
  const baseState = computeTenderReadinessState({
    analysisExtractionStatus: tender.analysisExtractionStatus,
    analysisSource,
    analysisSeverity: readiness.analysisQuality.severity as "GOOD" | "WARNING" | "POOR" | "UNSAFE" | null,
    title: tender.title,
    clientName: tender.clientName,
    procuringEntityName: tender.procuringEntityName,
    reference: tender.reference,
    metadataContaminated: tender.metadataContaminated,
    requirements: tender.requirements,
    exactFileNaming: tender.exactFileNaming,
    exactFileOrder: tender.exactFileOrder,
    generatedDocuments: tender.generatedDocuments,
    complianceGaps: tender.complianceGaps,
  });

  const blockers = [
    ...readiness.fullProposalBlockers.map((b) => b.code),
    ...(matching.state === "VAULT_AWAITS_ENGINE" ? ["ENGINE_NOT_COMPLETED"] : []),
    ...(expertRequirementExists && tender.expertMatches.length === 0 ? ["NO_TENDER_SPECIFIC_EXPERT_MATCHES"] : []),
    ...(projectRequirementExists && tender.projectMatches.length === 0 ? ["NO_TENDER_SPECIFIC_PROJECT_MATCHES"] : []),
    ...(expertRequirementExists && reviewedSelectedExperts === 0 ? ["NO_SELECTED_REVIEWED_EXPERTS"] : []),
    ...(projectRequirementExists && reviewedSelectedProjects === 0 ? ["NO_SELECTED_REVIEWED_PROJECTS"] : []),
    ...(tender.generatedDocuments.length === 0 ? ["NO_ACTIVE_GENERATED_DOCUMENTS"] : []),
    ...(missing.length > 0 ? ["MISSING_PLANNED_FILES"] : []),
    ...(confirmedPlan.ok ? [] : ["NO_CURRENT_CONFIRMED_BUILD_PLAN"]),
  ];

  const nextActions = Array.from(new Set([
    ...readiness.fullProposalBlockers.map((b) => b.nextAction).filter(Boolean) as string[],
    ...(matching.state === "VAULT_AWAITS_ENGINE" ? ["RUN_ENGINE"] : []),
    ...(confirmedPlan.ok ? [] : ["BUILD_SUBMISSION_PLAN"]),
  ]));

  const states = computeCanonicalModuleStates({
    ...baseState,
    hasAnalysis: Boolean(tender.analysisSummary),
    hasRequirements: tender.requirements.length > 0,
    hasDocuments: tender.generatedDocuments.length > 0,
    matchingComplete: matching.state !== "VAULT_AWAITS_ENGINE",
    matchingBlocked: blockers.some((code) => code.includes("MATCH") || code.includes("EXPERT") || code.includes("PROJECT")),
    generationServerReady: readiness.fullProposalReady,
  });
  const modules = buildCanonicalModulePayload(states, {
    blockers,
    warnings: readiness.warnings.map((w) => w.code),
    currentAnalysisHash: baseState.currentAnalysisHash,
  });

  return {
    readyForAnalysis: readiness.analysisQuality.severity !== "POOR",
    readyForMatchingAttempt: true,
    matchingComplete: matching.state !== "VAULT_AWAITS_ENGINE",
    matchingState: matching.state,
    readyForSupportPackage: readiness.supportPackageReady,
    readyForFullProposal: readiness.fullProposalReady,
    readyForFinalExport: tender.generatedDocuments.length > 0 && missing.length === 0 && blockers.length === 0 && unresolvedCriticalGaps === 0,
    modules,
    blockers,
    warnings: readiness.warnings.map((w) => w.code),
    nextActions,
  };
}
