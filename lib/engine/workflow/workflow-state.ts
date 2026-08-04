import { PrismaClient } from "@prisma/client";
import { computeTenderReadinessState } from "../../tender-readiness-state";
import { computeCanonicalModuleStates } from "../canonical-readiness-state";
import { isExtractionAcceptableForGeneration, isExtractionAcceptableForExport } from "../extraction-quality-gate";
import { getCurrentConfirmedBuildPlan, type BuildPlanItem } from "../build-plan";
import { deriveSubmissionPlanStatus, findExtraGeneratedDocuments, findMissingGeneratedDocuments } from "../submission-plan";
import { filterFinalExportCandidateDocuments } from "../document-output-state";
import { detectAnalysisSource, ANALYSIS_APPROVAL_GAP_TITLE } from "../analysis-source";

function traced(r: { sourceTenderFileId?: string | null; sourcePageNumber?: number | null }): boolean {
  return Boolean(r.sourceTenderFileId || r.sourcePageNumber != null);
}

export type WorkflowStage =
  | "UPLOAD_TENDER"
  | "RUN_OCR"
  | "REEXTRACT_SOURCE"
  | "RESUME_AI_ANALYZE"
  | "RUN_AI_ANALYZE"
  | "EDIT_METADATA"
  | "REVIEW_REQUIREMENTS"
  | "RUN_MATCHING"
  | "BUILD_SUBMISSION_PLAN"
  | "GENERATE_DOCUMENTS"
  | "FIX_VALIDATION"
  | "EXPORT_PACKAGE";

export type CanonicalWorkflowState = {
  tenderId: string;
  analysisVersion: string;
  planVersion: string;
  currentStage: WorkflowStage;
  nextAction: WorkflowStage | null;
  actionEndpoint: string | null;
  actionMethod: "POST" | "PATCH" | "GET" | "DELETE" | null;
  label: string;
  reason: string;
  blockerCodes: string[];
  blockerDetails: string[];

  // Module states
  extractionState: string;
  analysisState: string;
  metadataState: string;
  requirementsState: string;
  matchingState: string;
  submissionPlanState: string;
  generationState: string;
  validationState: string;
  exportState: string;

  // Ready flags
  readyForAnalysis: boolean;
  readyForMatching: boolean;
  readyForGeneration: boolean;
  readyForExport: boolean;
};

/**
 * Which required plan files are satisfied, per the one shared rule.
 *
 * This used to compare raw lowercased file names, which is strictly weaker
 * than the shared rule in submission-plan.ts: that one strips the extension
 * and collapses non-alphanumerics, so "Technical Proposal.docx",
 * "Technical-Proposal.docx" and "Technical_Proposal.docx" are one key. The
 * local compare treated the last two as different files, so the canonical
 * workflow decision reported a required document missing when it already
 * existed and parked on GENERATE_DOCUMENTS permanently.
 *
 * It also accepted any generationStatus GENERATED row, ignoring
 * isFinalExportCandidateDocument, so a row marked NOT_EXPORTABLE or
 * REPLACE_WITH_ORIGINAL satisfied its plan file here while the final-ZIP gate
 * refused it — wrong in the opposite direction.
 *
 * Filtering to export candidates first mirrors final-submission-readiness.ts,
 * which is the gate this decision must agree with.
 */
export function validateGeneratedDocsAgainstPlan(
  plan: any,
  generatedDocs: any[]
): { ok: boolean; missing: string[]; extras: string[] } {
  const exportable = filterFinalExportCandidateDocuments(generatedDocs as any[]);

  const missing = findMissingGeneratedDocuments(plan, exportable as any[])
    .map((file: any) => file.exactFileName);

  const extras = findExtraGeneratedDocuments(plan, exportable as any[])
    .map((doc: any) => doc.exactFileName || doc.name);

  return {
    ok: missing.length === 0 && extras.length === 0,
    missing,
    extras
  };
}

