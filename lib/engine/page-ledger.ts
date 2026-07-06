/**
 * Authoritative Page Ledger
 *
 * Every active TenderFile with known page count must have exactly one durable
 * or deterministically derived extraction state for every source page.
 *
 * The page ledger uses `totalPages` as the authoritative denominator.
 * A 7-page PDF with only 4 processed pages must show 4/7 (57%), NOT 4/4 (100%).
 * Missing pages must be visible and must not disappear from calculations.
 *
 * Every extraction panel, API route, command center, readiness gate, AI
 * preflight, and final release gate must use ONE shared page-ledger calculation.
 */

export type PageStatus =
  | "GOOD" | "WEAK" | "OCR" | "IMAGE_HEAVY" | "TABLE_HEAVY"
  | "BLANK" | "FAILED" | "MISSING";

export type PageLedgerEntry = {
  pageNumber: number;
  status: PageStatus;
  charCount: number;
  hasContent: boolean;
};

export type PageLedger = {
  /** The authoritative total page count from the source PDF. */
  totalPages: number | null;
  /** Pages with extraction state (from pageStatusJson or computed). */
  processedPages: number;
  /** Pages with no extraction state. */
  missingPages: number[];
  /** Per-page status entries (only for processed pages). */
  entries: PageLedgerEntry[];
  /** Coverage percentage: processedPages / totalPages * 100. */
  coveragePercent: number;
  /** True when page count is unknown (totalPages is null or 0). */
  hasUnknownPageCount: boolean;
  /** True when any page is FAILED. */
  hasFailedPages: boolean;
  /** True when any page is MISSING. */
  hasMissingPages: boolean;
  /** True when extraction is safe for AI analysis. */
  isSafeForAnalysis: boolean;
  /** Human-readable summary. */
  summary: string;
};

/**
 * Build a page ledger from the stored pageStatusJson + totalPages.
 *
 * Rules:
 * 1. totalPages is the authoritative denominator.
 * 2. Pages without a status entry are MISSING.
 * 3. Coverage = processedPages / totalPages * 100.
 * 4. Extraction is NOT safe for analysis when:
 *    - source page count is unknown
 *    - source pages are missing
 *    - failed pages exist
 *    - OCR output is corrupted
 */
export function buildPageLedger(
  totalPages: number | null,
  pageStatusJson: string | null,
  extractionScore: number | null,
): PageLedger {
  // Parse page status entries
  let entries: PageLedgerEntry[] = [];
  if (pageStatusJson) {
    try {
      const parsed = JSON.parse(pageStatusJson);
      if (Array.isArray(parsed)) {
        entries = parsed.map((p: any) => ({
          pageNumber: typeof p.page === "number" ? p.page : 0,
          status: (p.status as PageStatus) || "MISSING",
          charCount: typeof p.charCount === "number" ? p.charCount : 0,
          hasContent: typeof p.hasContent === "boolean" ? p.hasContent : (typeof p.charCount === "number" ? p.charCount > 30 : false),
        })).filter((e: PageLedgerEntry) => e.pageNumber > 0);
      }
    } catch {
      entries = [];
    }
  }

  const hasUnknownPageCount = !totalPages || totalPages <= 0;
  const processedPages = entries.length;
  const effectiveTotal = hasUnknownPageCount ? processedPages : totalPages;

  // Compute missing pages
  const missingPages: number[] = [];
  if (!hasUnknownPageCount && totalPages > 0) {
    const processedSet = new Set(entries.map((e) => e.pageNumber));
    for (let i = 1; i <= totalPages; i++) {
      if (!processedSet.has(i)) {
        missingPages.push(i);
      }
    }
  }

  const hasFailedPages = entries.some((e) => e.status === "FAILED");
  const hasMissingPages = missingPages.length > 0;
  const coveragePercent = effectiveTotal > 0
    ? Math.round((processedPages / effectiveTotal) * 100)
    : 0;

  // Extraction is safe for analysis only when ALL conditions are met:
  // 1. Page count is known
  // 2. No missing pages
  // 3. No failed pages
  // 4. Extraction score is above threshold (40 = CRITICALLY_FAILED_SCORE)
  const isSafeForAnalysis = !hasUnknownPageCount
    && !hasMissingPages
    && !hasFailedPages
    && (extractionScore === null || extractionScore >= 40);

  // Build summary
  let summary: string;
  if (hasUnknownPageCount) {
    summary = `Page count unknown. ${processedPages} page(s) processed. Cannot verify coverage.`;
  } else {
    summary = `${processedPages}/${totalPages} pages processed (${coveragePercent}%).`;
    if (hasMissingPages) {
      summary += ` Missing: ${missingPages.join(", ")}.`;
    }
    if (hasFailedPages) {
      summary += ` Failed pages exist.`;
    }
    if (!isSafeForAnalysis) {
      summary += ` NOT SAFE for AI analysis.`;
    }
  }

  return {
    totalPages: hasUnknownPageCount ? null : totalPages,
    processedPages,
    missingPages,
    entries,
    coveragePercent,
    hasUnknownPageCount,
    hasFailedPages,
    hasMissingPages,
    isSafeForAnalysis,
    summary,
  };
}
