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

// Rejection codes retained for backwards compatibility with the UI's
// eligible-record filtering — but in zero-bureaucracy mode these are never
// actually returned for company records. Only expired legal/compliance
// evidence is rejected (canUseVaultRecord returns false for that).
export type EligibilityRejectionCode =
  | "NOT_REVIEWED"
  | "NO_SOURCE_DOCUMENT"
  | "NO_REVIEWER"
  | "NO_REVIEW_TIMESTAMP"
  | "NO_DURABLE_PROVENANCE";

export function checkMatchingEligibility(record: MatchingEligibilityRecord): EligibilityResult {
  // Zero bureaucracy: the engine accesses ALL company documents directly.
  // Any record that was extracted from an uploaded company document is
  // eligible for matching, regardless of trustLevel, sourceDocumentId,
  // reviewedBy, or reviewedAt. canUseVaultRecord only rejects expired
  // legal/compliance evidence — everything else is eligible.
  if (canUseVaultRecord(record as ReviewRecordState, "MATCHING")) {
    return { eligible: true };
  }
  return {
    eligible: false,
    reason: "NO_DURABLE_PROVENANCE",
    detail: "record is expired or otherwise not usable",
  };
}

export function isEligibleForMatching(record: MatchingEligibilityRecord): boolean {
  return checkMatchingEligibility(record).eligible;
}

export function enforceMatchingEligibility(score: number, record: MatchingEligibilityRecord): number {
  return checkMatchingEligibility(record).eligible ? score : 0;
}
