// Single source of truth for "is this value GROUNDED in tender-source evidence?"
//
// A value is grounded only when it carries BOTH a real source page (> 0) AND a
// non-trivial supporting quote (more than 5 non-space characters). A 1–5 char
// "quote" is noise, not evidence, and a page of 0 is not a real page.
//
// This module exists because two resolvers — lib/engine/canonical-field-state.ts
// (Client & Submission panel + gates) and lib/engine/analysis/metadata-truth.ts
// (Metadata Truth panel) — previously each defined their OWN grounding rule with
// DIFFERENT thresholds, so the same field could read "Extracted and grounded" in
// one panel and "review evidence" in the other. Both now call this one predicate
// so the panels can never contradict.

/** Minimum length of a supporting quote for it to count as real evidence. */
export const MIN_GROUNDING_QUOTE_LENGTH = 5;

export function isGroundedEvidence(
  page: number | null | undefined,
  quote: string | null | undefined,
): boolean {
  const hasPage = typeof page === "number" && Number.isFinite(page) && page > 0;
  const hasQuote = typeof quote === "string" && quote.trim().length > MIN_GROUNDING_QUOTE_LENGTH;
  return hasPage && hasQuote;
}
