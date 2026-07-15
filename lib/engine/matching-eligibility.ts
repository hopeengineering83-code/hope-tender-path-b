// GLM-A2 Issue #1135 — Matching evidence eligibility adapter.
//
// This module enforces that only durably-provenanced, reviewed records
// are eligible for matching selection and proposal evidence use.
//
// It is a NON-OVERLAPPING adapter: it does NOT edit the vault-review
// or company-review files owned by CHATGPT-C1 / Issue #1137 / PR #1146.
// Instead, it provides a matching-specific eligibility check that:
//   1. Requires trustLevel === "REVIEWED" (existing behavior)
//   2. Requires sourceDocumentId to be set (provenance link)
//   3. When PR #1146's isDurablyReviewed() is available on main, this
//      adapter will delegate to it. Until then, it uses a local
//      implementation that checks the same invariants: trustLevel +
//      sourceDocumentId + reviewedBy + reviewedAt.
//
// This ensures a reviewed-but-ungrounded record (REVIEWED but no
// sourceDocumentId, or REVIEWED but no reviewedBy/reviewedAt) scores
// zero, remains unselected, and cannot unlock generation.

/**
 * A vault record (Expert or Project) as seen by the matching engine.
 * Only the fields needed for eligibility checking are required.
 */
export type VaultRecordForEligibility = {
  id: string;
  trustLevel?: string | null;
  sourceDocumentId?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: Date | string | null;
};

/**
 * Check if a vault record is eligible for matching selection.
 *
 * A record is eligible only when ALL of:
 *   1. trustLevel === "REVIEWED"
 *   2. sourceDocumentId is set (provenance link to source document)
 *   3. reviewedBy is set (a human reviewed it)
 *   4. reviewedAt is set (review timestamp exists)
 *
 * This is the fail-closed eligibility gate. Records that fail any check
 * score zero, remain unselected, and cannot unlock generation.
 *
 * When PR #1146 (lib/vault-review-provenance.ts) is merged into main,
 * this function will delegate to isDurablyReviewed() from that module.
 * Until then, it uses this local implementation that checks the same
 * structural invariants.
 */
export function isEligibleForMatching(record: VaultRecordForEligibility): boolean {
  // 1. Must be REVIEWED
  if (record.trustLevel !== "REVIEWED") return false;

  // 2. Must have a provenance link to a source document
  if (!record.sourceDocumentId || record.sourceDocumentId.trim().length === 0) {
    return false;
  }

  // 3. Must have been reviewed by a real user
  if (!record.reviewedBy || record.reviewedBy.trim().length === 0) {
    return false;
  }

  // 4. Must have a review timestamp
  if (!record.reviewedAt) return false;
  if (typeof record.reviewedAt === "string" && record.reviewedAt.trim().length === 0) {
    return false;
  }

  return true;
}

/**
 * Check if a vault record is durably reviewed.
 *
 * This is the adapter point: when PR #1146's isDurablyReviewed() is
 * available on main, this function will import and delegate to it.
 * Until then, it delegates to isEligibleForMatching() which checks
 * the same structural invariants.
 */
export function isDurablyReviewedAdapter(record: VaultRecordForEligibility): boolean {
  // Try to use the shared authority from lib/vault-review-provenance.ts
  // if it exists (post-#1146 merge). This is a dynamic import check
  // that fails gracefully when the module doesn't exist yet.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharedModule = require("../vault-review-provenance");
    if (sharedModule && typeof sharedModule.isDurablyReviewed === "function") {
      return sharedModule.isDurablyReviewed(record);
    }
  } catch {
    // Module not yet available — fall through to local check
  }

  return isEligibleForMatching(record);
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
  record: VaultRecordForEligibility,
): number {
  if (!isDurablyReviewedAdapter(record)) return 0;
  return score;
}
