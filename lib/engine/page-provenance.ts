/**
 * Page-provenance guard for source evidence.
 *
 * Uses TenderFile.totalPages (stored at upload from the real PDF page count)
 * as the authoritative page-count guard.
 *
 * Rules:
 *   1. [Page N] markers and form feeds (\f) MAY establish a page number.
 *   2. With no reliable page boundary, allow page 1 ONLY when totalPages === 1.
 *   3. When totalPages is null, 0, or > 1 and no boundary, sourcePage is null.
 *   4. Reject any computed page outside 1..totalPages when totalPages is known.
 */

export function computeProvenPageNumber(
  text: string,
  matchIndex: number,
  totalPages: number | null | undefined,
): number | null {
  if (matchIndex < 0 || matchIndex > text.length) return null;

  const knownTotal = typeof totalPages === "number" && Number.isFinite(totalPages) && totalPages > 0
    ? totalPages
    : null;

  const before = text.slice(0, matchIndex);

  // 1. Form feeds (\f) are hard page boundaries.
  const formFeeds = (before.match(/\f/g) || []).length;
  if (formFeeds > 0) {
    const page = formFeeds + 1;
    if (knownTotal !== null && (page < 1 || page > knownTotal)) return null;
    return page;
  }

  // 2. "[Page N]" markers.
  const bracketMarkers = before.match(/\[Page\s+(\d+)\]/gi);
  if (bracketMarkers && bracketMarkers.length > 0) {
    const last = bracketMarkers[bracketMarkers.length - 1];
    const m = last.match(/(\d+)/);
    if (m) {
      const page = parseInt(m[1], 10);
      if (knownTotal !== null && (page < 1 || page > knownTotal)) return null;
      return page;
    }
  }

  // 3. "Page N" markers at line start.
  const linePageMarkers = before.match(/(?:^|\n)[-\s]*Page\s+(\d+)/gi);
  if (linePageMarkers && linePageMarkers.length > 0) {
    const last = linePageMarkers[linePageMarkers.length - 1];
    const m = last.match(/(\d+)/);
    if (m) {
      const page = parseInt(m[1], 10);
      if (knownTotal !== null && (page < 1 || page > knownTotal)) return null;
      return page;
    }
  }

  // 4. No reliable boundary — page 1 only when totalPages === 1.
  if (knownTotal === 1) return 1;
  return null;
}

/** Minimum normalized quote length worth locating (mirrors grounding floor). */
const MIN_QUOTE_CHARS = 6;

/** Safety cap on occurrence scanning — a quote repeated more often than this is
 *  boilerplate (headers/footers) and can never be unambiguous page evidence. */
const MAX_QUOTE_OCCURRENCES = 200;

/**
 * Build the normalized (lowercased, whitespace-collapsed) form of a text
 * together with an exact index map from every normalized character back to its
 * offset in the ORIGINAL text.
 *
 * This exists so quote searches can be whitespace/line-wrap tolerant while the
 * resulting match position is still a REAL original-text offset — a normalized
 * offset must never be passed to computeProvenPageNumber directly, because the
 * normalized string has different lengths/positions than the original.
 */
function buildNormalizedIndexMap(text: string): { normalized: string; map: number[] } {
  const lower = text.toLowerCase();
  let normalized = "";
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    if (/\s/.test(ch)) {
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
 * Locate a verbatim quote inside a file's ORIGINAL extracted text and return
 * the proven page number of its occurrence, or null when the page cannot be
 * proven. THE canonical quote→page resolver for AI-claimed evidence.
 *
 * Fail-closed rules (all violations return null — never a guessed page):
 *   1. The FULL normalized quote must appear in the normalized text. No prefix
 *      matching: a 20-char prefix shared with a different passage must never
 *      prove a page for the full quote.
 *   2. A quote that is NOT found yields null — never an offset-0 fallback,
 *      which would misattribute the evidence to page 1.
 *   3. Every occurrence's match index is mapped back to its exact ORIGINAL
 *      text offset before page computation (normalized offsets are never used
 *      against the original text).
 *   4. AMBIGUITY: when the quote occurs multiple times and the occurrences
 *      resolve to DIFFERENT pages (or a mix of proven and unproven), the page
 *      is unprovable → null. Duplicates on the SAME page stay proven.
 *   5. Page bounds and no-boundary rules are enforced by
 *      computeProvenPageNumber (page 1 only when totalPages === 1, etc.).
 */
export function locateQuoteProvenPage(
  originalText: string | null | undefined,
  quote: string | null | undefined,
  totalPages: number | null | undefined,
): number | null {
  if (!originalText || !quote) return null;
  const needle = quote.toLowerCase().replace(/\s+/g, " ").trim();
  if (needle.length < MIN_QUOTE_CHARS) return null;
  const { normalized, map } = buildNormalizedIndexMap(originalText);
  let idx = normalized.indexOf(needle);
  if (idx < 0) return null;
  let provenPage: number | null | undefined = undefined;
  let occurrences = 0;
  while (idx >= 0) {
    occurrences += 1;
    if (occurrences > MAX_QUOTE_OCCURRENCES) return null;
    const origIdx = map[idx];
    if (typeof origIdx !== "number") return null;
    const page = computeProvenPageNumber(originalText, origIdx, totalPages);
    if (provenPage === undefined) {
      provenPage = page;
    } else if (provenPage !== page) {
      // Occurrences disagree on the page — ambiguous, cannot prove.
      return null;
    }
    idx = normalized.indexOf(needle, idx + 1);
  }
  return provenPage ?? null;
}
