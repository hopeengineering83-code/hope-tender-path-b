import {
  isDurablyReviewed,
  isDurablySourceVerified,
  recordIsExpired,
  type ReviewRecordState,
} from "./vault-review-provenance";

export type VaultRuntimePurpose = "MATCHING" | "GENERATION" | "EXPORT";

/**
 * Canonical runtime authority for Company Vault records.
 *
 * There is no mandatory human approval step. A record is usable when either:
 * - the system has durably SOURCE_VERIFIED its current exact values against an
 *   owned, byte-verified source document; or
 * - an authenticated reviewer has durably REVIEWED the same current evidence.
 *
 * Draft, source-less, stale, tampered, expired, or unmatched records remain
 * fail-closed. The purpose parameter is retained so every consumer uses the
 * same contract across matching, generation, and export.
 */
export function canUseVaultRecordSafely(
  record: ReviewRecordState,
  _purpose: VaultRuntimePurpose,
): boolean {
  const expiryDate = (record as { expiryDate?: Date | string | null }).expiryDate;
  if (recordIsExpired(expiryDate)) return false;
  return isDurablySourceVerified(record) || isDurablyReviewed(record);
}
