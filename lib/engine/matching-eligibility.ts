// GLM-A2 Issue #1135 — Matching evidence eligibility gate.
//
// This module defines the EXPLICIT contract for vault record eligibility
// in the matching engine. It is NOT a delegation adapter — it does not
// use dynamic imports to call the shared provenance module
// (which belongs to PR #1146 / Issue #1137 and is not yet on main).
//
// Instead, this module defines its own structural eligibility check that
// is the authority for matching selection. When PR #1146 is merged, the
// matching engine should be updated to call the shared isDurablyReviewed()
// directly with the FULL record shape
// (including sourceDocument, reviewNotes, evidence hashes). Until then,
// this structural check is the matching engine's gate.
//
// GLM-A2 Issue #1135 Revision #1+2: The previous version used a dynamic
// fallback that could flip behavior incorrectly when #1146 is integrated
// (passing incomplete fields to isDurablyReviewed would reject everything).
// That fallback has been removed. This module is self-contained.

/**
 * Full record shape required for matching eligibility.
 *
 * This is the COMPLETE set of fields the matching engine needs to make
 * an eligibility decision. When PR #1146's isDurablyReviewed() is
 * available, this shape should be widened to include sourceDocument,
 * reviewNotes, and evidence — and the matching engine should pass the
 * full Prisma record instead of casting.
 */
export type MatchingEligibilityRecord = {
  id: string;
  trustLevel: string | null | undefined;
  sourceDocumentId: string | null | undefined;
  reviewedBy: string | null | undefined;
  reviewedAt: Date | string | null | undefined;
};

/**
 * Result of an eligibility check — explicit about WHY a record was
 * rejected so callers can surface the reason to the user.
 */
export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: EligibilityRejectionCode; detail: string };

export type EligibilityRejectionCode =
  | "NOT_REVIEWED"
  | "NO_SOURCE_DOCUMENT"
  | "NO_REVIEWER"
  | "NO_REVIEW_TIMESTAMP";

/**
 * Check if a vault record is eligible for matching selection.
 *
 * A record is eligible only when ALL of:
 *   1. trustLevel === "REVIEWED"
 *   2. sourceDocumentId is set (provenance link to source document)
 *   3. reviewedBy is set (a human reviewed it)
 *   4. reviewedAt is set (review timestamp exists)
 *
 * LIMITATION (Revision #1): This is a STRUCTURAL check, not a durable
 * provenance check. It does NOT validate:
 *   - source document bytes/text hash
 *   - evidence offsets/quotes
 *   - stored provenance record
 *   - reviewer/timestamp binding to the source document
 *
 * Those checks are owned by PR #1146 (the shared provenance module).
 * When #1146 is merged, replace this function with a direct call to
 * isDurablyReviewed() passing the full record shape.
 *
 * Until then, this structural check prevents the most common failure
 * mode: a REVIEWED record with no sourceDocumentId (manually entered
 * without provenance) from being selected as proposal evidence.
 */
export function checkMatchingEligibility(
  record: MatchingEligibilityRecord,
): EligibilityResult {
  if (record.trustLevel !== "REVIEWED") {
    return {
      eligible: false,
      reason: "NOT_REVIEWED",
      detail: `trustLevel is "${record.trustLevel ?? "null"}", must be "REVIEWED"`,
    };
  }

  if (!record.sourceDocumentId || record.sourceDocumentId.trim().length === 0) {
    return {
      eligible: false,
      reason: "NO_SOURCE_DOCUMENT",
      detail: "sourceDocumentId is missing — record has no provenance link to a source document",
    };
  }

  if (!record.reviewedBy || record.reviewedBy.trim().length === 0) {
    return {
      eligible: false,
      reason: "NO_REVIEWER",
      detail: "reviewedBy is missing — no human reviewer recorded",
    };
  }

  if (!record.reviewedAt) {
    return {
      eligible: false,
      reason: "NO_REVIEW_TIMESTAMP",
      detail: "reviewedAt is missing — no review timestamp recorded",
    };
  }

  if (typeof record.reviewedAt === "string" && record.reviewedAt.trim().length === 0) {
    return {
      eligible: false,
      reason: "NO_REVIEW_TIMESTAMP",
      detail: "reviewedAt is an empty string",
    };
  }

  return { eligible: true };
}

/**
 * Convenience boolean wrapper around checkMatchingEligibility.
 */
export function isEligibleForMatching(record: MatchingEligibilityRecord): boolean {
  return checkMatchingEligibility(record).eligible;
}

/**
 * Score adjustment for ineligible records.
 * Returns 0 for ineligible records, unchanged score for eligible ones.
 *
 * This is called by the matching engine to zero out records that
 * fail the eligibility check, ensuring they cannot be selected
 * or contribute to proposal evidence.
 */
export function enforceMatchingEligibility(
  score: number,
  record: MatchingEligibilityRecord,
): number {
  const result = checkMatchingEligibility(record);
  if (!result.eligible) return 0;
  return score;
}

/**
 * Get a human-readable eligibility label for UI display.
 */
export function eligibilityLabel(record: MatchingEligibilityRecord): string {
  const result = checkMatchingEligibility(record);
  if (result.eligible) return "✓ Eligible (reviewed + grounded)";
  return `✗ Ineligible: ${result.detail}`;
}
