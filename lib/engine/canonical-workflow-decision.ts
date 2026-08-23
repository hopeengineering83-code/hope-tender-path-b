// Canonical workflow decision helper.
//
// This is the ONE source of truth for workflow stage truth across:
// - NextActionPanel
// - workflow-center API
// - Generation Action / Readiness panels
// - Submission Plan Reconciliation
// - Requirement Coverage
// - Authority Review
// - Document Validator
// - Export Readiness
//
// All panels must consume this decision object — no panel may compute its
// own competing "next action" or stage truth.

import { publicJobFailureMessage } from "../prisma-schema-compatibility";

export type WorkflowBlockerPriority =
  | "NO_TENDER_FILE"
  | "EXTRACTION_UNSAFE"
  | "PARTIAL_AI_ANALYSIS"
  | "STALE_ANALYSIS"
  | "AI_ANALYZE_NOT_RUN"
  | "ENGINE_RUN_FAILED"
  | "CRITICAL_TENDER_DETAILS_INVALID"
  | "REQUIREMENTS_NOT_SOURCE_GROUNDED"
  | "NO_CONFIRMED_BUILD_PLAN"
  | "MANDATORY_NO_COMPLIANCE_ROWS"
  | "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE"
  | "PDF_REQUIRED_UNAVAILABLE"
  | "REQUIRED_DOCS_NOT_GENERATED"
  | "DOCS_NOT_VALIDATED"
  | "DOCS_NOT_APPROVED_EXPORT_READY"
  | "AUTHORITY_OR_QUALITY_BLOCKERS"
  | "EXPORT_BLOCKED"
  | "EXPORT_ZIP_READY";

export type CanonicalWorkflowDecision = {
  // The single highest-priority blocker
  currentBlockingStage: WorkflowBlockerPriority;
  nextRequiredAction: string;
  nextRequiredActionLabel: string;
  nextRequiredActionReason: string;
  blockingStageCode: string;
  blockerCodes: string[];
  blockerDetails: string[];

  // Per-stage availability — downstream stages are suppressed by upstream blockers
  stageStates: Record<string, "READY" | "BLOCKED" | "BLOCKED_BY_PRIOR_STEP" | "WAITING_ON_PRIOR_STEP" | "COMPLETE" | "IN_PROGRESS">;
  stageAvailability: Record<string, boolean>;

  // What suppresses downstream stages
  downstreamSuppressedBy: string | null;

  // Analysis state
  partialAnalysis: boolean;
  staleAnalysis: boolean;

  // Build plan
  confirmedBuildPlanExists: boolean;

  // Requirements / compliance
  mandatoryRequirementCount: number;
  mandatoryTracedCount: number;
  mandatoryComplianceRowsCount: number;
  mandatoryFullOrSubstantialCoverageCount: number;
  /**
   * Mandatory requirements whose outstanding evidence is a planned output this
   * workflow will generate, and which are not otherwise covered.
   *
   * These are the requirements that made the tender unsatisfiable. A submission
   * requirement is answered by a document the app generates, so its only
   * automatic evidence is the confirmed Build Plan row for that exact file. A
   * plan row is correctly never FULL or SUBSTANTIAL — the bytes do not exist —
   * so the requirement stayed uncovered, and the coverage blocker refused to
   * let generation start. The app declined to generate a file until the file
   * already existed, and no Company Vault upload could resolve it, because the
   * missing item was an output rather than a source.
   *
   * Counted toward the GENERATION gate only. Nothing here touches export: the
   * bytes still do not exist, and MISSING_PLANNED_FILES,
   * NO_ACTIVE_GENERATED_DOCUMENTS, package reconciliation and the ZIP byte
   * gates remain independent and still fire.
   */
  mandatoryAwaitingPlannedOutputCount?: number;

  // Documents
  requiredDocumentsTotal: number;
  generatedDocumentsTotal: number;
  exportReadyDocumentsTotal: number;

  // PDF
  pdfRequiredButUnavailable: boolean;

  // Final export
  finalExportAllowed: boolean;
};

/**
 * Build a canonical workflow decision from the available inputs.
 * This is a PURE function — no DB calls. The caller must gather all inputs
 * before calling.
 */
