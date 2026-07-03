/**
 * Post-extraction source-evidence enrichment.
 *
 * The regex extractors (`inferTenderMetadata` in tender-metadata.ts, the
 * multi-field extractors in tender-field-extractors.ts) return field VALUES
 * but not always the per-field source evidence (fileId, page, quote) needed
 * for the canonical resolver to mark a field as EXTRACTED_AND_GROUNDED.
 *
 * This module closes that gap. Given the extracted metadata + the per-file
 * extracted texts, it locates each critical field's value inside a specific
 * file's text and produces the source-evidence columns the canonical resolver
 * reads:
 *
 *   - clientNameSourceFileId / clientNameSourcePage / clientNameSourceQuote
 *   - titleSourceFileId / titleSourcePage / titleSourceQuote
 *   - deadlineSourceFileId / deadlineSourcePage / deadlineSourceQuote
 *   - submissionMethodSourceFileId / submissionMethodSourcePage / submissionMethodSourceQuote
 *   - submissionAddressSourceFileId / submissionAddressSourcePage / submissionAddressSourceQuote
 *   - submissionEmailSourceFileId / submissionEmailSourcePage / submissionEmailSourceQuote
 *   - contactDetailsSourceJson.procurementReferenceNumber.{page, quote, fileId}
 *
 * The enrichment is BEST-EFFORT: if a value cannot be located in any active
 * file's text, the corresponding evidence column is left untouched (not
 * overwritten with null). This means a prior AI Analyze or repair-metadata
 * call's evidence is preserved when re-extract cannot improve on it.
 *
 * Used by:
 *   - app/api/tenders/[id]/re-extract-metadata/route.ts (after inferTenderMetadata)
 *   - lib/tender-upload-first.ts (after the transaction commits)
 */

import { attributeMetadataSourceFileId, type AttributionFile } from "./metadata-source-attribution";

/** Minimum length of a value worth searching for in file text. */
const MIN_VALUE_LENGTH = 3;

/** Maximum characters of surrounding context to capture as the source quote. */
const QUOTE_CONTEXT_CHARS = 200;

export type EnrichmentFile = AttributionFile;

export type EnrichedSourceEvidence = {
  // Dedicated source-evidence columns (only fields where evidence was found)
  clientNameSourceFileId?: string;
  clientNameSourcePage?: number | null;
  clientNameSourceQuote?: string;
  titleSourceFileId?: string;
  titleSourcePage?: number | null;
  titleSourceQuote?: string;
  deadlineSourceFileId?: string;
  deadlineSourcePage?: number | null;
  deadlineSourceQuote?: string;
  submissionMethodSourceFileId?: string;
  submissionMethodSourcePage?: number | null;
  submissionMethodSourceQuote?: string;
  submissionAddressSourceFileId?: string;
  submissionAddressSourcePage?: number | null;
  submissionAddressSourceQuote?: string;
  submissionEmailSourceFileId?: string;
  submissionEmailSourcePage?: number | null;
  submissionEmailSourceQuote?: string;
  // For reference: an updated contactDetailsSourceJson string with the
  // procurementReferenceNumber entry enriched with fileId + page + quote.
  // Only set when reference evidence was found; null otherwise.
  contactDetailsSourceJson?: string;
};

/**
 * Normalize a string for searching: lowercase + collapse whitespace.
 * Matches the normalization in metadata-source-attribution.ts.
 */
function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Compute the 1-based page number for a character index in extracted text.
 * Counts form feeds (\f) and "[Page N]" or "Page N" markers before the index.
 * Returns 1 when no page markers are found (single-page document assumption).
 */
function computePageNumber(text: string, matchIndex: number): number | null {
  if (matchIndex < 0 || matchIndex > text.length) return null;
  const before = text.slice(0, matchIndex);
  const formFeeds = (before.match(/\f/g) || []).length;
  if (formFeeds > 0) return formFeeds + 1;
  const pageMarkers = before.match(/(?:^|\n)[-\s]*Page\s+(\d+)/gi);
  if (pageMarkers && pageMarkers.length > 0) {
    const lastMatch = pageMarkers[pageMarkers.length - 1];
    const m = lastMatch.match(/(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  // Single-page assumption: if there are no page markers, the text is page 1.
  return 1;
}

/**
 * Locate a value inside a file's extracted text and return the source evidence
 * (fileId, page, quote) if found. The quote is a snippet of surrounding context
 * (up to QUOTE_CONTEXT_CHARS characters) centered on the match.
 *
 * The search is normalized (lowercase + collapsed whitespace) so it matches
 * across line wraps and spacing differences.
 */
function locateValueInFile(
  value: string,
  file: EnrichmentFile,
): { fileId: string; page: number | null; quote: string } | null {
  if (!file.extractedText) return null;
  const needle = normalizeText(value);
  if (needle.length < MIN_VALUE_LENGTH) return null;
  const haystack = normalizeText(file.extractedText);
  const idx = haystack.indexOf(needle);
  if (idx < 0) return null;
  // Map the normalized index back to the original text. Because normalization
  // only collapses whitespace, the character count up to idx in the normalized
  // text is >= the character count in the original. We approximate by finding
  // the first occurrence of the needle's first ~20 chars in the original text.
  const probe = needle.slice(0, Math.min(20, needle.length));
  const origIdx = file.extractedText.toLowerCase().indexOf(probe);
  const page = computePageNumber(file.extractedText, origIdx >= 0 ? origIdx : 0);
  // Capture surrounding context from the original text for the quote.
  const quoteStart = Math.max(0, (origIdx >= 0 ? origIdx : 0) - Math.floor(QUOTE_CONTEXT_CHARS / 2));
  const quoteEnd = Math.min(file.extractedText.length, quoteStart + QUOTE_CONTEXT_CHARS);
  const rawQuote = file.extractedText.slice(quoteStart, quoteEnd).trim();
  return { fileId: file.id, page, quote: rawQuote };
}

/**
 * Try to locate a value across all active files. Returns the first file
 * (in stable id order) that contains the value.
 */
function locateValueInFiles(
  value: string | null | undefined,
  files: EnrichmentFile[],
): { fileId: string; page: number | null; quote: string } | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < MIN_VALUE_LENGTH) return null;
  // Sort by id for deterministic results when multiple files contain the value.
  const active = files
    .filter((f) => (f.deletionStatus ?? "ACTIVE") === "ACTIVE")
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const f of active) {
    const found = locateValueInFile(trimmed, f);
    if (found) return found;
  }
  return null;
}

