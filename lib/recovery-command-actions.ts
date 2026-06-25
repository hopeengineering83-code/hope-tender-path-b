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

export const RECOVERY_COMMAND_ACTIONS: Record<string, RecoveryCommandActionSpec> = {
  // Source documents ─────────────────────────────────────────────────────────
  UPLOAD_TENDER_DOCUMENT: {
    label: "Upload Tender Source",
    kind: "scroll",
    anchorId: "tender-files",
    message: "Open the Tender Files panel to upload the tender source document.",
    aliases: ["RE_UPLOAD_SOURCE", "RE_UPLOAD_TENDER", "UPLOAD_TENDER_SOURCE", "RUN_OCR_OR_UPLOAD_CLEARER_SCAN"],
  },
  RE_UPLOAD_SOURCE: {
    label: "Re-upload Source",
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
    path: "/api/tenders/{tenderId}/ai-analyze?mode=background",
    aliases: [
      "AI_ANALYZE",
      "RETRY_AI_ANALYZE",
      "REVIEW_ANALYSIS",
      "RERUN_AI_ANALYZE_AFTER_OCR",
      "RETRY_AI_ANALYZE_OR_APPROVE_FALLBACK",
      "CONTINUE_AI_ANALYSIS",
      "RERUN_AI_ANALYZE",
      "RESUME_AI_ANALYZE"
    ],
  },
  RETRY_AI_ANALYZE: {
    label: "Retry AI Analyze",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/ai-analyze?mode=background",
  },
  REVIEW_ANALYSIS: {
    label: "Review Analysis",
    kind: "scroll",
    anchorId: "ai-analyze-section",
    message: "Open the AI Analyze panel to review the extraction results.",
  },
  APPROVE_FALLBACK_WITH_NOTE: {
    label: "Approve Fallback Analysis",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/approve-analysis",
    aliases: ["APPROVE_FALLBACK"],
  },
  REVOKE_FALLBACK_APPROVAL: {
    label: "Revoke Fallback Approval",
    kind: "api",
    method: "DELETE",
    path: "/api/tenders/{tenderId}/approve-analysis",
  },
  COMPLETE_METADATA: {
    label: "Complete Metadata",
    kind: "scroll",
    anchorId: "tender-edit-form",
    message: "Open the Tender Metadata form and fill in missing critical fields.",
    aliases: ["EDIT_TENDER", "EDIT_TENDER_METADATA", "FILL_CLIENT_METADATA", "OPEN_TENDER_DETAIL", "CHANGE_BID_DECISION", "REVIEW_METADATA"],
  },
  RUN_ENGINE: {
    label: "Run AI Engine",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/engine",
    aliases: ["RUN_ENGINE_SAFE_MODE", "RUN_ENGINE_OR_APPROVE_ANALYSIS"],
  },
  AUTO_FINALIZE: {
    label: "Auto-Finalize",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/auto-finalize",
    aliases: ["CONTINUE_AUTO_FINALIZE"],
  },
  RESOLVE_EXPORT_BLOCKERS: {
    label: "Export Readiness",
    kind: "api",
    method: "GET",
    path: "/api/tenders/{tenderId}/export-readiness",
    aliases: ["EXPORT_READINESS", "RECHECK_EXPORT_READINESS", "RECHECK_EXPORT_READINESS_AFTER_AUTO_FINALIZE"],
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
  REPAIR_SOURCE_REFERENCES: {
    label: "Repair Source References",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/repair-source-grounding",
    aliases: ["REPAIR_SOURCE_GROUNDING", "REPAIR_OR_EDIT_TENDER"],
  },
  BUILD_SUBMISSION_PLAN: {
    label: "Build Submission Plan",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/submission-plan/build",
  },
  LINK_VAULT_EVIDENCE: {
    label: "Link Vault Evidence",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/link-vault-evidence-auto",
  },
  GENERATE_REQUIRED_DOCUMENTS: {
    label: "Generate Documents",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/generate-missing-plan-files",
    aliases: ["GENERATE_DOCS", "GENERATE_MISSING_PLANNED_DOCS"],
  },
  ATTACH_OFFICIAL_ORIGINALS: {
    label: "Attach Official Originals",
    kind: "scroll",
    anchorId: "tender-files",
    message: "Open the Tender Files panel to attach required official originals.",
  },
  REPAIR_DOCUMENT_QUALITY: {
    label: "Repair Documents",
    kind: "api",
    method: "POST",
    path: "/api/tenders/{tenderId}/repair-export-gaps",
    aliases: ["REPAIR_DOCS"],
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
    aliases: ["OPEN_MATCHING_QUALITY"],
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
    aliases: ["REVIEW_MATCHING_INPUTS", "OPEN_KNOWLEDGE_REVIEW", "EXPERT_REVIEW", "PROJECT_REVIEW", "EXPERT_SELECTION", "PROJECT_SELECTION"],
  },
  // Generation readiness ─────────────────────────────────────────────────────
  OPEN_GENERATION_READINESS: {
    label: "Open Generation Readiness",
    kind: "scroll",
    anchorId: "generated-documents",
    message: "Open the Generated Documents panel to review generation readiness and fix blockers.",
    aliases: ["CONFIRM_SUBMISSION_PLAN", "REVIEW_REQUIREMENTS_OR_ADD_MANUAL_PLAN", "OPEN_COMPLIANCE_REVIEW", "RESOLVE_COMPLIANCE_GAPS", "HARD_COMPLIANCE_BLOCKER", "SET_MANDATORY_REQUIREMENTS_OR_ADD_FILE_NAMES"],
  },
  // Settings ─────────────────────────────────────────────────────────────────
  OPEN_SETTINGS: {
    label: "Open Settings",
    kind: "navigate",
    path: "/dashboard/settings",
  },
  // Navigation shortcuts for engine/auth error nextActions ──────────────────
  OPEN_DASHBOARD: {
    label: "Open Dashboard",
    kind: "navigate",
    path: "/dashboard",
  },
  OPEN_TENDER_LIST: {
    label: "Open Tender List",
    kind: "navigate",
    path: "/dashboard",
    aliases: ["LOGIN_AGAIN", "LOGIN_AGAIN_OR_CHECK_ROLE"],
  },
  // Generation wait / retry ─────────────────────────────────────────────────
  WAIT_FOR_CURRENT_GENERATION: {
    label: "Wait — Generation In Progress",
    kind: "refresh",
    aliases: ["RETRY_AFTER_BACKOFF", "RETRY_AFTER_DATABASE_CHECK", "RETRY_AS_BACKGROUND_JOB", "RETRY_OR_CONTACT_SUPPORT", "RETRY_OR_REDUCE_INPUT"],
  },
};
