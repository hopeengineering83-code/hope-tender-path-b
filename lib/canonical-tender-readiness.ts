import type { PrismaClient } from "@prisma/client";
import { getTenderGenerationReadinessStrict } from "./tender-generation-readiness-strict";
import { assessMatchingQuality } from "./matching-quality";
import { getCompanyIngestionReadiness } from "./company-ingestion-readiness";
import { findMissingGeneratedDocuments } from "./engine/submission-plan";
import { filterFinalExportCandidateDocuments } from "./engine/document-output-state";
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

/**
 * Compact canonical readiness payload for mutation-route responses.
 *
 * Mutation routes that change plan state, document state, or evidence
 * selection should include this in their success response so the client
 * has the authoritative final-export verdict without a separate round-trip
 * to /api/tenders/:id/readiness. The full CanonicalTenderReadiness (with
 * modules, warnings, nextActions) is still available from that endpoint —
 * this is the trim version that answers "did this mutation unblock export?".
 */
export type CanonicalReadinessSummary = {
  readyForFinalExport: boolean;
  readyForFullProposal: boolean;
  readyForSupportPackage: boolean;
  blockers: string[];
  nextActions: string[];
};

/**
 * Re-query the canonical final-export authority after a mutation.
 *
 * Returns null when the tender doesn't exist for this user (the query is
 * user-scoped, so a cross-tenant id is indistinguishable from a missing one).
 * Mutation routes should spread this into their success response as
 * `canonicalReadiness` so the client can update its UI without a separate
 * round-trip.
 *
 * This is the SINGLE authority for "is final export unblocked?" after any
 * mutation. Routes that previously returned only submission-plan counts or
 * partial readiness fields now return this — the client no longer has to
 * infer final-export readiness from intermediate signals.
 */
export async function getCanonicalReadinessSummary(
  client: PrismaClient,
  userId: string,
  tenderId: string,
): Promise<CanonicalReadinessSummary | null> {
  const full = await getCanonicalTenderReadiness(client, userId, tenderId);
  if (!full) return null;
  return {
    readyForFinalExport: full.readyForFinalExport,
    readyForFullProposal: full.readyForFullProposal,
    readyForSupportPackage: full.readyForSupportPackage,
    blockers: full.blockers,
    nextActions: full.nextActions,
  };
}

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
  // Only export candidates can satisfy a required plan file. Without this
  // filter a row marked NOT_EXPORTABLE or REPLACE_WITH_ORIGINAL, a CONTROL
  // format, a SUBMISSION_CONTROL type, or an internal draft counted as "the
  // required file exists" — so MISSING_PLANNED_FILES never fired and
  // readyForFinalExport went true while final-submission-readiness.ts, which
  // filters at line 565 before asking the same question, refused the same
  // tender. Readiness must not promise what the export gate will decline.
  //
  // Selected ONCE, here, and reused by every count below. The narrowing was
  // applied only to `missing`, so three sibling call sites went on counting the
  // raw query result (`generationStatus != SUPERSEDED`, which still admits
  // QUEUED / STALE / PLANNED / GENERATING / FAILED rows, validationStatus-
  // SUPERSEDED rows, NOT_EXPORTABLE / REPLACE_WITH_ORIGINAL rows, CONTROL
  // formats and internal drafts): NO_ACTIVE_GENERATED_DOCUMENTS, hasDocuments
  // and readyForFinalExport. A tender whose only remaining rows were historical
  // therefore reported hasDocuments true and satisfied the "documents exist"
  // half of readyForFinalExport, while the export gate saw zero.
  const currentDocuments = filterFinalExportCandidateDocuments(tender.generatedDocuments as never) as typeof tender.generatedDocuments;
  const missing = findMissingGeneratedDocuments(plan, currentDocuments as never);

  // Gap 1: detect reused tender-issued forms that are still awaiting manual
  // completion. A reused form carries the machine:tender-issued-form-reuse
  // provenance marker in contentSummary and is left in PENDING review (never
  // APPROVED/READY_FOR_EXPORT — that's fabricated human state). It must be
  // completed and signed by a person. The blocker is more specific than
  // MISSING_PLANNED_FILES — it tells the reviewer exactly what to do next.
  //
  // Deliberately reads the BROAD list, not currentDocuments: a reused
  // tender-issued form sits at REPLACE_WITH_ORIGINAL, which the canonical
  // current-document selection excludes — and a form awaiting completion is
  // exactly what this blocker exists to report.
  const tenderFormsAwaitingCompletion = tender.generatedDocuments.filter((doc) => {
    const summary = (doc.contentSummary ?? "").toLowerCase();
    const isReusedTenderForm = summary.includes("machine:tender-issued-form-reuse");
    if (!isReusedTenderForm) return false;
    const rev = (doc.reviewStatus ?? "").toUpperCase();
    return rev !== "READY_FOR_EXPORT" && rev !== "APPROVED";
  });

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
    generatedDocuments: currentDocuments,
    complianceGaps: tender.complianceGaps,
  });

  const blockers = [
    ...readiness.fullProposalBlockers.map((b) => b.code),
    ...(matching.state === "VAULT_AWAITS_ENGINE" ? ["ENGINE_NOT_COMPLETED"] : []),
    ...(expertRequirementExists && tender.expertMatches.length === 0 ? ["NO_TENDER_SPECIFIC_EXPERT_MATCHES"] : []),
    ...(projectRequirementExists && tender.projectMatches.length === 0 ? ["NO_TENDER_SPECIFIC_PROJECT_MATCHES"] : []),
    ...(expertRequirementExists && reviewedSelectedExperts === 0 ? ["NO_SELECTED_REVIEWED_EXPERTS"] : []),
    ...(projectRequirementExists && reviewedSelectedProjects === 0 ? ["NO_SELECTED_REVIEWED_PROJECTS"] : []),
    ...(currentDocuments.length === 0 ? ["NO_ACTIVE_GENERATED_DOCUMENTS"] : []),
    ...(missing.length > 0 ? ["MISSING_PLANNED_FILES"] : []),
    ...(tenderFormsAwaitingCompletion.length > 0 ? ["MISSING_TENDER_FORM_FIELDS"] : []),
    ...(confirmedPlan.ok ? [] : ["NO_CURRENT_CONFIRMED_BUILD_PLAN"]),
  ];

  const nextActions = Array.from(new Set([
    ...readiness.fullProposalBlockers.map((b) => b.nextAction).filter(Boolean) as string[],
    ...(matching.state === "VAULT_AWAITS_ENGINE" ? ["RUN_ENGINE"] : []),
    ...(confirmedPlan.ok ? [] : ["BUILD_SUBMISSION_PLAN"]),
    ...(tenderFormsAwaitingCompletion.length > 0 ? ["COMPLETE_TENDER_FORM_FIELDS"] : []),
  ]));

  const states = computeCanonicalModuleStates({
    ...baseState,
    hasAnalysis: Boolean(tender.analysisSummary),
    hasRequirements: tender.requirements.length > 0,
    hasDocuments: currentDocuments.length > 0,
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
    readyForFinalExport: currentDocuments.length > 0 && missing.length === 0 && tenderFormsAwaitingCompletion.length === 0 && blockers.length === 0 && unresolvedCriticalGaps === 0,
    modules,
    blockers,
    warnings: readiness.warnings.map((w) => w.code),
    nextActions,
  };
}
