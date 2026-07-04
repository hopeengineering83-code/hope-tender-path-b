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

import type { AttributionFile } from "./metadata-source-attribution";

/** Minimum length of a value worth searching for in file text. */
const MIN_VALUE_LENGTH = 3;

/** Maximum characters of surrounding context to capture as the source quote. */
const QUOTE_CONTEXT_CHARS = 200;

export type EnrichmentFile = AttributionFile & {
  /** Total pages of the file when known — REQUIRED for the single-page
   *  fallback in page attribution. Without it, a document with no page
   *  boundaries gets NO page number (fail-closed), never a guessed "1". */
  totalPages?: number | null;
};

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
  // Reference evidence — dedicated columns read first by the strict BuildPlan
  // metadata validator. Also mirrored into contactDetailsSourceJson below for
  // the canonical resolver.
  referenceSourceFileId?: string;
  referenceSourcePage?: number | null;
  referenceSourceQuote?: string;
  // Required submission email subject evidence.
  submissionEmailSubjectSourceFileId?: string;
  submissionEmailSubjectSourcePage?: number | null;
  submissionEmailSubjectSourceQuote?: string;
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
 *
 * FAIL-CLOSED page attribution:
 *   - Form feeds (\f — inserted per page by the PDF extractor) are reliable
 *     page boundaries → page = formFeeds before the index + 1.
 *   - Explicit "Page N" markers on their own line are usable boundaries →
 *     page = last marker's N before the index.
 *   - NO boundaries at all → page 1 is returned ONLY when the file is
 *     verified as a one-page document (totalPages === 1). Otherwise the page
 *     is UNKNOWN (null): a multi-page document with no boundary information
 *     must not have its evidence attributed to page 1 by assumption.
 *   - A computed page beyond the file's known totalPages means the markers
 *     are unreliable → null (never persist an impossible page).
 */
function computePageNumber(
  text: string,
  matchIndex: number,
  totalPages?: number | null,
): number | null {
  if (matchIndex < 0 || matchIndex > text.length) return null;
  const clamp = (page: number): number | null =>
    typeof totalPages === "number" && totalPages > 0 && page > totalPages ? null : page;
  const before = text.slice(0, matchIndex);
  // 1. "[Page N]" markers — the CANONICAL page-boundary format written by
  //    lib/extract-text.ts at the start of every extracted page.
  const bracketMarkers = before.match(/\[Page\s+(\d+)\]/gi);
  if (bracketMarkers && bracketMarkers.length > 0) {
    const m = bracketMarkers[bracketMarkers.length - 1].match(/(\d+)/);
    if (m) return clamp(parseInt(m[1], 10));
  }
  if (/\[Page\s+\d+\]/i.test(text)) {
    // Markers exist but none precede the match → cannot attribute reliably.
    return totalPages === 1 ? 1 : null;
  }
  // 2. Form feeds (\f) — per-page boundaries from plain-text extractors.
  const formFeeds = (before.match(/\f/g) || []).length;
  if (formFeeds > 0 || text.includes("\f")) return clamp(formFeeds + 1);
  // 3. Unbracketed "Page N" line markers (some OCR providers).
  const pageMarkers = before.match(/(?:^|\n)[-\s]*Page\s+(\d+)/gi);
  if (pageMarkers && pageMarkers.length > 0) {
    const lastMatch = pageMarkers[pageMarkers.length - 1];
    const m = lastMatch.match(/(\d+)/);
    if (m) return clamp(parseInt(m[1], 10));
  }
  // No page boundaries in the text. Only a VERIFIED one-page file may be
  // attributed to page 1 — everything else stays unknown (fail-closed).
  if (totalPages === 1) return 1;
  return null;
}

/**
 * Build the normalized form of a text together with an exact index map from
 * every normalized character back to its offset in the original text. This
 * replaces the previous first-prefix approximation, which could map the match
 * to a DIFFERENT occurrence of a similar prefix and mis-attribute the page
 * and quote.
 */
function buildNormalizedIndex(text: string): { normalized: string; map: number[] } {
  const lower = text.toLowerCase();
  let normalized = "";
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v" || /\s/.test(ch)) {
      if (normalized.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      normalized += " ";
      map.push(i);
      pendingSpace = false;
    }
    normalized += ch;
    map.push(i);
  }
  return { normalized, map };
}

/**
 * Locate a value inside a file's extracted text and return the source evidence
 * (fileId, page, quote) if found. The quote is a snippet of surrounding context
 * (up to QUOTE_CONTEXT_CHARS characters) centered on the EXACT match position.
 *
 * The search is normalized (lowercase + collapsed whitespace) so it matches
 * across line wraps and spacing differences, and the normalized match index is
 * mapped back to the exact original offset — never approximated by prefix.
 */
