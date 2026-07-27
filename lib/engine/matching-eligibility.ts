import {
  canUseVaultRecord,
  type ReviewRecordState,
  type ReviewSourceDocument,
} from "../vault-review-provenance";

export type MatchingEligibilityRecord = {
  id: string;
  companyId?: string | null;
  trustLevel: string | null | undefined;
  sourceDocumentId: string | null | undefined;
  reviewedBy: string | null | undefined;
  reviewedAt: Date | string | null | undefined;
  reviewNotes?: string | null;
  sourceDocument?: (ReviewSourceDocument & { companyId: string }) | null;
  fullName?: string;
  title?: string | null;
  yearsExperience?: number | null;
  disciplines?: unknown;
  sectors?: unknown;
  certifications?: unknown;
  name?: string;
  clientName?: string | null;
  country?: string | null;
  sector?: string | null;
  serviceAreas?: unknown;
  contractValue?: number | null;
  currency?: string | null;
};

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: EligibilityRejectionCode; detail: string };

export type EligibilityRejectionCode =
  | "NOT_REVIEWED"
  | "NOT_VERIFIED"
  | "NO_SOURCE_DOCUMENT"
  | "NO_REVIEWER"
  | "NO_REVIEW_TIMESTAMP"
  | "NO_DURABLE_PROVENANCE";

/**
 * Check whether a Company Vault record (Expert, Project, Legal, Financial,
 * Compliance) is eligible for matching.
 *
 * Accepts BOTH "REVIEWED" (human-reviewed) AND "SOURCE_VERIFIED" (system-
 * verified against uploaded source bytes) records. This matches the policy
 * in `canUseVaultRecord()` (vault-review-provenance.ts) which explicitly
 * accepts `isDurablyReviewed || isDurablySourceVerified` for MATCHING.
 *
 * The user uploads all company documents — the App auto-verifies them
 * against source bytes (trustLevel = "SOURCE_VERIFIED") via
 * `lib/company-auto-verification.ts`. These records are eligible for
 * matching without requiring a human to click "Review" on each one.
 *
 * Only "AI_DRAFT" and "REGEX_DRAFT" records are rejected (they haven't
 * been verified against source bytes yet).
 */
export function checkMatchingEligibility(record: MatchingEligibilityRecord): EligibilityResult {
  // Reject draft (unverified) records — they haven't been checked against
  // the uploaded source bytes yet.
  if (record.trustLevel === "AI_DRAFT" || record.trustLevel === "REGEX_DRAFT" || !record.trustLevel) {
    return { eligible: false, reason: "NOT_VERIFIED", detail: `trustLevel is "${record.trustLevel ?? "null"}", must be "REVIEWED" or "SOURCE_VERIFIED"` };
  }
  // Accept both REVIEWED and SOURCE_VERIFIED from here on.
  if (!record.sourceDocumentId?.trim()) {
    return { eligible: false, reason: "NO_SOURCE_DOCUMENT", detail: "sourceDocumentId is missing" };
  }
  // REVIEWED records require a reviewer + timestamp; SOURCE_VERIFIED records
  // are system-verified (reviewedBy = "SYSTEM_AUTO_VERIFIED") so they always
  // have these fields set by company-auto-verification.ts.
  if (!record.reviewedBy?.trim()) {
    return { eligible: false, reason: "NO_REVIEWER", detail: "reviewedBy is missing" };
  }
  if (!record.reviewedAt || (typeof record.reviewedAt === "string" && !record.reviewedAt.trim())) {
    return { eligible: false, reason: "NO_REVIEW_TIMESTAMP", detail: "reviewedAt is missing" };
  }
  if (!record.companyId || (!record.fullName && !record.name) || !canUseVaultRecord(record as ReviewRecordState, "MATCHING")) {
    return {
      eligible: false,
      reason: "NO_DURABLE_PROVENANCE",
      detail: "record is not bound to current verified source bytes and current record values",
    };
  }
  return { eligible: true };
}

export function isEligibleForMatching(record: MatchingEligibilityRecord): boolean {
  return checkMatchingEligibility(record).eligible;
}

export function enforceMatchingEligibility(score: number, record: MatchingEligibilityRecord): number {
  return checkMatchingEligibility(record).eligible ? score : 0;
}
