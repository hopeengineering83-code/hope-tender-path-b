/**
 * Canonical extraction-state helper for dashboard/analysis/compliance UI.
 *
 * All UI components that display open/clear/blocked status for tenders
 * MUST use this helper — never duplicate status string lists locally.
 *
 * This prevents drift when new analysisExtractionStatus values are added
 * to the engine (e.g. stale-hash, partial-provider, mixed-fallback,
 * currentness blockers).
 */

export type TenderExtractionState = "NOT_ANALYZED" | "BLOCKED" | "CLEAR";

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
 * Returns NOT_ANALYZED if no analysis has been run, BLOCKED if the
 * extraction status indicates a generation blocker, or CLEAR if the
 * tender has been analyzed without blockers.
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
  if (BLOCKED_EXTRACTION_STATES.has(analysisExtractionStatus)) {
    return "BLOCKED";
  }
  return "CLEAR";
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
