// Per-field extraction metadata — a sidecar shape for AI Analyze output.
//
// AIAnalysisResult today is a flat object of string fields. To track WHERE
// each field came from (AI / regex / manually confirmed / repair endpoint),
// HOW confident we are, and whether the AI-claimed source quote actually
// appears in the tender, we attach a parallel FieldExtractionMetaMap.
//
// Living in a separate sidecar keeps `AIAnalysisResult` backward-compatible
// — existing consumers can ignore the meta until they're ready to surface
// per-field provenance. New consumers (canonical readiness, audit log,
// metadata-repair endpoint, the upcoming Bid Strategy gap-classifier) read
// the meta to distinguish "AI verified with quote" from "regex draft".

import type { QuoteValidationResult } from "../quality/source-quote-validator";

export type ExtractionSource =
  | "AI"                  // analyzeWithAI chunk succeeded and emitted the field
  | "REGEX"               // run-tender-engine regex fallback emitted the field
  | "MANUAL_CONFIRMED"    // user edited the tender form → TENDER_METADATA_MANUAL_CONFIRMED audit (#519)
  | "REPAIR_ENDPOINT"     // POST /api/tenders/[id]/repair-metadata wrote it (#519)
  | "UNKNOWN";

export type ExtractionConfidence = "HIGH" | "MEDIUM" | "LOW";

export type FieldExtractionMeta = {
  source: ExtractionSource;
  confidence: ExtractionConfidence;
  /** Verbatim quote the extractor claims to have read this from. Optional. */
  sourceQuote?: string | null;
  /** Status of source-quote validation against the tender file text. Null when
   *  the caller hasn't yet validated. */
  quoteValidation?: QuoteValidationResult | null;
  /** Free-form note (≤200 chars) for the audit log. Optional. */
  note?: string | null;
};

export type FieldExtractionMetaMap = Record<string, FieldExtractionMeta>;

/** Convenience constructor — keeps callers concise. */
export function makeFieldMeta(opts: {
  source: ExtractionSource;
  confidence: ExtractionConfidence;
  sourceQuote?: string | null;
  quoteValidation?: QuoteValidationResult | null;
  note?: string | null;
}): FieldExtractionMeta {
  return {
    source: opts.source,
    confidence: opts.confidence,
    sourceQuote: opts.sourceQuote ?? null,
    quoteValidation: opts.quoteValidation ?? null,
    note: opts.note ?? null,
  };
}

/** True when the field can be trusted as "AI-verified with source quote". */
export function isFieldVerified(meta: FieldExtractionMeta | undefined | null): boolean {
  if (!meta) return false;
  if (meta.source === "MANUAL_CONFIRMED") return true;
  if (meta.source === "AI" && meta.quoteValidation?.status === "QUOTE_VERIFIED") return true;
  if (meta.source === "REPAIR_ENDPOINT" && meta.quoteValidation?.status === "QUOTE_VERIFIED") return true;
  return false;
}

/** True when the field is from a regex / deterministic fallback (provisional). */
export function isFieldProvisional(meta: FieldExtractionMeta | undefined | null): boolean {
  if (!meta) return false;
  return meta.source === "REGEX" || meta.source === "UNKNOWN";
}
