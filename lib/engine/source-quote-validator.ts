// Source-quote validator.
//
// When AI Analyze (or any deterministic extractor) emits a metadata field
// claiming "I read this from the tender", we want a cheap, deterministic way
// to verify the claim. This module compares an alleged quote to the actual
// tender source text and reports one of three outcomes:
//
//   • QUOTE_VERIFIED      — the quote (after whitespace normalisation) is a
//                           substring of the tender source. Safe to trust.
//   • QUOTE_NOT_FOUND     — the quote is non-empty but does not appear in
//                           the source. Treat the field as unverified and
//                           surface a warning so a human can confirm.
//   • NO_QUOTE_PROVIDED   — the field carries no quote at all. We can't
//                           verify; flag for follow-up.
//
// The matcher is intentionally conservative: it only collapses ASCII
// whitespace runs and uppercases for comparison. It does not paraphrase,
// stem, or fuzzy-match — anything more would risk falsely "verifying" an
// invented quote.
//
// Used by:
//   • the metadata-repair endpoint (#519), to assert the extractor's
//     sourceQuote actually exists in the file's extractedText.
//   • the future per-field FieldExtractionMeta annotation (analyzeWithAI),
//     to mark fields whose AI-claimed source quote is verifiable.

export type QuoteValidationStatus = "QUOTE_VERIFIED" | "QUOTE_NOT_FOUND" | "NO_QUOTE_PROVIDED";

export type QuoteValidationResult = {
  status: QuoteValidationStatus;
  /** Normalised form of the input quote (whitespace collapsed). Useful for callers that want to persist the canonical form. */
  normalizedQuote: string | null;
  /** Index of the match in normalisedSource, or null when not found. */
  matchIndex: number | null;
};

/** Collapse all runs of ASCII whitespace into single spaces; preserve case. */
function normalizeForCompare(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Validates that `claimedQuote` is a substring of `sourceText` after a
 * deterministic whitespace normalisation. Never paraphrases or fuzzes.
 */
export function validateSourceQuote(claimedQuote: string | null | undefined, sourceText: string | null | undefined): QuoteValidationResult {
  const quote = (claimedQuote ?? "").toString();
  const trimmed = quote.trim();
  if (trimmed.length === 0) {
    return { status: "NO_QUOTE_PROVIDED", normalizedQuote: null, matchIndex: null };
  }
  const normalizedQuote = normalizeForCompare(trimmed);
  const normalizedSource = normalizeForCompare((sourceText ?? "").toString());
  if (normalizedSource.length === 0 || normalizedQuote.length === 0) {
    return { status: "QUOTE_NOT_FOUND", normalizedQuote, matchIndex: null };
  }
  // Case-insensitive substring search on the normalised forms.
  const matchIndex = normalizedSource.toLowerCase().indexOf(normalizedQuote.toLowerCase());
  if (matchIndex === -1) {
    return { status: "QUOTE_NOT_FOUND", normalizedQuote, matchIndex: null };
  }
  return { status: "QUOTE_VERIFIED", normalizedQuote, matchIndex };
}

/** Convenience: validate many fields at once and return a parallel map. */
export type FieldWithQuote = { field: string; value: string | null; sourceQuote?: string | null };
export type FieldValidationReport = Record<string, QuoteValidationResult>;

export function validateFieldSourceQuotes(fields: FieldWithQuote[], sourceText: string | null | undefined): FieldValidationReport {
  const out: FieldValidationReport = {};
  for (const f of fields) {
    out[f.field] = validateSourceQuote(f.sourceQuote, sourceText);
  }
  return out;
}