function locateValueInFile(
  value: string,
  file: EnrichmentFile,
): { fileId: string; page: number | null; quote: string } | null {
  if (!file.extractedText) return null;
  const needle = normalizeText(value);
  if (needle.length < MIN_VALUE_LENGTH) return null;
  const { normalized, map } = buildNormalizedIndex(file.extractedText);
  const idx = normalized.indexOf(needle);
  if (idx < 0) return null;
  // EXACT mapping: map[idx] is the original offset of the matched character.
  const origIdx = map[idx];
  if (typeof origIdx !== "number") return null;
  const page = computePageNumber(file.extractedText, origIdx, file.totalPages);
  // Return the evidence even when page is null — the canonical resolver's
  // isGroundedEvidenceWithFileCheck rejects null pages, so the field stays
  // EXTRACTED_UNVERIFIED (not GROUNDED). The fileId + quote are still useful
  // for the UI to show WHERE the value was found, even if the page is unproven.
  // A null/unproven page must never make the field grounded, confirmed,
  // generation-ready, or export-ready — enforced by the resolver, not here.
  // Capture surrounding context from the original text for the quote,
  // centered on the true occurrence.
  const quoteStart = Math.max(0, origIdx - Math.floor(QUOTE_CONTEXT_CHARS / 2));
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
  submissionEmailSubject?: string | null;
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

  // reference — dedicated columns (read first by the strict BuildPlan
  // validator) plus the contactDetailsSourceJson.procurementReferenceNumber
  // entry the canonical resolver reads.
  if (metadata.reference) {
    const found = locateValueInFiles(metadata.reference, files);
    if (found) {
      out.referenceSourceFileId = found.fileId;
      out.referenceSourcePage = found.page;
      out.referenceSourceQuote = found.quote;
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

  // submissionEmailSubject — a REQUIRED email subject line is submission-
  // critical; when present it needs the same evidence as other fields.
  if (metadata.submissionEmailSubject) {
    const found = locateValueInFiles(metadata.submissionEmailSubject, files);
    if (found) {
      out.submissionEmailSubjectSourceFileId = found.fileId;
      out.submissionEmailSubjectSourcePage = found.page;
      out.submissionEmailSubjectSourceQuote = found.quote;
    }
  }

  return out;
}

/**
 * Build the "clear evidence" update map for a field whose scalar value changed.
 *
 * When re-extraction changes a metadata scalar, prior file/page/quote evidence
 * for the OLD value must NOT survive — it would be stale evidence for a
 * different value. This function returns the columns to set to null so the
 * old evidence tuple is cleared atomically with the new scalar value.
 *
 * The caller should Object.assign these into the update map BEFORE the
 * enrichment (which may re-set them with proven evidence for the NEW value).
 */
export function clearEvidenceForField(field: string): Record<string, null> {
  const clear: Record<string, null> = {};
  switch (field) {
    case "clientName":
      clear.clientNameSourceFileId = null;
      clear.clientNameSourcePage = null;
      clear.clientNameSourceQuote = null;
      break;
    case "title":
      clear.titleSourceFileId = null;
      clear.titleSourcePage = null;
      clear.titleSourceQuote = null;
      break;
    case "deadline":
      clear.deadlineSourceFileId = null;
      clear.deadlineSourcePage = null;
      clear.deadlineSourceQuote = null;
      break;
    case "submissionMethod":
      clear.submissionMethodSourceFileId = null;
      clear.submissionMethodSourcePage = null;
      clear.submissionMethodSourceQuote = null;
      break;
    case "submissionAddress":
      clear.submissionAddressSourceFileId = null;
      clear.submissionAddressSourcePage = null;
      clear.submissionAddressSourceQuote = null;
      break;
    case "submissionEmails":
      clear.submissionEmailSourceFileId = null;
      clear.submissionEmailSourcePage = null;
      clear.submissionEmailSourceQuote = null;
      break;
    case "reference":
      clear.referenceSourceFileId = null;
      clear.referenceSourcePage = null;
      clear.referenceSourceQuote = null;
      break;
    // submissionEmailSubject is not currently in SUPPORTED_EXTRACTORS or
    // tryFill, so this case is defensive — it exists so that if a future
    // extractor or route adds submissionEmailSubject re-extraction, the
    // stale-evidence clearing is already correct. No current caller reaches
    // this case, but the dedicated columns exist in the schema and must be
    // cleared atomically with any scalar change.
    case "submissionEmailSubject":
      clear.submissionEmailSubjectSourceFileId = null;
      clear.submissionEmailSubjectSourcePage = null;
      clear.submissionEmailSubjectSourceQuote = null;
      break;
  }
  return clear;
}
