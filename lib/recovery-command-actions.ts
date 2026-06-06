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
    kind: "custom",
    path: "/api/tenders/{tenderId}/link-vault-evidence",
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
