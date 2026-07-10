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

export type WorkflowBlockerPriority =
  | "NO_TENDER_FILE"
  | "EXTRACTION_UNSAFE"
  | "PARTIAL_AI_ANALYSIS"
  | "STALE_ANALYSIS"
  | "AI_ANALYZE_NOT_RUN"
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
  mandatoryComplianceRowsCount: number;
  mandatoryFullOrSubstantialCoverageCount: number;

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
      ? "Extraction is corrupted. Run OCR or re-upload a clearer scan."
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
        ? "Requirements exist but lack source tracing. Review and confirm source grounding."
        : "No requirements available. Run AI Analyze.");
    }
  }

  // ── Priority 8: No confirmed Build Plan ──────────────────────────────
  const requirementsOK = analysisOK && input.criticalTenderDetailsValid && input.requirementsTrusted;
  if (requirementsOK && !input.confirmedBuildPlanExists) {
    blockerCodes.push("NO_CONFIRMED_BUILD_PLAN");
    blockerDetails.push("No current confirmed Build Plan. Build and confirm the submission plan.");
  }

  // ── Priority 9: Mandatory no compliance rows ─────────────────────────
  if (requirementsOK && input.confirmedBuildPlanExists) {
    if (input.mandatoryRequirementCount > 0 && input.mandatoryComplianceRowsCount === 0) {
      blockerCodes.push("MANDATORY_NO_COMPLIANCE_ROWS");
      blockerDetails.push(`${input.mandatoryRequirementCount} mandatory requirements have no compliance matrix rows. Run Engine to link evidence.`);
    }
  }

  // ── Priority 10: Mandatory no FULL/SUBSTANTIAL coverage ──────────────
  if (requirementsOK && input.confirmedBuildPlanExists && input.mandatoryRequirementCount > 0 && input.mandatoryComplianceRowsCount > 0) {
    if (input.mandatoryFullOrSubstantialCoverageCount < input.mandatoryRequirementCount) {
      blockerCodes.push("MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE");
      blockerDetails.push(`${input.mandatoryFullOrSubstantialCoverageCount}/${input.mandatoryRequirementCount} mandatory requirements have FULL/SUBSTANTIAL coverage. Confirm more evidence.`);
    }
  }

  // ── Priority 11: PDF required but unavailable ────────────────────────
  const complianceOK = requirementsOK && input.confirmedBuildPlanExists &&
    (input.mandatoryRequirementCount === 0 || (input.mandatoryComplianceRowsCount > 0 && input.mandatoryFullOrSubstantialCoverageCount >= input.mandatoryRequirementCount));
  if (complianceOK && input.pdfRequiredButUnavailable) {
    blockerCodes.push("PDF_REQUIRED_UNAVAILABLE");
    blockerDetails.push("Required PDF output is unavailable. Upload a PDF or enable PDF conversion.");
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

  // ── Priority 14: Docs not approved/export-ready ──────────────────────
  const docsValidated = docsGenerated && input.documentsValidated;
  if (docsValidated && !input.documentsApproved) {
    blockerCodes.push("DOCS_NOT_APPROVED_EXPORT_READY");
    blockerDetails.push("Documents are validated but not approved for export.");
  }

  // ── Priority 15: Authority or quality blockers ───────────────────────
  const docsApproved = docsValidated && input.documentsApproved;
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
    CRITICAL_TENDER_DETAILS_INVALID: { action: "EDIT_TENDER_METADATA", label: "Edit Tender Details", reason: "Critical Tender Details are missing, invalid, or ungrounded." },
    REQUIREMENTS_NOT_SOURCE_GROUNDED: { action: "REVIEW_REQUIREMENTS", label: "Review requirements", reason: "Requirements exist but lack source tracing. Review and confirm source grounding." },
    NO_CONFIRMED_BUILD_PLAN: { action: "BUILD_SUBMISSION_PLAN", label: "Build submission plan", reason: "No current confirmed Build Plan. Build and confirm the submission plan." },
    MANDATORY_NO_COMPLIANCE_ROWS: { action: "LINK_VAULT_EVIDENCE", label: "Link evidence to requirements", reason: `${input.mandatoryRequirementCount} mandatory requirements have no compliance matrix rows. Run Engine to link evidence.` },
    MANDATORY_NO_FULL_SUBSTANTIAL_COVERAGE: { action: "LINK_VAULT_EVIDENCE", label: "Confirm evidence coverage", reason: `${input.mandatoryFullOrSubstantialCoverageCount}/${input.mandatoryRequirementCount} mandatory requirements have FULL/SUBSTANTIAL coverage.` },
    PDF_REQUIRED_UNAVAILABLE: { action: "GENERATE_DOCUMENTS", label: "Generate documents (PDF required)", reason: "Required PDF output is unavailable. Upload a PDF or enable PDF conversion." },
    REQUIRED_DOCS_NOT_GENERATED: { action: "GENERATE_DOCUMENTS", label: "Generate proposal documents", reason: `${input.generatedDocumentsTotal}/${input.requiredDocumentsTotal} required documents generated.` },
    DOCS_NOT_VALIDATED: { action: "FIX_EXPORT_BLOCKERS", label: "Validate documents", reason: "Generated documents have not been validated." },
    DOCS_NOT_APPROVED_EXPORT_READY: { action: "FIX_EXPORT_BLOCKERS", label: "Approve documents for export", reason: "Documents are validated but not approved for export." },
    AUTHORITY_OR_QUALITY_BLOCKERS: { action: "FIX_EXPORT_BLOCKERS", label: "Fix authority/quality blockers", reason: "Authority review or document quality blockers remain." },
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
  if (isSuppressed("AI_ANALYZE_NOT_RUN")) {
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
    stageAvailability["CONFIRM_REQUIREMENTS"] = true;
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
  } else if (input.mandatoryRequirementCount > 0 && input.mandatoryFullOrSubstantialCoverageCount < input.mandatoryRequirementCount) {
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
  } else if (!input.documentsValidated || !input.documentsApproved) {
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
    mandatoryComplianceRowsCount: input.mandatoryComplianceRowsCount,
    mandatoryFullOrSubstantialCoverageCount: input.mandatoryFullOrSubstantialCoverageCount,
    requiredDocumentsTotal: input.requiredDocumentsTotal,
    generatedDocumentsTotal: input.generatedDocumentsTotal,
    exportReadyDocumentsTotal: input.exportReadyDocumentsTotal,
    pdfRequiredButUnavailable: input.pdfRequiredButUnavailable,
    finalExportAllowed: input.finalExportAllowed,
  };
}