export async function getCanonicalTenderWorkflowState(
  prisma: PrismaClient,
  userId: string,
  tenderId: string
): Promise<CanonicalWorkflowState> {
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId },
    include: {
      files: true,
      requirements: true,
      generatedDocuments: true,
      complianceGaps: true,
    },
  });

  if (!tender) {
    throw new Error("Tender not found");
  }

  const readiness = computeTenderReadinessState(tender as any);

  // CRITICAL FIX (investigation FM-008): the previous code read
  // (tender as any).analysisSource which does NOT exist on the Tender model.
  // This made analysisSource always "UNKNOWN", hasAnalysis always false, and
  // the workflow was permanently stuck recommending "RUN_AI_ANALYZE" even
  // after analysis completed. Now uses detectAnalysisSource(tender) which
  // reads the actual tender.notes marker.
  const detectedSource = detectAnalysisSource(tender as any);
  const analysisSource = detectedSource === "AI" ? "AI"
    : detectedSource === "REGEX_FALLBACK_AI_ERROR" ? "REGEX_FALLBACK"
    : "UNKNOWN";
  const analysisIsApprovedFallback = analysisSource === "REGEX_FALLBACK"
    && tender.complianceGaps.some(g => g.title === ANALYSIS_APPROVAL_GAP_TITLE && g.isResolved && g.severity === "ADVISORY");

  const canonicalModules = computeCanonicalModuleStates({
    ...readiness,
    hasAnalysis: analysisSource !== "UNKNOWN",
    hasRequirements: tender.requirements.length > 0,
    hasDocuments: tender.generatedDocuments.length > 0,
    analysisIsApprovedFallback,
  } as any);

  const confirmedPlan = await getCurrentConfirmedBuildPlan(prisma, tenderId, userId ?? "");
  const planItems: BuildPlanItem[] = confirmedPlan.ok ? confirmedPlan.items : [];
  const plan = { files: planItems, warnings: confirmedPlan.ok ? [] : [confirmedPlan.blocker] } as any;
  // A current CONFIRMED BuildPlan IS the approved plan — getCurrentConfirmedBuildPlan
  // already enforces confirmation, hash freshness, and metadata evidence.
  // deriveSubmissionPlanStatus's own approval branch keys on
  // tender.status === "PLAN_APPROVED", which is not a TENDER_STATUSES value and
  // is never written in production, so without this the workflow would stay at
  // BUILD_SUBMISSION_PLAN forever even after the plan is confirmed.
  const planStatus = confirmedPlan.ok ? "CANONICAL_APPROVED" : deriveSubmissionPlanStatus(tender, plan);
  const planApproved = planStatus === "CANONICAL_APPROVED";

  const extractionStatus = (tender as any).analysisExtractionStatus ?? "";
  const extractionBlocked = /EXTRACTION_CORRUPTED|OCR_REQUIRED|PARTIAL_EXTRACTION/.test(extractionStatus);
  // analysisSeverity field does not exist in the Prisma schema — this check
  // was always false. Removed to avoid confusion. If severity tracking is
  // needed in the future, add a real column to the Tender model.
  const analysisUnsafe = false;

  const mandatoryRequirements = tender.requirements.filter(r => /mandatory|critical/i.test(r.priority ?? ""));
  const untracedMandatory = mandatoryRequirements.filter(r => !traced(r as any));
  const completeTraceability = mandatoryRequirements.length > 0 && untracedMandatory.length === 0;

  const planValidation = validateGeneratedDocsAgainstPlan(plan, tender.generatedDocuments);
  const hasUnresolvedCriticalGaps = tender.complianceGaps.some(g => !g.isResolved && g.severity === "CRITICAL");

  // Determine stage and next action
  let nextAction: WorkflowStage | null = null;
  let actionEndpoint: string | null = null;
  let actionMethod: "POST" | "PATCH" | "GET" | "DELETE" | null = "POST";
  let label = "";
  let reason = "Workflow proceeding normally";

  if (tender.files.length === 0) {
    nextAction = "UPLOAD_TENDER";
    label = "Upload Tender Documents";
  } else if (extractionStatus === "OCR_REQUIRED" || (canonicalModules.extraction === "BLOCKED" && !tender.requirements.length)) {
    nextAction = "RUN_OCR";
    actionEndpoint = `/api/tenders/${tenderId}/run-ocr`;
    label = "Upload a clearer source";
    reason = "Extraction is not reliable enough for analysis. Upload a clearer, text-based copy to improve quality.";
  } else if (canonicalModules.analysis !== "READY" && !analysisIsApprovedFallback) {
    nextAction = "RUN_AI_ANALYZE";
    actionEndpoint = `/api/tenders/${tenderId}/ai-analyze`;
    label = "Run AI Analyze";
    reason = readiness.blockers.find(b => /analysis|extraction/i.test(b)) ?? "Tender needs AI analysis.";
  } else if (canonicalModules.metadata !== "READY") {
    nextAction = "EDIT_METADATA";
    label = "Edit Tender Details";
    reason = "Tender metadata is incomplete.";
  } else if (mandatoryRequirements.length > 0 && !completeTraceability) {
    nextAction = "REVIEW_REQUIREMENTS";
    label = "Review Requirements";
    reason = `${untracedMandatory.length} mandatory requirement(s) lack source traceability.`;
  } else if (!planApproved) {
    nextAction = "BUILD_SUBMISSION_PLAN";
    actionEndpoint = `/api/tenders/${tenderId}/build-plan`;
    label = "Build Submission Plan";
    reason = planStatus === "DERIVED_DRAFT" ? "Review and approve the derived submission plan." : "A submission plan must be built and approved.";
  } else if (canonicalModules.generation !== "READY" || !planValidation.ok) {
    nextAction = "GENERATE_DOCUMENTS";
    actionEndpoint = `/api/tenders/${tenderId}/generate`;
    label = "Generate Documents";
    if (!planValidation.ok) {
        reason = planValidation.missing.length > 0
            ? `Missing planned documents: ${planValidation.missing.join(", ")}`
            : `Extra generated documents: ${planValidation.extras.join(", ")}`;
    } else {
        reason = readiness.blockers.find(b => /document|generation/i.test(b)) ?? "Ready to generate documents.";
    }
  } else if (hasUnresolvedCriticalGaps) {
    nextAction = "FIX_VALIDATION";
    label = "Resolve Gaps";
    reason = "Critical compliance gaps must be resolved before export.";
  } else if (canonicalModules.export !== "READY") {
    nextAction = "EXPORT_PACKAGE";
    actionEndpoint = `/api/tenders/${tenderId}/export`;
    label = "Export Package";
    reason = "Resolve final validation blockers before export.";
  } else {
    nextAction = "EXPORT_PACKAGE";
    actionEndpoint = `/api/tenders/${tenderId}/export`;
    label = "Download Final Package";
  }

  const readyForAnalysis = !extractionBlocked;
  const readyForMatching = canonicalModules.analysis === "READY" && tender.requirements.length > 0 && !analysisUnsafe;
  const readyForGeneration = planApproved &&
                             isExtractionAcceptableForGeneration(tender.files as any) &&
                             !analysisUnsafe &&
                             (mandatoryRequirements.length === 0 || completeTraceability);
  const readyForExport = canonicalModules.generation === "READY" &&
                         isExtractionAcceptableForExport(tender.files as any) &&
                         !analysisUnsafe &&
                         completeTraceability &&
                         extractionStatus !== "PARTIAL_EXTRACTION_AI_ANALYZED" &&
                         planApproved &&
                         planValidation.ok &&
                         !hasUnresolvedCriticalGaps &&
                         readiness.exportAllowed;

  return {
    tenderId,
    analysisVersion: readiness.currentAnalysisHash,
    planVersion: String(tender.updatedAt.getTime()),
    currentStage: (tender.stage as WorkflowStage) || "UPLOAD_TENDER",
    nextAction,
    actionEndpoint,
    actionMethod,
    label,
    reason,
    blockerCodes: readiness.blockers,
    blockerDetails: readiness.blockers,

    extractionState: canonicalModules.extraction,
    analysisState: canonicalModules.analysis,
    metadataState: canonicalModules.metadata,
    requirementsState: canonicalModules.requirements,
    matchingState: canonicalModules.matching,
    submissionPlanState: planStatus === "CANONICAL_APPROVED" ? "READY" : planStatus === "DERIVED_DRAFT" ? "PARTIAL" : "NOT_RUN",
    generationState: canonicalModules.generation,
    validationState: canonicalModules.documents,
    exportState: canonicalModules.export,

    readyForAnalysis,
    readyForMatching,
    readyForGeneration,
    readyForExport,
  };
}