export function buildCanonicalWorkflowDecision(input: {
  hasFiles: boolean;
  extractionUnsafe: boolean;
  extractionCorrupted: boolean;
  ocrRequired: boolean;

  // Analysis
  aiAnalysisExists: boolean;
  aiAnalysisTrusted: boolean;
  aiAnalysisPartial: boolean;
  aiAnalysisStale: boolean; // content changed since last analysis
  resumableAnalysisAvailable: boolean;

  // Tender details
  criticalTenderDetailsValid: boolean;

  // Requirements
  requirementsExist: boolean;
  requirementsTrusted: boolean;
  mandatoryRequirementCount: number;
  mandatoryTracedCount: number;
  mandatoryComplianceRowsCount: number;
  mandatoryFullOrSubstantialCoverageCount: number;
  mandatoryAwaitingPlannedOutputCount?: number;

  // Build plan
  confirmedBuildPlanExists: boolean;

  // Documents
  requiredDocumentsTotal: number;
  generatedDocumentsTotal: number;
  exportReadyDocumentsTotal: number;
  documentsValidated: boolean;
  documentsApproved: boolean;

  // PDF
  pdfRequiredButUnavailable: boolean;

  // Export
  finalExportAllowed: boolean;
  authorityOrQualityBlockers: boolean;
}): CanonicalWorkflowDecision {
  const blockerCodes: string[] = [];
  const blockerDetails: string[] = [];

  // ── Priority 1: No tender file uploaded ──────────────────────────────
  if (!input.hasFiles) {
    blockerCodes.push("NO_TENDER_FILE");
    blockerDetails.push("No tender file has been uploaded.");
  }

  // ── Priority 2: Extraction unsafe ────────────────────────────────────
  if (input.hasFiles && input.extractionUnsafe) {
    blockerCodes.push("EXTRACTION_UNSAFE");
    blockerDetails.push(input.extractionCorrupted
      ? "Extraction is corrupted. Upload a clearer, text-based copy of the source."
      : input.ocrRequired
        ? "OCR is required — the PDF appears to be scanned."
        : "Extraction quality is too low for analysis.");
  }

  // ── Priority 3: Partial AI analysis ──────────────────────────────────
  if (input.hasFiles && !input.extractionUnsafe && input.aiAnalysisPartial) {
    blockerCodes.push("PARTIAL_AI_ANALYSIS");
    blockerDetails.push("Partial AI analysis awaiting completion. Resume AI Analyze to finish.");
  }

  // ── Priority 4: Stale analysis ───────────────────────────────────────
  if (input.hasFiles && !input.extractionUnsafe && !input.aiAnalysisPartial && input.aiAnalysisStale) {
    blockerCodes.push("STALE_ANALYSIS");
    blockerDetails.push("Tender content changed since the last analysis. Re-run AI Analyze.");
  }

  // ── Priority 5: AI Analyze not run or untrusted ──────────────────────
  if (input.hasFiles && !input.extractionUnsafe && !input.aiAnalysisPartial && !input.aiAnalysisStale) {
    if (!input.aiAnalysisExists) {
      blockerCodes.push("AI_ANALYZE_NOT_RUN");
      blockerDetails.push("AI Analyze has not been run yet.");
    } else if (!input.aiAnalysisTrusted) {
      blockerCodes.push("AI_ANALYZE_NOT_RUN");
      blockerDetails.push("AI analysis is untrusted (regex fallback). Re-run AI Analyze.");
    }
  }

  // ── Priority 6: Critical Tender Details invalid ──────────────────────
  if (input.hasFiles && !input.extractionUnsafe && input.aiAnalysisExists && input.aiAnalysisTrusted && !input.aiAnalysisPartial && !input.aiAnalysisStale) {
    if (!input.criticalTenderDetailsValid) {
      blockerCodes.push("CRITICAL_TENDER_DETAILS_INVALID");
      blockerDetails.push("Critical Tender Details are missing, invalid, or ungrounded.");
    }
  }

  // ── Priority 7: Requirements not source-grounded ─────────────────────
  const analysisOK = input.aiAnalysisExists && input.aiAnalysisTrusted && !input.aiAnalysisPartial && !input.aiAnalysisStale;
  if (analysisOK && input.criticalTenderDetailsValid) {
    if (!input.requirementsTrusted) {
      blockerCodes.push("REQUIREMENTS_NOT_SOURCE_GROUNDED");
      blockerDetails.push(input.requirementsExist
        ? "Requirements exist but lack verified source tracing. Attempt automatic source grounding; if the source cannot prove them, re-run AI Analyze, upload a better source, or correct the requirement from the genuine source."
        : "No requirements available. Re-run AI Analyze against the verified source.");
    }
  }

  // ── Priority 8: No confirmed Build Plan ──────────────────────────────
  const requirementsOK = analysisOK && input.criticalTenderDetailsValid && input.requirementsTrusted;
  if (requirementsOK && !input.confirmedBuildPlanExists) {
    blockerCodes.push("NO_CONFIRMED_BUILD_PLAN");
    // Run Engine uses the verified source and current AI analysis to create and verify the Build Plan (the ENGINE_RUN
    // handler calls buildAndVerifyBuildPlan). Naming a manual "build and
    // confirm" step invented a third required action, and contradicted the
    // very next blocker below, which correctly says "Run Engine to link
    // evidence".
    blockerDetails.push("No current confirmed Build Plan for this revision. Run Engine uses the verified source and current AI analysis to create and verify it.");
  }

  // ── Priority 9: Mandatory no compliance rows ─────────────────────────
  if (requirementsOK && input.confirmedBuildPlanExists) {
    if (input.mandatoryRequirementCount > 0 && input.mandatoryComplianceRowsCount === 0) {
      blockerCodes.push("MANDATORY_NO_COMPLIANCE_ROWS");
      blockerDetails.push(`${input.mandatoryRequirementCount} mandatory requirements have no compliance matrix rows. Run Engine to link evidence.`);
    }
  }

  // ── Priority 10: Mandatory no FULL/SUBSTANTIAL coverage ──────────────
  // Requirements waiting only on a file this workflow generates count as
  // satisfied HERE, at the generation gate, and nowhere else. See
  // mandatoryAwaitingPlannedOutputCount for why: without it the tender is
  // unsatisfiable by construction, because the evidence it demands is an
  // output the same gate is preventing.
  const mandatoryCoveredForGeneration =
    input.mandatoryFullOrSubstantialCoverageCount + (input.mandatoryAwaitingPlannedOutputCount ?? 0);
  if (requirementsOK && input.confirmedBuildPlanExists && input.mandatoryRequirementCount > 0 && input.mandatoryComplianceRowsCount > 0) {
    if (mandatoryCoveredForGeneration < input.mandatoryRequirementCount) {
      blockerCodes.push("MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE");
      blockerDetails.push(`${input.mandatoryFullOrSubstantialCoverageCount}/${input.mandatoryRequirementCount} mandatory requirements have release-qualified FULL/SUBSTANTIAL coverage. Strengthen partial evidence or add eligible source-backed evidence for requirements with no adequate evidence.`);
    }
  }

  // ── Priority 11: PDF required but unavailable ────────────────────────
  const complianceOK = requirementsOK && input.confirmedBuildPlanExists &&
    (input.mandatoryRequirementCount === 0 || (input.mandatoryComplianceRowsCount > 0 && mandatoryCoveredForGeneration >= input.mandatoryRequirementCount));
  if (complianceOK && input.pdfRequiredButUnavailable) {
    blockerCodes.push("PDF_REQUIRED_UNAVAILABLE");
    blockerDetails.push("Required PDF output is unavailable. Finalize the required PDF or upload the tender-issued PDF.");
  }

  // ── Priority 12: Required docs not generated ─────────────────────────
  const pdfOK = complianceOK && !input.pdfRequiredButUnavailable;
  if (pdfOK && input.generatedDocumentsTotal < input.requiredDocumentsTotal) {
    blockerCodes.push("REQUIRED_DOCS_NOT_GENERATED");
    blockerDetails.push(`${input.generatedDocumentsTotal}/${input.requiredDocumentsTotal} required documents generated.`);
  }

  // ── Priority 13: Docs not validated ──────────────────────────────────
  const docsGenerated = pdfOK && input.generatedDocumentsTotal >= input.requiredDocumentsTotal;
  if (docsGenerated && !input.documentsValidated) {
    blockerCodes.push("DOCS_NOT_VALIDATED");
    blockerDetails.push("Generated documents have not been validated.");
  }

  // ── Priority 14: Machine export eligibility ─────────────────────────
  // Validation is the machine authority for routine downstream processing.
  // `reviewStatus` is retained as human/legal release audit state, but a
  // per-document approval click must not deadlock DOCX/PDF/ZIP production.
  const docsValidated = docsGenerated && input.documentsValidated;

  // ── Priority 15: Authority or quality blockers ───────────────────────
  const docsApproved = docsValidated;
  if (docsApproved && input.authorityOrQualityBlockers) {
    blockerCodes.push("AUTHORITY_OR_QUALITY_BLOCKERS");
    blockerDetails.push("Authority review or document quality blockers remain.");
  }

  // ── Priority 16: Export ZIP ready ────────────────────────────────────
  const allClear = docsApproved && !input.authorityOrQualityBlockers;
  if (allClear && input.finalExportAllowed) {
    // No blockers — ready for export
  } else if (allClear && !input.finalExportAllowed) {
    blockerCodes.push("EXPORT_BLOCKED");
    blockerDetails.push("Export gate is not satisfied.");
  }

  // ── Determine the highest-priority blocker ───────────────────────────
  const priorityOrder: WorkflowBlockerPriority[] = [
    "NO_TENDER_FILE",
    "EXTRACTION_UNSAFE",
    "PARTIAL_AI_ANALYSIS",
    "STALE_ANALYSIS",
    "AI_ANALYZE_NOT_RUN",
    "ENGINE_RUN_FAILED",
    "CRITICAL_TENDER_DETAILS_INVALID",
    "REQUIREMENTS_NOT_SOURCE_GROUNDED",
    "NO_CONFIRMED_BUILD_PLAN",
    "MANDATORY_NO_COMPLIANCE_ROWS",
    "MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE",
    "PDF_REQUIRED_UNAVAILABLE",
    "REQUIRED_DOCS_NOT_GENERATED",
    "DOCS_NOT_VALIDATED",
    "DOCS_NOT_APPROVED_EXPORT_READY",
    "AUTHORITY_OR_QUALITY_BLOCKERS",
    "EXPORT_BLOCKED",
    "EXPORT_ZIP_READY",
  ];

  let currentBlockingStage: WorkflowBlockerPriority = "EXPORT_ZIP_READY";
  for (const p of priorityOrder) {
    if (blockerCodes.includes(p)) {
      currentBlockingStage = p;
      break;
    }
  }

  // ── Build next action from the highest-priority blocker ──────────────
  const actionMap: Record<WorkflowBlockerPriority, { action: string; label: string; reason: string }> = {
    NO_TENDER_FILE: { action: "UPLOAD_TENDER", label: "Upload tender document", reason: "No tender file has been uploaded. Upload a PDF or DOCX to begin." },
    EXTRACTION_UNSAFE: { action: "FIX_EXTRACTION", label: "Fix Extraction First", reason: "Extraction is weak, corrupted, or requires OCR. Fix extraction before AI Analyze." },
    PARTIAL_AI_ANALYSIS: { action: "RESUME_AI_ANALYZE", label: "Resume AI Analyze", reason: "A previous AI Analyze run has saved partial progress. Resume it to complete the missing chunks." },
    STALE_ANALYSIS: { action: "RUN_AI_ANALYZE", label: "Re-run AI Analyze", reason: "Tender content changed since the last analysis. Re-run AI Analyze for the current content." },
    AI_ANALYZE_NOT_RUN: { action: "RUN_AI_ANALYZE", label: "Run AI Analyze", reason: "AI Analyze has not been run or is untrusted." },
    ENGINE_RUN_FAILED: { action: "REPAIR_SOURCE_REFERENCES", label: "Repair title source evidence", reason: "The current-revision Engine run failed. Resolve its first recorded fail-closed cause before retrying Run Engine." },
    CRITICAL_TENDER_DETAILS_INVALID: { action: "EDIT_TENDER_METADATA", label: "Edit Tender Details", reason: "Critical Tender Details are missing, invalid, or ungrounded." },
    REQUIREMENTS_NOT_SOURCE_GROUNDED: input.requirementsExist
      ? { action: "REPAIR_SOURCE_GROUNDING", label: "Ground requirements from source", reason: "The system must verify each requirement against the active source. If it cannot, re-run AI Analyze, upload a better source, or make a genuine source correction; review or confirmation cannot promote unsupported provenance." }
      : { action: "RUN_AI_ANALYZE", label: "Re-run AI Analyze", reason: "No source-grounded requirements are available for the current verified source." },
    NO_CONFIRMED_BUILD_PLAN: { action: "RUN_ENGINE", label: "Run Engine", reason: "Run Engine uses the current verified source and current AI analysis, then starts matching and automatic Build Plan creation." },
    MANDATORY_NO_COMPLIANCE_ROWS: { action: "LINK_VAULT_EVIDENCE", label: "Link evidence to requirements", reason: `${input.mandatoryRequirementCount} mandatory requirements have no compliance matrix rows. Run Engine to link evidence.` },
    MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE: { action: "LINK_VAULT_EVIDENCE", label: "Source evidence required", reason: `Automatic matching found release-qualified FULL/SUBSTANTIAL coverage for ${input.mandatoryFullOrSubstantialCoverageCount}/${input.mandatoryRequirementCount} mandatory requirements. Strengthen partial evidence or add eligible source-backed evidence where none is adequate; no confirmation click can bypass this gate.` },
    PDF_REQUIRED_UNAVAILABLE: { action: "FINALIZE_REQUIRED_PDF", label: "Finalize required PDF", reason: "Required PDF output is unavailable. Finalize the required PDF (from the approved DOCX source) or upload the tender-issued PDF." },
    REQUIRED_DOCS_NOT_GENERATED: { action: "GENERATE_DOCUMENTS", label: "Generate proposal documents", reason: `${input.generatedDocumentsTotal}/${input.requiredDocumentsTotal} required documents generated.` },
    DOCS_NOT_VALIDATED: { action: "FIX_EXPORT_BLOCKERS", label: "Validate documents", reason: "Generated documents have not been validated." },
    DOCS_NOT_APPROVED_EXPORT_READY: { action: "AUTOMATIC_PROCESSING", label: "Checking machine export eligibility", reason: "The durable worker verifies document validation, byte integrity, format and package eligibility without impersonating human release authority." },
    AUTHORITY_OR_QUALITY_BLOCKERS: { action: "FIX_EXPORT_BLOCKERS", label: "Fix authority/quality blockers", reason: "Authority review or document quality blockers remain." },
    EXPORT_BLOCKED: { action: "FIX_EXPORT_BLOCKERS", label: "Resolve export blockers", reason: "Export gate is not satisfied. Resolve the remaining export blockers before downloading the final ZIP." },
    EXPORT_ZIP_READY: { action: "EXPORT_READY", label: "Export ready", reason: "All gates pass. Review the final package manifest and export the submission ZIP." },
  };

  const action = actionMap[currentBlockingStage];
  const downstreamSuppressedBy = currentBlockingStage !== "EXPORT_ZIP_READY" ? currentBlockingStage : null;

  // ── Build per-stage states ───────────────────────────────────────────
  const stageStates: CanonicalWorkflowDecision["stageStates"] = {};
  const stageAvailability: CanonicalWorkflowDecision["stageAvailability"] = {};

  // Helper: is this stage suppressed by an upstream blocker?
  const isSuppressed = (stageMinPriority: WorkflowBlockerPriority): boolean => {
    const stageIdx = priorityOrder.indexOf(stageMinPriority);
    const blockerIdx = priorityOrder.indexOf(currentBlockingStage);
    return blockerIdx < stageIdx;
  };

  // Upload: always available
  stageStates["UPLOAD_TENDER"] = input.hasFiles ? "COMPLETE" : "READY";
  stageAvailability["UPLOAD_TENDER"] = true;

  // Extraction
  stageStates["FIX_EXTRACTION"] = input.extractionUnsafe ? "BLOCKED" : input.hasFiles ? "COMPLETE" : "WAITING_ON_PRIOR_STEP";
  stageAvailability["FIX_EXTRACTION"] = input.hasFiles && !input.extractionUnsafe;

  // AI Analyze
  // RUN_AI_ANALYZE is the ACTION that resolves PARTIAL_AI_ANALYSIS,
  // STALE_ANALYSIS, and AI_ANALYZE_NOT_RUN. It is only BLOCKED_BY_PRIOR_STEP
  // when the blocker is BEFORE the AI analyze stage (NO_TENDER_FILE or
  // EXTRACTION_UNSAFE). When the blocker IS an AI-stage blocker, RUN_AI_ANALYZE
  // is IN_PROGRESS (partial) / BLOCKED (stale, needs re-run) / READY (not run).
  const aiStageSuppressed = currentBlockingStage === "NO_TENDER_FILE" || currentBlockingStage === "EXTRACTION_UNSAFE";
  if (aiStageSuppressed) {
    stageStates["RUN_AI_ANALYZE"] = "BLOCKED_BY_PRIOR_STEP";
    stageAvailability["RUN_AI_ANALYZE"] = false;
  } else if (input.aiAnalysisPartial) {
    stageStates["RUN_AI_ANALYZE"] = "IN_PROGRESS";
    stageAvailability["RUN_AI_ANALYZE"] = true;
  } else if (input.aiAnalysisStale) {
    stageStates["RUN_AI_ANALYZE"] = "BLOCKED";
    stageAvailability["RUN_AI_ANALYZE"] = true;
  } else if (input.aiAnalysisExists && input.aiAnalysisTrusted) {
    stageStates["RUN_AI_ANALYZE"] = "COMPLETE";
    stageAvailability["RUN_AI_ANALYZE"] = false;
  } else {
    stageStates["RUN_AI_ANALYZE"] = "READY";
    stageAvailability["RUN_AI_ANALYZE"] = true;
  }

  // Confirm Requirements
  if (isSuppressed("REQUIREMENTS_NOT_SOURCE_GROUNDED")) {
    stageStates["CONFIRM_REQUIREMENTS"] = "BLOCKED_BY_PRIOR_STEP";
    stageAvailability["CONFIRM_REQUIREMENTS"] = false;
  } else if (!input.requirementsTrusted) {
    stageStates["CONFIRM_REQUIREMENTS"] = "BLOCKED";
    // Historical stage key retained for response compatibility only. It is
    // deliberately not actionable: confirmation cannot promote provenance.
    stageAvailability["CONFIRM_REQUIREMENTS"] = false;
  } else {
    stageStates["CONFIRM_REQUIREMENTS"] = "COMPLETE";
    stageAvailability["CONFIRM_REQUIREMENTS"] = false;
  }

  // Build Plan
  if (isSuppressed("NO_CONFIRMED_BUILD_PLAN")) {
    stageStates["BUILD_SUBMISSION_PLAN"] = "BLOCKED_BY_PRIOR_STEP";
    stageAvailability["BUILD_SUBMISSION_PLAN"] = false;
  } else if (!input.confirmedBuildPlanExists) {
    stageStates["BUILD_SUBMISSION_PLAN"] = "READY";
    stageAvailability["BUILD_SUBMISSION_PLAN"] = true;
  } else {
    stageStates["BUILD_SUBMISSION_PLAN"] = "COMPLETE";
    stageAvailability["BUILD_SUBMISSION_PLAN"] = false;
  }

  // Match Evidence
  if (isSuppressed("MANDATORY_NO_COMPLIANCE_ROWS")) {
    stageStates["MATCH_EVIDENCE"] = "BLOCKED_BY_PRIOR_STEP";
    stageAvailability["MATCH_EVIDENCE"] = false;
  } else if (
    input.mandatoryRequirementCount > 0
    && input.mandatoryFullOrSubstantialCoverageCount + (input.mandatoryAwaitingPlannedOutputCount ?? 0)
       < input.mandatoryRequirementCount
  ) {
    stageStates["MATCH_EVIDENCE"] = "BLOCKED";
    stageAvailability["MATCH_EVIDENCE"] = true;
  } else {
    stageStates["MATCH_EVIDENCE"] = input.confirmedBuildPlanExists ? "READY" : "WAITING_ON_PRIOR_STEP";
    stageAvailability["MATCH_EVIDENCE"] = input.confirmedBuildPlanExists;
  }

  // Generate Documents
  if (isSuppressed("REQUIRED_DOCS_NOT_GENERATED")) {
    stageStates["GENERATE_DOCUMENTS"] = "BLOCKED_BY_PRIOR_STEP";
    stageAvailability["GENERATE_DOCUMENTS"] = false;
  } else if (input.generatedDocumentsTotal < input.requiredDocumentsTotal) {
    stageStates["GENERATE_DOCUMENTS"] = "READY";
    stageAvailability["GENERATE_DOCUMENTS"] = true;
  } else {
    stageStates["GENERATE_DOCUMENTS"] = "COMPLETE";
    stageAvailability["GENERATE_DOCUMENTS"] = false;
  }

  // Validate and Approve
  if (isSuppressed("DOCS_NOT_VALIDATED")) {
    stageStates["VALIDATE_DOCS"] = "BLOCKED_BY_PRIOR_STEP";
    stageAvailability["VALIDATE_DOCS"] = false;
  } else if (!input.documentsValidated) {
    stageStates["VALIDATE_DOCS"] = "READY";
    stageAvailability["VALIDATE_DOCS"] = true;
  } else {
    stageStates["VALIDATE_DOCS"] = "COMPLETE";
    stageAvailability["VALIDATE_DOCS"] = false;
  }

  // Export ZIP
  if (isSuppressed("EXPORT_ZIP_READY")) {
    stageStates["EXPORT_ZIP"] = "BLOCKED_BY_PRIOR_STEP";
    stageAvailability["EXPORT_ZIP"] = false;
  } else if (input.finalExportAllowed) {
    stageStates["EXPORT_ZIP"] = "READY";
    stageAvailability["EXPORT_ZIP"] = true;
  } else {
    stageStates["EXPORT_ZIP"] = "BLOCKED";
    stageAvailability["EXPORT_ZIP"] = false;
  }

  return {
    currentBlockingStage,
    nextRequiredAction: action.action,
    nextRequiredActionLabel: action.label,
    nextRequiredActionReason: action.reason,
    blockingStageCode: currentBlockingStage,
    blockerCodes,
    blockerDetails,
    stageStates,
    stageAvailability,
    downstreamSuppressedBy,
    partialAnalysis: input.aiAnalysisPartial,
    staleAnalysis: input.aiAnalysisStale,
    confirmedBuildPlanExists: input.confirmedBuildPlanExists,
    mandatoryRequirementCount: input.mandatoryRequirementCount,
    mandatoryTracedCount: input.mandatoryTracedCount,
    mandatoryComplianceRowsCount: input.mandatoryComplianceRowsCount,
    mandatoryFullOrSubstantialCoverageCount: input.mandatoryFullOrSubstantialCoverageCount,
    mandatoryAwaitingPlannedOutputCount: input.mandatoryAwaitingPlannedOutputCount ?? 0,
    requiredDocumentsTotal: input.requiredDocumentsTotal,
    generatedDocumentsTotal: input.generatedDocumentsTotal,
    exportReadyDocumentsTotal: input.exportReadyDocumentsTotal,
    pdfRequiredButUnavailable: input.pdfRequiredButUnavailable,
    finalExportAllowed: input.finalExportAllowed,
  };
}

