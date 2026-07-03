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
