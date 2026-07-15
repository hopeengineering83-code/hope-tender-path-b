/**
 * Canonical extraction-state helper for dashboard/analysis/compliance UI.
 *
 * All UI components that display open/clear/blocked status for tenders
 * MUST use this helper — never duplicate status string lists locally.
 *
 * This prevents drift when new analysisExtractionStatus values are added
 * to the engine (e.g. stale-hash, partial-provider, mixed-fallback,
 * currentness blockers).
 *
 * IMPORTANT — fail-closed policy:
 *   Unknown status strings (anything not in the explicit CLEAR allowlist
 *   AND not in the BLOCKED denylist) are classified as BLOCKED, never
 *   CLEAR. This prevents a new misspelled, stale-hash, partial-provider,
 *   mixed-fallback, or currentness blocker from accidentally rendering
 *   green. A CLEAR result requires membership in CLEAR_EXTRACTION_STATES.
 */

export type TenderExtractionState = "NOT_ANALYZED" | "BLOCKED" | "CLEAR";

/**
 * Authoritative current-success extraction statuses.
 * ONLY these statuses may render as CLEAR. Anything not in this set is
 * BLOCKED (if in BLOCKED_EXTRACTION_STATES) or treated as BLOCKED by
 * the fail-closed policy.
 */
export const CLEAR_EXTRACTION_STATES: ReadonlySet<string> = new Set([
  "AI_SUCCEEDED",
  "AI_COMPLETED",
  "COMPLETED",
  "EXTRACTION_SUCCEEDED",
  "AI_ANALYZED",
]);

/** Every actual persisted analysisExtractionStatus that blocks generation. */
export const BLOCKED_EXTRACTION_STATES: ReadonlySet<string> = new Set([
  "OCR_REQUIRED",
  "EXTRACTION_CORRUPTED_AI_SKIPPED",
  "EXTRACTION_CORRUPTED",
  "EXTRACTION_QUALITY_ENGINE_BLOCKED",
  "EXTRACTION_QUALITY_BLOCKED",
  "ANALYSIS_FROM_CORRUPTED_EXTRACTION",
  "ANALYSIS_FROM_WEAK_EXTRACTION",
  "PARTIAL_EXTRACTION_AI_ANALYZED",
  "REGEX_FALLBACK_AI_ERROR",
  "REGEX_FALLBACK_UNAPPROVED",
  "HUMAN_APPROVED_FALLBACK",
  "SUPERSEDED",
  "FAILED",
]);

/**
 * Classify a tender's extraction state for UI display.
 *
 * Returns:
 *   - NOT_ANALYZED if no analysis has been run (no requirements, or
 *     null/NOT_STARTED status).
 *   - CLEAR ONLY if the status is in CLEAR_EXTRACTION_STATES (allowlist).
 *   - BLOCKED if the status is in BLOCKED_EXTRACTION_STATES (denylist).
 *   - BLOCKED for any unknown status (fail-closed — never CLEAR).
 *
 * A tender with zero requirements is NOT_ANALYZED regardless of status.
 */
export function classifyTenderExtractionState(
  analysisExtractionStatus: string | null | undefined,
  requirementsCount: number,
): TenderExtractionState {
  if (!requirementsCount || requirementsCount === 0) {
    return "NOT_ANALYZED";
  }
  if (!analysisExtractionStatus || analysisExtractionStatus === "NOT_STARTED") {
    return "NOT_ANALYZED";
  }
  if (CLEAR_EXTRACTION_STATES.has(analysisExtractionStatus)) {
    return "CLEAR";
  }
  // Unknown statuses (not in the allowlist) are BLOCKED — never CLEAR.
  // This catches stale-hash, partial-provider, mixed-fallback, currentness,
  // misspellings, and any future status that has not been promoted to CLEAR.
  return "BLOCKED";
}

/**
 * Check if a tender's extraction state represents a critical gap
 * (either not analyzed or blocked).
 */
export function isExtractionCritical(
  analysisExtractionStatus: string | null | undefined,
  requirementsCount: number,
): boolean {
  return classifyTenderExtractionState(analysisExtractionStatus, requirementsCount) !== "CLEAR";
}
