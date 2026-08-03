// Gap 5: Pure release-status classification logic.
//
// This module is client-safe (no Node.js imports) so it can be imported
// from client components. The full CanonicalReleaseDecision (which needs
// Prisma) lives in lib/canonical-release-decision.ts and imports this
// module.
//
// Security/integrity failure codes.
const SECURITY_FAILURE_CODES = new Set([
  "FAILED_SECURITY_OR_INTEGRITY",
  "CONTENT_HASH_MISMATCH",
  "INVALID_BYTE_SIGNATURE",
  "OFFICIAL_BYTES_LOST",
  "TENANT_SCOPE_VIOLATION",
]);

// Genuine source blocker codes — require user action (upload/re-upload).
const GENUINE_SOURCE_BLOCKER_CODES = new Set([
  "SOURCE_REQUIRED_FOR_APPROVAL",
  "MISSING_TENDER_SOURCE_FORM",
  "OFFICIAL_BYTES_LOST",
  "NO_ACTIVE_GENERATED_DOCUMENTS",
  "NO_CURRENT_CONFIRMED_BUILD_PLAN",
  "MISSING_PLANNED_FILES",
  "MISSING_TENDER_FORM_FIELDS",
  "HARD_COMPLIANCE_BLOCKER",
]);

// Legal release codes — the ONLY remaining manual steps.
const LEGAL_RELEASE_CODES = new Set([
  "LEGAL_RELEASE_REQUIRED",
  "LEGAL_SIGNATURE_REQUIRED",
  "ADMIN_RELEASE_REQUIRED",
  "AUTHORITY_REVIEW_REQUIRED",
  "EVALUATOR_OBJECTION_REQUIRES_RESOLUTION",
  "FALLBACK_ANALYSIS_APPROVAL_REQUIRED",
]);

export type ReleaseStatus =
  | "PROCESSING_AUTOMATICALLY"
  | "GENUINE_SOURCE_BLOCKED"
  | "LEGAL_RELEASE_REQUIRED"
  | "READY_TO_DOWNLOAD"
  | "FAILED_SECURITY_OR_INTEGRITY";

/**
 * Pure function that classifies blocker codes + readyForFinalExport into
 * one of five statuses. Client-safe — no Node.js imports.
 *
 * Both the server (CanonicalReleaseDecision) and the client
 * (deriveReleaseStatus in generation-action-panel.tsx) use this function
 * so they always agree on the status.
 */
export function classifyReleaseStatus(
  blockerCodes: string[],
  readyForFinalExport: boolean,
): ReleaseStatus {
  if (readyForFinalExport && blockerCodes.length === 0) return "READY_TO_DOWNLOAD";

  if (blockerCodes.some((code) => SECURITY_FAILURE_CODES.has(code))) {
    return "FAILED_SECURITY_OR_INTEGRITY";
  }

  if (blockerCodes.some((code) => GENUINE_SOURCE_BLOCKER_CODES.has(code))) {
    return "GENUINE_SOURCE_BLOCKED";
  }

  if (blockerCodes.some((code) => LEGAL_RELEASE_CODES.has(code))) {
    return "LEGAL_RELEASE_REQUIRED";
  }

  if (blockerCodes.length > 0) return "GENUINE_SOURCE_BLOCKED";

  return "PROCESSING_AUTOMATICALLY";
}
