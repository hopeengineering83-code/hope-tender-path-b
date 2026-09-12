// Single source of truth for "is this value GROUNDED in tender-source evidence?"
//
// A value is grounded only when it carries:
// 1. A real source page (> 0)
// 2. A non-trivial supporting quote (at least 10 non-space characters — matches
//    the gates' MIN_MEANINGFUL_QUOTE_CHARS so panels and gates never disagree
//    on a 6-9 char quote that one accepts and the other rejects)
// 3. A valid TenderFile ID (the file must exist and be ACTIVE, not deleted/superseded)
//
// A 1–9 char "quote" is noise, not evidence. A page of 0 is not a real page.
// A fileId that references a deleted/superseded TenderFile is not valid evidence.
//
// This module exists because two resolvers — lib/engine/canonical-field-state.ts
// (Client & Submission panel + gates) and lib/engine/analysis/metadata-truth.ts
// (Metadata Truth panel) — previously each defined their OWN grounding rule with
// DIFFERENT thresholds, so the same field could read "Extracted and grounded" in
// one panel and "review evidence" in the other. Both now call this one predicate
// so the panels can never contradict.

/** Minimum length of a supporting quote for it to count as real evidence. */
export const MIN_GROUNDING_QUOTE_LENGTH = 10;

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
  const hasQuote = typeof quote === "string" && quote.trim().length >= MIN_GROUNDING_QUOTE_LENGTH;
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

// ─── Active-file containment grounding (mirrors the gate's full check) ──────

/**
 * Active file with its extracted text and total page count — the data needed
 * to apply the gate's full grounding rule (quote containment + page bounds).
 */
export type GroundingActiveFile = {
  id: string;
  extractedText?: string | null;
  totalPages?: number | null;
};

/**
 * Normalize text for quote-containment comparison: lowercase + collapse
 * whitespace + trim. Matches the normalization the gate uses.
 */
/**
 * The one containment normalization every grounding check must use.
 *
 * Extracted PDF text re-wraps lines and the model re-cases the first word of a
 * quote it lifts, so a raw substring test rejects quotes that are genuinely in
 * the document. Anything deciding whether a quote is grounded must compare
 * through this, or two checks will disagree about the same requirement.
 */
export function normalizeForContainment(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Apply the gate's FULL grounding rule: basic page + quote + active fileId +
 * quote containment in the file's extracted text + sourcePage <= totalPages.
 *
 * This is the one grounding predicate that panels and gates share so a field
 * can never read "Extracted and grounded" (green) in a panel while the
 * BuildPlan validator or release gate rejects the very same evidence.
 *
 * Pass the active files array (with extractedText + totalPages) so the
 * containment check can run without an extra DB round-trip.
 */
export function isGroundedEvidenceInActiveFiles(
  page: number | null | undefined,
  quote: string | null | undefined,
  fileId: string | null | undefined,
  activeFiles: ReadonlyArray<GroundingActiveFile>,
): boolean {
  // Basic page + quote + fileId check
  if (!isGroundedEvidence(page, quote)) return false;
  if (typeof fileId !== "string" || fileId.length === 0) return false;
  const file = activeFiles.find((f) => f.id === fileId);
  if (!file) return false;
  // Page bounds: sourcePage <= totalPages when totalPages is known
  if (
    typeof page === "number" &&
    typeof file.totalPages === "number" &&
    file.totalPages > 0 &&
    page > file.totalPages
  ) {
    return false;
  }
  // Quote containment: the normalized quote must appear in the file's
  // extracted text. Foreign / guessed / unsupported evidence is rejected.
  const fileText = normalizeForContainment(file.extractedText ?? "");
  const normalizedQuote = normalizeForContainment(quote ?? "");
  if (fileText.length === 0 || !fileText.includes(normalizedQuote)) {
    return false;
  }
  return true;
}
