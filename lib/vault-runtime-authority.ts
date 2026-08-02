import { canUseVaultRecord, type ReviewRecordState } from "./vault-review-provenance";

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
 *
 * This function no longer decides anything itself. It used to carry its own
 * copy of the rule — the same expiry check and the same two-way durability
 * disjunction canUseVaultRecord already implemented — so one decision had two
 * live implementations, split across consumers: canonical-tender-readiness,
 * matching-quality, engine-postconditions and run-tender-engine called one;
 * company-ingestion-readiness and matching-eligibility called the other. They
 * agreed, so nothing was broken — but only by coincidence. Editing either copy
 * alone would have silently split matching eligibility from generation
 * readiness with no test failing anywhere. It now delegates, so the rule lives
 * in exactly one place and the two entry points cannot drift apart.
 */
export function canUseVaultRecordSafely(
  record: ReviewRecordState,
  purpose: VaultRuntimePurpose,
): boolean {
  return canUseVaultRecord(record, purpose);
}
