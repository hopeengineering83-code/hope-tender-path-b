import {
  type ReviewRecordState,
  type ReviewSourceDocument,
} from "../vault-review-provenance";
import { canUseVaultRecordSafely } from "../vault-runtime-authority";

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
  // Automatic promotion removes the manual approval step without removing
  // evidence authority. A current human REVIEWED record and a current machine
  // SOURCE_VERIFIED record are equally eligible; drafts and stale/tampered
  // records remain fail-closed.
  if (record.companyId && (record.fullName || record.name) && canUseVaultRecordSafely(record as ReviewRecordState, "MATCHING")) {
    return { eligible: true };
  }

  if (record.trustLevel !== "REVIEWED" && record.trustLevel !== "SOURCE_VERIFIED") {
    return { eligible: false, reason: "NOT_REVIEWED", detail: `trustLevel is "${record.trustLevel ?? "null"}", must be "REVIEWED" or "SOURCE_VERIFIED"` };
  }
  if (!record.sourceDocumentId?.trim()) {
    return { eligible: false, reason: "NO_SOURCE_DOCUMENT", detail: "sourceDocumentId is missing" };
  }
  if (record.trustLevel === "REVIEWED") {
    if (!record.reviewedBy?.trim()) {
      return { eligible: false, reason: "NO_REVIEWER", detail: "reviewedBy is missing" };
    }
    if (!record.reviewedAt || (typeof record.reviewedAt === "string" && !record.reviewedAt.trim())) {
      return { eligible: false, reason: "NO_REVIEW_TIMESTAMP", detail: "reviewedAt is missing" };
    }
  }
  return {
    eligible: false,
    reason: "NO_DURABLE_PROVENANCE",
    detail: "record is not bound to current verified source bytes and current exact values",
  };
}

export function isEligibleForMatching(record: MatchingEligibilityRecord): boolean {
  return checkMatchingEligibility(record).eligible;
}

export function enforceMatchingEligibility(score: number, record: MatchingEligibilityRecord): number {
  return checkMatchingEligibility(record).eligible ? score : 0;
}
