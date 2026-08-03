// Gap 5 / Blocker 2: Pure release-status classification logic.
//
// This module is client-safe (no Node.js imports) so it can be imported
// from client components. The full CanonicalReleaseDecision (which needs
// Prisma) lives in lib/canonical-release-decision.ts and imports this
// module.
//
// Classification rules (Blocker 2):
//
//   FAILED_SECURITY_OR_INTEGRITY — a security or integrity failure occurred.
//     The package cannot be downloaded. Contact support.
//
//   GENUINE_SOURCE_BLOCKED — a genuine source blocker exists that the user
//     must resolve by uploading/re-uploading a document. These are blockers
//     that CANNOT be resolved automatically:
//       - SOURCE_REQUIRED_FOR_APPROVAL
//       - MISSING_TENDER_SOURCE_FORM
//       - OFFICIAL_BYTES_LOST
//       - HARD_COMPLIANCE_BLOCKER
//
//   LEGAL_RELEASE_REQUIRED — a legal signature, declaration, or ADMIN
//     release decision is required. These are the ONLY remaining manual
//     steps:
//       - LEGAL_RELEASE_REQUIRED
//       - LEGAL_SIGNATURE_REQUIRED
//       - ADMIN_RELEASE_REQUIRED
//       - AUTHORITY_REVIEW_REQUIRED
//       - EVALUATOR_OBJECTION_REQUIRES_RESOLUTION
//       - FALLBACK_ANALYSIS_APPROVAL_REQUIRED
//
//   PROCESSING_AUTOMATICALLY — the workflow is running. These blockers
//     are AUTOMATIC_WORK_PENDING — they will be resolved by the durable
//     workflow without user action:
//       - NO_ACTIVE_GENERATED_DOCUMENTS (generation hasn't run yet)
//       - NO_CURRENT_CONFIRMED_BUILD_PLAN (build plan will be auto-derived)
//       - MISSING_PLANNED_FILES (generation will create them)
//       - ENGINE_NOT_COMPLETED (engine is running or queued)
//       - MISSING_TENDER_FORM_FIELDS (tender-form completion gate will fire)
//       - Any validation/PDF/package pending state
//       - Any unknown blocker (fail safe: assume automatic, not source-blocked)
//
//   READY_TO_DOWNLOAD — the final ZIP is ready.

// Security/integrity failure codes — package cannot be downloaded.
const SECURITY_FAILURE_CODES = new Set([
  "FAILED_SECURITY_OR_INTEGRITY",
  "CONTENT_HASH_MISMATCH",
  "INVALID_BYTE_SIGNATURE",
  "TENANT_SCOPE_VIOLATION",
]);