// ─── DB-bound resolver ───────────────────────────────────────────────────────
//
// buildCanonicalWorkflowDecision is pure — it cannot call Prisma. This async
// wrapper gathers every input the pure helper needs (snapshot + generated-doc
// validation/approval state + compliance gaps) and forwards them to the pure
// helper. Every consumer that lives inside a server route or server component
// MUST call this resolver instead of recomputing local truth — that is the
// whole point of "one canonical workflow decision across all panels".

import type { PrismaClient } from "@prisma/client";
import { getTenderReleaseSnapshot } from "./tender-release-snapshot";
import { computeEngineSourceRevision } from "./engine-source-revision";
import { filterFinalExportCandidateDocuments, isValidationPassed } from "./document-output-state";

export async function getCanonicalTenderWorkflowDecision(
  prisma: PrismaClient,
  userId: string,
  tenderId: string,
): Promise<CanonicalWorkflowDecision | null> {
  const snapshot = await getTenderReleaseSnapshot(prisma, tenderId, userId);
  if (!snapshot) return null;

  // ─── Analysis state ─────────────────────────────────────────────────────
  // The snapshot's analysis.state is the canonical analysis state machine.
  // - PARTIAL_NEEDS_RESUME: AI ran but some chunks are pending/failed and resumable
  // - REGEX_FALLBACK_UNAPPROVED / HUMAN_APPROVED_FALLBACK: untrusted
  // - AI_SUCCEEDED + contentHashMatch: trusted & current
  // - AI_SUCCEEDED + !contentHashMatch: stale (content changed since analysis)
  const analysisState = snapshot.analysis.state;
  const aiAnalysisExists = analysisState !== "NOT_STARTED";
  const aiAnalysisPartial =
    analysisState === "PARTIAL_NEEDS_RESUME" ||
    analysisState === "RUNNING" ||
    analysisState === "QUEUED";
  const aiAnalysisStale =
    aiAnalysisExists &&
    analysisState === "AI_SUCCEEDED" &&
    !snapshot.analysis.contentHashMatch;
  const aiAnalysisTrusted =
    analysisState === "AI_SUCCEEDED" &&
    !!snapshot.analysis.canonicalJobId &&
    snapshot.analysis.contentHashMatch;

  // Resumable analysis: any partial OR a failed job with succeeded chunks.
  // The NextActionPanel already queries this separately; for the canonical
  // decision we treat PARTIAL_NEEDS_RESUME as resumable.
  const resumableAnalysisAvailable = analysisState === "PARTIAL_NEEDS_RESUME";

  // ─── Tender Details authority ─────────────────────────────────────────
  // Pre-generation workflow stages use the canonical DRAFT authority signal.
  // Final-only source/audit authority is deliberately not applied here; it is
  // already enforced by snapshot.finalZipEligible at the export boundary.
  const criticalTenderDetailsValid = !snapshot.metadata.hasGenerationBlocker;

  // ─── Requirements ───────────────────────────────────────────────────────
  const mandatoryRequirementCount = snapshot.requirements.mandatory;
  const mandatoryTracedCount = snapshot.requirements.groundedMandatory;
  // Compliance matrix rows: count of mandatory requirements with ANY compliance row
  // (the snapshot doesn't expose the raw count, so derive from evidence.covered
  // when possible — covered = mandatory reqs with FULL/SUBSTANTIAL/COMPLIANT/STRONG).
  // For "any row" we need a separate query, but the snapshot's evidence.covered
  // already tells us FULL/SUBSTANTIAL coverage count.
  const mandatoryComplianceRowsCount = await (async () => {
    // Quick count of mandatory requirements with ANY complianceMatrixRow.
    const anyRowCount = await prisma.tenderRequirement.count({
      where: {
        tenderId,
        priority: { in: ["MANDATORY", "CRITICAL"] },
        complianceMatrixRows: { some: {} },
      },
    }).catch(() => 0);
    return anyRowCount;
  })();
  const mandatoryFullOrSubstantialCoverageCount = snapshot.evidence.covered;

  // Mandatory requirements whose outstanding evidence is a file this workflow
  // will generate. This asks exactly: is this requirement waiting on
  // generation, and on nothing else?
  //
  // AUTO_PLANNED_ARTIFACT is written to `evidenceSource`, not `evidenceType`.
  // automatic-requirement-coverage persists a confirmed Build Plan row as
  // `evidenceType: candidate.recordType` ("BUILD_PLAN_ITEM") and
  // `evidenceSource: automaticEvidenceSource(recordType)`
  // ("AUTO_PLANNED_ARTIFACT"). Filtering evidenceType for that value therefore
  // matched no row ever written, so this count was permanently 0 and the
  // allowance below was dead code — producing precisely the deadlock its own
  // comment warns about: the Requirements and Evidence panel showed both
  // outstanding requirements as PARTIAL "planned output pending generated
  // bytes", while the generation gate refused to produce those bytes because
  // coverage was 2/4. Neither side could move first.
  //
  // The NOT clause keeps it from double counting a requirement that is already
  // covered by real evidence, so the sum with evidence.covered can never exceed
  // the mandatory total.
  const mandatoryAwaitingPlannedOutputCount = await prisma.tenderRequirement.count({
    where: {
      tenderId,
      priority: { in: ["MANDATORY", "CRITICAL"] },
      complianceMatrixRows: { some: { evidenceSource: "AUTO_PLANNED_ARTIFACT" } },
      NOT: { complianceMatrixRows: { some: { supportLevel: { in: ["FULL", "SUBSTANTIAL"] } } } },
    },
  }).catch(() => 0);
  const requirementsTrusted =
    snapshot.requirements.total > 0 &&
    snapshot.requirements.allMandatoryGrounded;

  // ─── Build Plan ─────────────────────────────────────────────────────────
  // Use the GATE-ALIGNED strict validity (snapshot.buildPlan.gateValid) —
  // it mirrors the generation gate exactly. The count-based valid flag is
  // retained only for backward UI display and CANNOT be the canonical truth.
  const confirmedBuildPlanExists = snapshot.buildPlan.gateValid;

  // ─── Generated Documents ────────────────────────────────────────────────
  // Fetch generated docs (non-SUPERSEDED) with validation + review status.
  const generatedDocRows = await prisma.generatedDocument.findMany({
    where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
    select: {
      id: true,
      name: true,
      generationStatus: true,
      validationStatus: true,
      reviewStatus: true,
      exactFileName: true,
      // Required by the canonical selection below — without them a CONTROL
      // row or a SUBMISSION_CONTROL row cannot be recognised and is counted
      // as a current export-ready output.
      format: true,
      documentType: true,
    },
  }).catch(() => [] as Array<{ id: string; name: string; generationStatus: string; validationStatus: string | null; reviewStatus: string | null; exactFileName: string | null; format: string | null; documentType: string | null }>);

  // CANONICAL current-document selection — the same predicate the export gate,
  // the Final Package Manifest, the Document Validator and readiness use.
  //
  // This was `d.generationStatus === "GENERATED"`, a private sixth copy of the
  // rule, and it disagreed with the gate in the dangerous direction: on a set
  // of seven rows it reported SIX export-ready documents where the export gate
  // accepts ONE. It counted a row the owner had explicitly marked
  // NOT_EXPORTABLE, a row still awaiting its tender-issued original
  // (REPLACE_WITH_ORIGINAL), a CONTROL-format row, a SUBMISSION_CONTROL row and
  // an internal quick draft — every one of which the final package refuses.
  // exportReadyDocumentsTotal is surfaced by /api/tenders/[id]/workflow-status,
  // so the workflow told the owner the package was ready while the gate
  // declined it.
  const generatedDocs = filterFinalExportCandidateDocuments(generatedDocRows);

  const generatedDocumentsTotal = generatedDocs.length;

  // Required documents total: derive from the build plan items (count where required).
  // Fall back to generatedDocs.length when no plan exists yet.
  let requiredDocumentsTotal = 0;
  try {
    const buildPlanRow = await prisma.buildPlan.findUnique({
      where: { tenderId },
      select: { itemsJson: true },
    });
    if (buildPlanRow?.itemsJson) {
      const items = JSON.parse(buildPlanRow.itemsJson) as Array<{ required?: boolean }>;
      requiredDocumentsTotal = items.filter((i) => i.required !== false).length;
    }
  } catch {
    requiredDocumentsTotal = 0;
  }
  // If no plan yet but docs exist, use the doc count so the "X/Y required" reads sanely.
  if (requiredDocumentsTotal === 0 && generatedDocumentsTotal > 0) {
    requiredDocumentsTotal = generatedDocumentsTotal;
  }

  // Documents validated: every generated doc has validationStatus PASSED/VALIDATED.
  const documentsValidated =
    generatedDocumentsTotal > 0 &&
    generatedDocs.every((d) => isValidationPassed(d.validationStatus));

  // Routine machine eligibility is established by successful validation.
  // Human reviewStatus remains available for genuine legal/signature/owner
  // release controls, but it is not a second per-document pipeline gate.
  const documentsApproved = documentsValidated;

  // Machine-export-eligible count: generated + validated.
  const exportReadyDocumentsTotal = generatedDocs.filter(
    (d) => isValidationPassed(d.validationStatus),
  ).length;

  // ─── PDF required but unavailable ───────────────────────────────────────
  // Detect via the existing export-format-policy helpers. If the tender
  // requires PDF output and no PDF has been generated, this is a blocker.
  // PR #1034 may refine this with FINALIZE_REQUIRED_PDF wording — the
  // canonical decision's priority chain is structured so #1034 can update
  // the wording/action without changing the priority order.
  let pdfRequiredButUnavailable = false;
  try {
    const policyModule: typeof import("./export-format-policy") = await import("./export-format-policy");
    // Fetch the tender row (lightweight) for policy detection.
    const tenderRow = await prisma.tender.findUnique({
      where: { id: tenderId },
      select: {
        id: true, title: true, description: true, intakeSummary: true,
        exactFileNaming: true, requestedFormats: true,
        files: { select: { originalFileName: true, extractedText: true } },
      },
    });
    if (tenderRow) {
      const policy = policyModule.detectTenderFormatPolicy(tenderRow as any);
      // Map generated docs to extensions.
      const extensions = generatedDocs.map((d) => {
        const name = (d.exactFileName ?? "").toLowerCase();
        if (name.endsWith(".pdf")) return "pdf";
        if (name.endsWith(".docx") || name.endsWith(".doc")) return "docx";
        if (name.endsWith(".xlsx") || name.endsWith(".xls")) return "xlsx";
        return "";
      }).filter(Boolean);
      const coverage = policyModule.checkTenderFormatCoverage(policy, extensions);
      if (!coverage.ok && coverage.code === "PDF_REQUIRED_CONVERSION_UNAVAILABLE") {
        pdfRequiredButUnavailable = true;
      }
    }
  } catch {
    pdfRequiredButUnavailable = false;
  }

  // ─── Authority / quality blockers ───────────────────────────────────────
  // Any unresolved CRITICAL compliance gap, or any export blocker that isn't
  // a generation/plan/extraction blocker (i.e. quality/authority blockers).
  const authorityOrQualityBlockers =
    snapshot.exportBlockers.length > 0 && !snapshot.generationEligible
      ? false // generation blockers exist — authority/quality not yet relevant
      : snapshot.exportBlockers.length > snapshot.generationBlockers.length;

  // ─── Final export allowed ───────────────────────────────────────────────
  // The snapshot's finalZipEligible is the gate-aligned, fail-closed flag.
  // It already incorporates generation + export + final ZIP gates.
  const finalExportAllowed = snapshot.finalZipEligible;

  const decision = buildCanonicalWorkflowDecision({
    hasFiles: snapshot.extraction.activeFileCount > 0,
    extractionUnsafe: !snapshot.extraction.overallOk,
    extractionCorrupted: snapshot.extraction.files.some((f) => f.corrupted),
    ocrRequired: false, // snapshot doesn't expose OCR flag separately; extraction.blocker covers it
    aiAnalysisExists,
    aiAnalysisTrusted,
    aiAnalysisPartial,
    aiAnalysisStale,
    resumableAnalysisAvailable,
    criticalTenderDetailsValid,
    requirementsExist: snapshot.requirements.total > 0,
    requirementsTrusted,
    mandatoryRequirementCount,
    mandatoryTracedCount,
    mandatoryComplianceRowsCount,
    mandatoryFullOrSubstantialCoverageCount,
    // Computed above and previously dropped here. Because the field is
    // optional, omitting it silently resolved to `?? 0`, so the planned-output
    // allowance was inert no matter what the query returned — the whole reason
    // the generation deadlock survived a fix to the query itself.
    mandatoryAwaitingPlannedOutputCount,
    confirmedBuildPlanExists,
    requiredDocumentsTotal,
    generatedDocumentsTotal,
    exportReadyDocumentsTotal,
    documentsValidated,
    documentsApproved,
    pdfRequiredButUnavailable,
    finalExportAllowed,
    authorityOrQualityBlockers,
  });

  // A terminal failure from the latest Engine attempt for these exact inputs
  // is current workflow truth. It outranks secondary consequences such as an
  // absent Build Plan or requirement links that the failed stage never reached.
  const revision = await computeEngineSourceRevision(prisma, { tenderId, userId }).catch(() => null);
  const latestEngine = revision
    ? await prisma.aiJob.findFirst({
        where: { tenderId, userId, jobType: "ENGINE_RUN", analysisInputHash: revision.sourceRevision },
        orderBy: [{ createdAt: "desc" }, { analysisVersion: "desc" }],
        select: {
          id: true,
          status: true,
          errorMessage: true,
          steps: {
            where: { status: "FAILED" },
            orderBy: { stepIndex: "asc" },
            select: { stepName: true, message: true },
          },
        },
      }).catch(() => null)
    : null;
  if (latestEngine && ["FAILED", "CANCELED"].includes(latestEngine.status)) {
    const cause = latestEngine.steps.find((step) => step.stepName === "build-plan.blocked")
      ?? latestEngine.steps[0];
    // A failed stage is preferred, but older jobs (including Preview failure
    // 03b9c928) stored the validator's concrete blocker only on errorMessage.
    // Combine both for internal classification, then pass the result through
    // the fixed public mapper so no raw exception crosses the API boundary.
    const recordedDetail = `${cause?.message ?? ""} ${latestEngine.errorMessage ?? ""}`.trim();
    const titleProvenance = /TENDER_FACTS_INVALID|metadata field title|title.*source page/i.test(recordedDetail);
    const reference = latestEngine.id.slice(0, 8);
    const safeDetail = publicJobFailureMessage(recordedDetail || "ENGINE_RUN_FAILED", reference);
    return {
      ...decision,
      currentBlockingStage: "ENGINE_RUN_FAILED",
      blockingStageCode: titleProvenance ? "TITLE_SOURCE_PROVENANCE_INVALID" : "ENGINE_RUN_FAILED",
      blockerCodes: [titleProvenance ? "TITLE_SOURCE_PROVENANCE_INVALID" : "ENGINE_RUN_FAILED"],
      blockerDetails: [safeDetail],
      nextRequiredAction: titleProvenance ? "REPAIR_SOURCE_REFERENCES" : "RUN_ENGINE",
      nextRequiredActionLabel: titleProvenance ? "Repair title source evidence" : "Retry Run Engine",
      nextRequiredActionReason: titleProvenance
        ? safeDetail
        : `${safeDetail} Open Diagnostics for the recorded stage, then retry only after its stated cause is resolved.`,
      downstreamSuppressedBy: "ENGINE_RUN_FAILED",
    };
  }
  return decision;
}
