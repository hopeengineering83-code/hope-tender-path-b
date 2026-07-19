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
  | "NO_SOURCE_DOCUMENT"
  | "NO_REVIEWER"
  | "NO_REVIEW_TIMESTAMP"
  | "NO_DURABLE_PROVENANCE";

export function checkMatchingEligibility(record: MatchingEligibilityRecord): EligibilityResult {
  if (record.trustLevel !== "REVIEWED") {
    return { eligible: false, reason: "NOT_REVIEWED", detail: `trustLevel is "${record.trustLevel ?? "null"}", must be "REVIEWED"` };
  }
  if (!record.sourceDocumentId?.trim()) {
    return { eligible: false, reason: "NO_SOURCE_DOCUMENT", detail: "sourceDocumentId is missing" };
  }
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
      detail: "review state is not bound to current verified source bytes and current record values",
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