// Genuine source blocker codes — require user action (upload/re-upload).
// These CANNOT be resolved by the automatic workflow.
//
// Of the four codes originally listed here, NONE can reach this function.
// getCanonicalReleaseDecision passes getCanonicalTenderReadiness().blockers,
// which is built from readiness.fullProposalBlockers plus nine hardcoded
// automatic codes. SOURCE_REQUIRED_FOR_APPROVAL is a Vault approve-route
// response code, MISSING_TENDER_SOURCE_FORM belongs to submission-plan
// completeness, OFFICIAL_BYTES_LOST to the admin repair route, and
// HARD_COMPLIANCE_BLOCKER is pushed to `blockers` in
// tender-generation-readiness.ts — a different array from the
// `fullProposalBlockers` canonical actually maps. They are kept because they
// are the right answer if those paths are ever wired in; the test alongside
// this module now asserts which codes are genuinely reachable so the list
// cannot silently become decorative again.
//
// FULL_PROPOSAL_EXTRACTION_CORRUPTED is reachable, and was classified as
// automatic work. It is not: it fires when extraction already ran, came back
// corrupted or unreadable, and AI analysis was skipped. Its own message tells
// the user to "Re-upload the document or upload a clearer scan" and its
// nextAction is RE_UPLOAD_TENDER. Left as PROCESSING_AUTOMATICALLY the app
// reported "processing" indefinitely while waiting for an upload it never
// asked for.
//
// FULL_PROPOSAL_NO_VAULT is deliberately NOT here. matching-quality sets
// NO_VAULT as the else-branch of `hasVault`, so it is also the state while an
// uploaded Vault document is still being extracted and verified. Treating it
// as a source blocker would demand another upload during normal processing —
// the exact false request this classification exists to prevent.
const GENUINE_SOURCE_BLOCKER_CODES = new Set([
  "SOURCE_REQUIRED_FOR_APPROVAL",
  "MISSING_TENDER_SOURCE_FORM",
  "OFFICIAL_BYTES_LOST",
  "HARD_COMPLIANCE_BLOCKER",
  "FULL_PROPOSAL_EXTRACTION_CORRUPTED",
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

// Automatic work-pending codes — the durable workflow will resolve these.
// Blocker 2: these must be PROCESSING_AUTOMATICALLY, never GENUINE_SOURCE_BLOCKED.
const AUTOMATIC_WORK_PENDING_CODES = new Set([
  "NO_ACTIVE_GENERATED_DOCUMENTS",
  "NO_CURRENT_CONFIRMED_BUILD_PLAN",
  "MISSING_PLANNED_FILES",
  "ENGINE_NOT_COMPLETED",
  "MISSING_TENDER_FORM_FIELDS",
  "ANALYSIS_QUALITY_POOR",
  "ANALYSIS_QUALITY_WARNING",
  "NO_TENDER_SPECIFIC_EXPERT_MATCHES",
  "NO_TENDER_SPECIFIC_PROJECT_MATCHES",
  "NO_SELECTED_REVIEWED_EXPERTS",
  "NO_SELECTED_REVIEWED_PROJECTS",
  "DOCUMENTS_NOT_GENERATED",
  "QUALITY_GATE_FAILED",
  "AUTO_FINALIZE_REQUIRED",
  "EXPORT_READY",
  "MISSING_REQUIREMENTS",
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
 * Blocker 2: AUTOMATIC_WORK_PENDING blockers (NO_ACTIVE_GENERATED_DOCUMENTS,
 * NO_CURRENT_CONFIRMED_BUILD_PLAN, MISSING_PLANNED_FILES, ENGINE_NOT_COMPLETED,
 * validation/PDF/package pending) are classified as PROCESSING_AUTOMATICALLY,
 * never GENUINE_SOURCE_BLOCKED. Unknown blockers also default to
 * PROCESSING_AUTOMATICALLY (fail safe: assume the workflow will handle it,
 * not that the user must upload something).
 */
export function classifyReleaseStatus(
  blockerCodes: string[],
  readyForFinalExport: boolean,
): ReleaseStatus {
  if (readyForFinalExport && blockerCodes.length === 0) return "READY_TO_DOWNLOAD";

  // Security/integrity failure — highest priority.
  if (blockerCodes.some((code) => SECURITY_FAILURE_CODES.has(code))) {
    return "FAILED_SECURITY_OR_INTEGRITY";
  }

  // Legal release required — manual step that only a human can do.
  if (blockerCodes.some((code) => LEGAL_RELEASE_CODES.has(code))) {
    return "LEGAL_RELEASE_REQUIRED";
  }

  // Genuine source blocked — user must upload/re-upload a document.
  // These are the ONLY blockers that require user action beyond legal release.
  if (blockerCodes.some((code) => GENUINE_SOURCE_BLOCKER_CODES.has(code))) {
    return "GENUINE_SOURCE_BLOCKED";
  }

  // All remaining blockers (including unknown ones) are AUTOMATIC_WORK_PENDING.
  // The durable workflow will resolve them without user action.
  // Blocker 2: do NOT classify unknown blockers as missing source.
  if (blockerCodes.length > 0) return "PROCESSING_AUTOMATICALLY";

  return "PROCESSING_AUTOMATICALLY";
}

/**
 * Classify a single blocker code into its category.
 * Useful for debugging and UI rendering.
 */
export type BlockerCategory = "SECURITY" | "SOURCE" | "LEGAL" | "AUTOMATIC";
export function classifyBlocker(code: string): BlockerCategory {
  if (SECURITY_FAILURE_CODES.has(code)) return "SECURITY";
  if (GENUINE_SOURCE_BLOCKER_CODES.has(code)) return "SOURCE";
  if (LEGAL_RELEASE_CODES.has(code)) return "LEGAL";
  return "AUTOMATIC";
}
