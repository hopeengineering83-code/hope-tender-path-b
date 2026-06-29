// Single source of truth for "is this value GROUNDED in tender-source evidence?"
//
// A value is grounded only when it carries:
// 1. A real source page (> 0)
// 2. A non-trivial supporting quote (more than 5 non-space characters)
// 3. A valid TenderFile ID (the file must exist and be ACTIVE, not deleted/superseded)
//
// A 1–5 char "quote" is noise, not evidence. A page of 0 is not a real page.
// A fileId that references a deleted/superseded TenderFile is not valid evidence.
//
// This module exists because two resolvers — lib/engine/canonical-field-state.ts
// (Client & Submission panel + gates) and lib/engine/analysis/metadata-truth.ts
// (Metadata Truth panel) — previously each defined their OWN grounding rule with
// DIFFERENT thresholds, so the same field could read "Extracted and grounded" in
// one panel and "review evidence" in the other. Both now call this one predicate
// so the panels can never contradict.

/** Minimum length of a supporting quote for it to count as real evidence. */
export const MIN_GROUNDING_QUOTE_LENGTH = 5;

/**
 * Check if evidence has basic page + quote requirements.
 * Does NOT validate TenderFile ID (requires async DB lookup).
 * Use this for basic validation; use isGroundedEvidenceWithFileCheck for full validation.
 */
export function isGroundedEvidence(
  page: number | null | undefined,
  quote: string | null | undefined,
): boolean {
  const hasPage = typeof page === "number" && Number.isFinite(page) && page > 0;
  const hasQuote = typeof quote === "string" && quote.trim().length > MIN_GROUNDING_QUOTE_LENGTH;
  return hasPage && hasQuote;
}

/**
 * Full validation including TenderFile ID check (async).
 * Requires active TenderFile with deletionStatus = 'ACTIVE'.
 * Pass tenderFileIds as a Set of currently ACTIVE file IDs for the tender.
 */
export function isGroundedEvidenceWithFileCheck(
  page: number | null | undefined,
  quote: string | null | undefined,
  fileId: string | null | undefined,
  activeTenderFileIds: Set<string>,
): boolean {
  // Basic page + quote check
  if (!isGroundedEvidence(page, quote)) return false;
  // FileId validation: must be present and point to an active file
  const hasValidFileId = typeof fileId === "string" && fileId.length > 0 && activeTenderFileIds.has(fileId);
  return hasValidFileId;
}
