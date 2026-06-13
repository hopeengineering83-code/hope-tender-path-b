// Recovery Command Center action registry.
//
// Keep this helper pure and client-safe: the UI imports it to decide how to
// execute actions, and tests import it to verify every visible Execute button
// points at a real API route, an existing dashboard anchor, or a known page.

export type RecoveryCommandActionKind = "api" | "scroll" | "navigate" | "download" | "custom" | "refresh";

export type RecoveryCommandActionSpec = {
  label: string;
  kind: RecoveryCommandActionKind;
  method?: "GET" | "POST" | "DELETE";
  path?: string;
  anchorId?: string;
  message?: string;
  aliases?: string[];
};

export const RECOVERY_COMMAND_ACTIONS: Record<string, RecoveryCommandActionSpec> = {
  UPLOAD_TENDER_DOCUMENT: {
    label: "Upload Tender Document",
    kind: "scroll",
    anchorId: "tender-files",
    message: "Open the Tender Files panel to upload or re-upload tender documents.",
  },
  CONFIGURE_AI_PROVIDER: {
    label: "Configure AI Provider",
    kind: "navigate",
    path: "/dashboard/analytics",
  },
  RUN_AI_ANALYZE: {
    label: "Run AI Analyze",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/ai-analyze",
  },
  RETRY_AI_ANALYZE: {
    label: "Retry AI Analyze",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/ai-analyze",
  },
  REVIEW_ANALYSIS: {
    label: "Review Analysis",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/ai-analyze",
  },
  APPROVE_FALLBACK_WITH_NOTE: {
    label: "Approve Fallback Analysis (with note)",
    kind: "custom",
    path: "/api/tenders/{tenderId}/approve-analysis",
    aliases: ["APPROVE_FALLBACK"],
  },
  REVOKE_FALLBACK_APPROVAL: {
    label: "Revoke Fallback Approval",
    kind: "api",
    method: "DELETE",
    path: "/api/tenders/{tenderId}/approve-analysis",
  },
  AI_ANALYZE: {
    label: "Run AI Analyze",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/ai-analyze",
    aliases: ["REVIEW_ANALYSIS"],
  },
  COMPLETE_METADATA: {
    label: "Complete Metadata",
    kind: "scroll",
    anchorId: "tender-edit-form",
    message: "Open the Tender Metadata form and complete missing critical fields.",
  },
  REPAIR_SOURCE_REFERENCES: {
    label: "Repair Source References",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/repair-source-grounding",
  },
  BUILD_SUBMISSION_PLAN: {
    label: "Build Submission Plan",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/submission-plan/build",
  },
  RUN_ENGINE: {
    label: "Run Engine",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/engine",
  },
  LINK_VAULT_EVIDENCE: {
    label: "Link Vault Evidence",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/link-vault-evidence-auto",
  },
  GENERATE_REQUIRED_DOCUMENTS: {
    label: "Generate Missing Planned Docs",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/generate-missing-plan-files",
    aliases: ["GENERATE_DOCS", "GENERATE_MISSING_PLANNED_DOCS"],
  },
  GENERATE_MISSING_PLANNED_DOCS: {
    label: "Generate Missing Planned Docs",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/generate-missing-plan-files",
  },
  ATTACH_OFFICIAL_ORIGINALS: {
    label: "Attach Official Originals",
    kind: "scroll",
    anchorId: "generated-documents",
    message: "Open Generated Documents and attach the exact tender-issued originals.",
  },
  REPAIR_DOCUMENT_QUALITY: {
    label: "Repair Document Quality",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/repair-export-gaps",
    aliases: ["REPAIR_DOCS"],
  },
  VALIDATE_DOCS: {
    label: "Validate Docs",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/validate",
  },
  AUTO_FINALIZE: {
    label: "Auto-Finalize",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/auto-finalize",
  },
  RESOLVE_EXPORT_BLOCKERS: {
    label: "Export Readiness",
    kind: "api",
    method: "GET",
    path: "/api/tenders/{tenderId}/export-readiness",
    aliases: ["EXPORT_READINESS"],
  },
  EXPORT_READINESS: {
    label: "Export Readiness",
    kind: "api",
    method: "GET",
    path: "/api/tenders/{tenderId}/export-readiness",
  },
  RECONCILE_OUTSIDE_PLAN_DOCS: {
    label: "Exclude Outside-Plan Docs",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/supersede-outside-plan",
    aliases: ["EXCLUDE_OUTSIDE_PLAN_DOCS"],
  },
  EXCLUDE_OUTSIDE_PLAN_DOCS: {
    label: "Exclude Outside-Plan Docs",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/supersede-outside-plan",
  },
  DOWNLOAD_FINAL_ZIP: {
    label: "Download Final ZIP",
    kind: "download",
    path: "/api/tenders/{tenderId}/download",
    aliases: ["DOWNLOAD_ZIP"],
  },
  RE_CHECK: {
    label: "Re-check readiness",
    kind: "refresh",
  },
  // Scroll targets for API gate error nextAction codes ──────────────────────
  OPEN_EXTRACTION_QUALITY: {
    label: "Open Extraction Quality",
    kind: "scroll",
    anchorId: "extraction-quality",
    message: "Open the Extraction Quality panel to review page extraction coverage and OCR status.",
  },
  OPEN_ANALYSIS_QUALITY: {
    label: "Open Analysis Quality",
    kind: "scroll",
    anchorId: "analysis-quality",
    message: "Open the Analysis Quality panel to review tender analysis completeness and warnings.",
  },
  EDIT_TENDER: {
    label: "Edit Tender",
    kind: "scroll",
    anchorId: "tender-edit-form",
    message: "Open the Tender Metadata form and fill in missing critical fields.",
  },
  EDIT_TENDER_METADATA: {
    label: "Edit Tender Metadata",
    kind: "scroll",
    anchorId: "tender-edit-form",
    message: "Open the Tender Metadata form and correct the client/procuring entity details.",
  },
  CHANGE_BID_DECISION: {
    label: "Change Bid Decision",
    kind: "scroll",
    anchorId: "tender-edit-form",
    message: "Open the Tender edit form and change the bid decision from NO_BID to BID or BID_WITH_CONDITIONS.",
  },
  RUN_OCR_OR_UPLOAD_CLEARER_SCAN: {
    label: "Re-upload or Run OCR",
    kind: "scroll",
    anchorId: "tender-files",
    message: "Open the Tender Files panel to re-upload a clearer scan or trigger OCR on the current file.",
  },
  // Metadata repair / re-extraction ─────────────────────────────────────────
  REPAIR_METADATA: {
    label: "Repair Metadata",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/repair-metadata",
  },
  RE_EXTRACT_METADATA: {
    label: "Re-extract Metadata",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/re-extract-metadata",
  },
  // Company readiness / vault ────────────────────────────────────────────────
  OPEN_COMPANY_READINESS: {
    label: "Open Company Readiness",
    kind: "navigate",
    path: "/dashboard/company/readiness",
    aliases: ["COMPANY_READINESS"],
  },
  // Expert / project match review ────────────────────────────────────────────
  REVIEW_MATCHES: {
    label: "Review Matches",
    kind: "navigate",
    path: "/dashboard/matching",
    aliases: ["REVIEW_MATCHING_INPUTS"],
  },
  REVIEW_MATCHING_INPUTS: {
    label: "Review Matching Inputs",
    kind: "navigate",
    path: "/dashboard/matching",
  },
  // Generation readiness ─────────────────────────────────────────────────────
  OPEN_GENERATION_READINESS: {
    label: "Open Generation Readiness",
    kind: "scroll",
    anchorId: "generated-documents",
    message: "Open the Generated Documents panel to review generation readiness and fix blockers.",
  },
  // Submission plan confirmation ─────────────────────────────────────────────
  CONFIRM_SUBMISSION_PLAN: {
    label: "Confirm Submission Plan",
    kind: "scroll",
    anchorId: "generated-documents",
    message: "Open the Generated Documents panel and confirm each required file in the submission plan.",
  },
  REVIEW_REQUIREMENTS_OR_ADD_MANUAL_PLAN: {
    label: "Review Requirements or Add Plan",
    kind: "scroll",
    anchorId: "generated-documents",
    message: "Open the Generated Documents panel to review extracted requirements or manually add submission plan entries.",
  },
  // Repair source grounding ──────────────────────────────────────────────────
  REPAIR_SOURCE_GROUNDING: {
    label: "Repair Source Grounding",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/repair-source-grounding",
    aliases: ["REPAIR_OR_EDIT_TENDER"],
  },
  // AI Analyze resume / retry aliases ───────────────────────────────────────
  RERUN_AI_ANALYZE: {
    label: "Re-run AI Analyze",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/ai-analyze",
    aliases: ["RERUN_AI_ANALYZE_AFTER_OCR", "RETRY_AI_ANALYZE_OR_APPROVE_FALLBACK", "CONTINUE_AI_ANALYSIS"],
  },
  // Auto-finalize resume ─────────────────────────────────────────────────────
  CONTINUE_AUTO_FINALIZE: {
    label: "Continue Auto-Finalize",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/auto-finalize",
  },
  // Upload source document ───────────────────────────────────────────────────
  UPLOAD_TENDER_SOURCE: {
    label: "Upload Tender Source",
    kind: "scroll",
    anchorId: "tender-files",
    message: "Open the Tender Files panel to upload the tender source document.",
  },
  // Knowledge vault / match review ──────────────────────────────────────────
  OPEN_KNOWLEDGE_REVIEW: {
    label: "Review Matching & Knowledge",
    kind: "navigate",
    path: "/dashboard/matching",
    aliases: ["EXPERT_REVIEW", "PROJECT_REVIEW", "EXPERT_SELECTION", "PROJECT_SELECTION"],
  },
  // Matching quality ─────────────────────────────────────────────────────────
  OPEN_MATCHING_QUALITY: {
    label: "Open Analysis & Matching Quality",
    kind: "scroll",
    anchorId: "analysis-quality",
    message: "Open the Analysis Quality panel to review matching and analysis scores.",
  },
  // Compliance gap review ────────────────────────────────────────────────────
  OPEN_COMPLIANCE_REVIEW: {
    label: "Open Compliance Review",
    kind: "scroll",
    anchorId: "generated-documents",
    message: "Open the Generated Documents panel to review and resolve critical compliance gaps before generation.",
    aliases: ["RESOLVE_COMPLIANCE_GAPS", "HARD_COMPLIANCE_BLOCKER"],
  },
  // Re-upload tender ─────────────────────────────────────────────────────────
  RE_UPLOAD_TENDER: {
    label: "Re-upload Tender",
    kind: "scroll",
    anchorId: "tender-files",
    message: "Open the Tender Files panel to re-upload a clearer version of the tender document.",
  },
  // Settings ─────────────────────────────────────────────────────────────────
  OPEN_SETTINGS: {
    label: "Open Settings",
    kind: "navigate",
    path: "/dashboard/settings",
  },
  // Tender detail ─────────────────────────────────────────────────────────────
  OPEN_TENDER_DETAIL: {
    label: "Open Tender Detail",
    kind: "scroll",
    anchorId: "tender-edit-form",
    message: "Open the Tender Detail panel to review and complete tender information.",
  },
};

export function getRecoveryCommandActionSpec(action: string): RecoveryCommandActionSpec | null {
  if (RECOVERY_COMMAND_ACTIONS[action]) return RECOVERY_COMMAND_ACTIONS[action];
  return Object.values(RECOVERY_COMMAND_ACTIONS).find((spec) => spec.aliases?.includes(action)) ?? null;
}

export function recoveryCommandLabel(action: string): string {
  return getRecoveryCommandActionSpec(action)?.label ?? action;
}

export function renderRecoveryActionPath(path: string, tenderId: string): string {
  return path.replace("{tenderId}", tenderId);
}
