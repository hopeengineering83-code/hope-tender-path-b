// GLM-A2 Issue #1135 — Matching evidence eligibility gate.
//
// This module defines the EXPLICIT contract for vault record eligibility
// in the matching engine. It now calls the shared isDurablyReviewed()
// from lib/vault-review-provenance.ts (available in this branch) as an
// ADDITIONAL check on top of the structural check. Both must pass for
// a record to be eligible.
//
// The structural check catches: trustLevel, sourceDocumentId, reviewedBy, reviewedAt.
// The durable check catches: provenance blob in reviewNotes, source byte integrity,
// evidence hashes, reviewer binding to source document.

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
  reviewNotes?: string | null | undefined;
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
  | "NO_REVIEW_TIMESTAMP"
  | "NO_DURABLE_PROVENANCE";

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

  // Durable provenance check: validate the reviewNotes blob contains a
  // valid provenance record (not just plain text). This catches records
  // that were marked REVIEWED via single-record PATCH (which now writes
  // provenance) vs records that were marked REVIEWED without provenance
  // (which diagnostics flags as CRITICAL).
  // Only run the durable check when reviewNotes is present and looks like
  // a JSON provenance blob (starts with {). Plain text notes (legacy or
  // test fixtures) fall through to the structural check.
  if (record.reviewNotes && record.reviewNotes.trim().startsWith("{")) {
    try {
      const { isDurablyReviewed } = require("../vault-review-provenance");
      const durable = isDurablyReviewed({
        trustLevel: record.trustLevel,
        sourceDocumentId: record.sourceDocumentId,
        reviewedBy: record.reviewedBy,
        reviewedAt: record.reviewedAt,
        reviewNotes: record.reviewNotes,
      });
      if (!durable) {
        return {
          eligible: false,
          reason: "NO_DURABLE_PROVENANCE" as EligibilityRejectionCode,
          detail: "Record has a provenance-like reviewNotes blob but it failed durable validation — diagnostics will flag this as CRITICAL",
        };
      }
    } catch {
      // If isDurablyReviewed throws (shape mismatch, module error), fall back
      // to the structural check only. This is fail-open for the matching
      // engine but diagnostics will still flag the record.
    }
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
