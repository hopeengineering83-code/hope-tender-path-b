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
//       - Explicitly classified validation/PDF/package pending states
//
//   READY_TO_DOWNLOAD — the final ZIP is ready.
//
//   STATUS_UNAVAILABLE — readiness could not be resolved. Not a workflow
//     state at all: it says the app does not currently know. Callers signal
//     it with `{ readinessResolved: false }`; it is never inferred from an
//     empty blocker list, because an empty list from a resolver that DID run
//     is a real (and different) fact.

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
// Reachability of these codes is uneven, and worth stating precisely.
// getCanonicalReleaseDecision passes getCanonicalTenderReadiness().blockers,
// which is readiness.fullProposalBlockers plus nine hardcoded automatic codes.
// tender-generation-readiness.ts builds fullProposalBlockers and then, in a
// second pass, inherits entries from its `blockers` array by topic — so codes
// pushed to EITHER array can arrive here.
//
//   HARD_COMPLIANCE_BLOCKER      reachable, via that second-pass merge
//   SOURCE_REQUIRED_FOR_APPROVAL unreachable — a Vault approve-route response
//                                code, never a readiness blocker
//   MISSING_TENDER_SOURCE_FORM   unreachable — submission-plan completeness
//   OFFICIAL_BYTES_LOST          unreachable — admin repair route status
//
// The unreachable three are kept because they are the right classification if
// those paths are ever wired in. The test alongside this module derives the
// reachable set from both producers, so a blocker added to either without
// being classified surfaces there rather than silently defaulting.
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
  "NO_BID_BLOCK",
  "TENDER_PROHIBITS_BRANDING",
  "TENDER_PROHIBITS_SIGNATURE",
  "TENDER_PROHIBITS_STAMP",
]);

// Known non-automatic blockers whose precise recovery action is supplied by
// the canonical workflow decision. They are mapped explicitly so additions
// cannot silently become PROCESSING_AUTOMATICALLY.
const CANONICAL_ACTION_REQUIRED_CODES = new Set([
  "ALL_EXPERTS_UNREVIEWED",
  "ALL_PROJECTS_UNREVIEWED",
  "ANALYSIS_REGEX_FALLBACK_UNAPPROVED",
  "BEST_AVAILABLE_MATCHES_FLAGGED",
  "EVAL_WEIGHTS_INCOMPLETE",
  "EVAL_WEIGHTS_MISSING",
  "FULL_PROPOSAL_ANALYSIS_POOR",
  "FULL_PROPOSAL_DERIVED_PLAN_UNCONFIRMED",
  "FULL_PROPOSAL_ENGINE_NOT_RUN",
  "FULL_PROPOSAL_MATCHES_WEAK",
  "FULL_PROPOSAL_NO_REVIEWED_EXPERTS",
  "FULL_PROPOSAL_NO_REVIEWED_PROJECTS",
  "MANDATORY_EVIDENCE_NOT_ASSESSED",
  "MATCHING_QUALITY_POOR",
  "MATCHING_QUALITY_POOR_VAULT_FALLBACK",
  "NO_EXPERT_MATCHES_FOUND",
  "NO_PROJECT_MATCHES_FOUND",
  "NO_REVIEWED_EXPERT_MATCHES",
  "NO_REVIEWED_PROJECT_MATCHES",
  "SENIOR_REVIEW_GAPS",
  "TENDER_REQUIRES_PDF_SOURCE_MISSING",
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
  "FULL_PROPOSAL_NO_VAULT",
  "COMPANY_INGESTION_NOT_READY",
  "COMPANY_INGESTION_WARNING",
  "EXPERT_AUTO_PROMOTION_AVAILABLE",
  "PROJECT_AUTO_PROMOTION_AVAILABLE",
  "MATCHING_QUALITY_WARNING",
  "TENDER_REQUIRES_PDF",
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
  | "FAILED_SECURITY_OR_INTEGRITY"
  // The readiness computation could not be resolved at all — it errored, or
  // no readiness input reached this classifier. Absence of data is NOT
  // evidence that the workflow is running, so it must not be reported as
  // PROCESSING_AUTOMATICALLY. See `readinessResolved` below.
  | "STATUS_UNAVAILABLE";

/**
 * What the caller actually knows about the readiness inputs.
 *
 * `classifyReleaseStatus` used to receive a blocker array and a boolean, with
 * no way to tell "the resolver ran and found nothing blocking" apart from "the
 * resolver never ran". Both arrive as `([], false)`, and both were reported as
 * PROCESSING_AUTOMATICALLY — so an outage in the readiness path rendered as a
 * confident claim that work was under way server-side.
 *
 * `readinessResolved: false` is the explicit signal that no readiness data was
 * obtained. It short-circuits to STATUS_UNAVAILABLE before any blocker rule
 * runs. Omitting the argument keeps the historical behaviour for callers that
 * genuinely hold resolved readiness.
 */
export type ReleaseStatusAvailability = {
  /** False when the readiness computation was absent, null, or threw. */
  readinessResolved?: boolean;
};

/**
 * Pure function that classifies blocker codes + readyForFinalExport into
 * one of six statuses. Client-safe — no Node.js imports.
 *
 * Blocker 2: AUTOMATIC_WORK_PENDING blockers (NO_ACTIVE_GENERATED_DOCUMENTS,
 * NO_CURRENT_CONFIRMED_BUILD_PLAN, MISSING_PLANNED_FILES, ENGINE_NOT_COMPLETED,
 * validation/PDF/package pending) are classified as PROCESSING_AUTOMATICALLY,
 * never GENUINE_SOURCE_BLOCKED. Unknown blockers fail closed as
 * STATUS_UNAVAILABLE: absence of a mapping is not evidence that a worker owns
 * the blocker.
 *
 * Gap B: a caller that could not resolve readiness at all passes
 * `{ readinessResolved: false }` and gets STATUS_UNAVAILABLE. "No data" is
 * never promoted into "work is running".
 */
export function classifyReleaseStatus(
  blockerCodes: string[],
  readyForFinalExport: boolean,
  availability: ReleaseStatusAvailability = {},
): ReleaseStatus {
  if (availability.readinessResolved === false) return "STATUS_UNAVAILABLE";

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

  if (blockerCodes.some((code) => CANONICAL_ACTION_REQUIRED_CODES.has(code))) {
    return "STATUS_UNAVAILABLE";
  }

  if (blockerCodes.some((code) => !AUTOMATIC_WORK_PENDING_CODES.has(code))) {
    return "STATUS_UNAVAILABLE";
  }

  if (blockerCodes.length > 0) return "PROCESSING_AUTOMATICALLY";

  return "PROCESSING_AUTOMATICALLY";
}

/**
 * Classify a single blocker code into its category.
 * Useful for debugging and UI rendering.
 */
export type BlockerCategory = "SECURITY" | "SOURCE" | "LEGAL" | "AUTOMATIC" | "CANONICAL_ACTION" | "UNKNOWN";
export function classifyBlocker(code: string): BlockerCategory {
  if (SECURITY_FAILURE_CODES.has(code)) return "SECURITY";
  if (GENUINE_SOURCE_BLOCKER_CODES.has(code)) return "SOURCE";
  if (LEGAL_RELEASE_CODES.has(code)) return "LEGAL";
  if (AUTOMATIC_WORK_PENDING_CODES.has(code)) return "AUTOMATIC";
  if (CANONICAL_ACTION_REQUIRED_CODES.has(code)) return "CANONICAL_ACTION";
  return "UNKNOWN";
}