/**
 * Format a Date value for searching. The regex extractors return Date objects
 * for deadlines; we search for the ISO date or a localized form.
 */
function formatDateForSearch(date: Date | null | undefined): string | null {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return null;
  // Search for the ISO date form (YYYY-MM-DD) — most extractors produce this.
  return date.toISOString().slice(0, 10);
}

export type EnrichmentInput = {
  title?: string | null;
  reference?: string | null;
  clientName?: string | null;
  deadline?: Date | null;
  submissionMethod?: string | null;
  submissionAddress?: string | null;
  submissionEmails?: string | string[] | null;
  /** Existing contactDetailsSourceJson (string) — the reference entry will be merged in. */
  existingContactDetailsSourceJson?: string | null;
};

/**
 * Given the extracted metadata + per-file texts, produce source-evidence
 * columns for every critical field that can be located in an active file.
 *
 * Only fields where evidence is found are included in the result. Fields
 * where no evidence is found are omitted (so the caller doesn't overwrite
 * existing evidence with null).
 */
export function enrichMetadataWithSourceEvidence(
  metadata: EnrichmentInput,
  files: EnrichmentFile[],
): EnrichedSourceEvidence {
  const out: EnrichedSourceEvidence = {};

  // clientName
  if (metadata.clientName) {
    const found = locateValueInFiles(metadata.clientName, files);
    if (found) {
      out.clientNameSourceFileId = found.fileId;
      out.clientNameSourcePage = found.page;
      out.clientNameSourceQuote = found.quote;
    }
  }

  // title
  if (metadata.title) {
    const found = locateValueInFiles(metadata.title, files);
    if (found) {
      out.titleSourceFileId = found.fileId;
      out.titleSourcePage = found.page;
      out.titleSourceQuote = found.quote;
    }
  }

  // deadline (search for the ISO date form; if not found, skip — the deadline
  // may be stored as a Date but the file text may use a different format like
  // "30 December 2026". The AI Analyze route handles this via its own
  // deadlineSourceQuote; here we only enrich when we can find the exact value.)
  const deadlineStr = formatDateForSearch(metadata.deadline);
  if (deadlineStr) {
    const found = locateValueInFiles(deadlineStr, files);
    if (found) {
      out.deadlineSourceFileId = found.fileId;
      out.deadlineSourcePage = found.page;
      out.deadlineSourceQuote = found.quote;
    }
  }

  // submissionMethod
  if (metadata.submissionMethod) {
    const found = locateValueInFiles(metadata.submissionMethod, files);
    if (found) {
      out.submissionMethodSourceFileId = found.fileId;
      out.submissionMethodSourcePage = found.page;
      out.submissionMethodSourceQuote = found.quote;
    }
  }

  // submissionAddress
  if (metadata.submissionAddress) {
    const found = locateValueInFiles(metadata.submissionAddress, files);
    if (found) {
      out.submissionAddressSourceFileId = found.fileId;
      out.submissionAddressSourcePage = found.page;
      out.submissionAddressSourceQuote = found.quote;
    }
  }

  // submissionEmails (can be a string or string[]; search for each email)
  const emailsRaw = metadata.submissionEmails;
  const emailsStr = Array.isArray(emailsRaw)
    ? emailsRaw.filter(Boolean).join("|")
    : typeof emailsRaw === "string" && emailsRaw.trim()
      ? emailsRaw.trim()
      : null;
  if (emailsStr) {
    const emailList = emailsStr.split("|").map((e) => e.trim()).filter(Boolean);
    for (const email of emailList) {
      const found = locateValueInFiles(email, files);
      if (found) {
        out.submissionEmailSourceFileId = found.fileId;
        out.submissionEmailSourcePage = found.page;
        out.submissionEmailSourceQuote = found.quote;
        break;
      }
    }
  }

  // reference (via contactDetailsSourceJson.procurementReferenceNumber)
  if (metadata.reference) {
    const found = locateValueInFiles(metadata.reference, files);
    if (found) {
      let contactDetails: Record<string, { page: number | null; quote: string | null; fileId: string | null }> = {};
      const existing = metadata.existingContactDetailsSourceJson;
      if (existing) {
        try {
          contactDetails = typeof existing === "string" ? JSON.parse(existing) : (existing ?? {});
        } catch {
          contactDetails = {};
        }
      }
      contactDetails["procurementReferenceNumber"] = {
        page: found.page,
        quote: found.quote,
        fileId: found.fileId,
      };
      out.contactDetailsSourceJson = JSON.stringify(contactDetails);
    }
  }

  return out;
}
