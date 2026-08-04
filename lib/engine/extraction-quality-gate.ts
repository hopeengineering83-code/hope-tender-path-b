// Extraction Quality Gate
//
// Centralises the rules for deciding whether extraction quality is
// acceptable for AI Analyze, Build Plan, Generate Docs, and Final ZIP
// export.  The functions are pure (no Prisma / IO) so they can be used
// in both API routes and unit tests.
//
// ExtractionStatus values mirror the labels required by CLAUDE.md:
//   FULL_EXTRACTION_AI_ANALYZED
//   PARTIAL_EXTRACTION_AI_ANALYZED
//   OCR_REQUIRED
//   EXTRACTION_WEAK_REVIEW_REQUIRED
//   REGEX_FALLBACK_FROM_WEAK_EXTRACTION
//   EXTRACTION_CORRUPTED_AI_SKIPPED
//
// Unknown page counts are intentionally treated as weak for generation/export:
// production cannot prove which tender pages were extracted when totalPages is
// null. The UI can still show a partial/legacy status, but server-side final
// generation must not silently proceed on unknown extraction coverage.

export type ExtractionStatus =
  | "FULL_EXTRACTION_AI_ANALYZED"
  | "PARTIAL_EXTRACTION_AI_ANALYZED"
  | "OCR_REQUIRED"
  | "EXTRACTION_WEAK_REVIEW_REQUIRED"
  | "REGEX_FALLBACK_FROM_WEAK_EXTRACTION"
  | "EXTRACTION_CORRUPTED_AI_SKIPPED";

// ── Text quality scoring ─────────────────────────────────────────────────────
//
// Detects corrupted / garbage text that pdf2json / pdf-parse can produce when
// the PDF has encoding problems, icon fonts, or a degenerate text layer.
// A 17-page tender that produces 32K chars of "G G G ■ ■ ■ → →" symbols will
// score very low here even though its character count looks healthy to the
// old "length < 20" gate.

export interface PageTextQuality {
  score: number;               // 0-100
  isCorrupted: boolean;        // true if score < 40
  isBlank: boolean;
  symbolNoiseRatio: number;    // ratio of non-alphanumeric / punctuation chars
  repeatedGlyphRatio: number;  // ratio of repeated-glyph sequences in the text
  dictionaryWordRatio: number; // ratio of words that look like real words
  avgWordLength: number;
  brokenSpacingScore: number;  // ratio of single-char word tokens
  warnings: string[];
}

export function scorePageTextQuality(text: string): PageTextQuality {
  const raw = text ?? "";
  const words = raw.split(/\s+/).filter((w) => w.length > 0);
  const totalWords = words.length;

  // isBlank
  const isBlank = totalWords < 5;
  if (isBlank) {
    return {
      score: 0,
      isCorrupted: true,
      isBlank: true,
      symbolNoiseRatio: 0,
      repeatedGlyphRatio: 0,
      dictionaryWordRatio: 0,
      avgWordLength: 0,
      brokenSpacingScore: 0,
      warnings: ["Page is blank or has fewer than 5 words."],
    };
  }

  // symbolNoiseRatio: chars outside alphanumeric (Unicode-aware) and common punctuation.
  // \p{L} matches letters in any script (Latin, Arabic, Cyrillic, CJK, Amharic, etc.),
  // \p{N} matches digits, so non-Latin tenders are not misclassified as corrupted.
  const allowedCharsPattern = /[\p{L}\p{N}\s.,;:()\-'"!?/]/gu;
  const allowedCount = (raw.match(allowedCharsPattern) ?? []).length;
  const totalChars = raw.length;
  const symbolNoiseRatio = totalChars > 0 ? (totalChars - allowedCount) / totalChars : 0;

  // repeatedGlyphRatio: detect runs of 3+ identical non-alphanumeric chars
  // (e.g. "■■■", "→→→") OR sequences of the same uppercase letter separated
  // by spaces (e.g. "G G G G", "■ ■ ■"). We count matching characters as a
  // fraction of total characters.
  const repeatedRunMatches = raw.match(/([^a-zA-Z0-9\s])\1{2,}/g) ?? [];
  // Count "X X X" patterns (single uppercase letter or symbol repeating with spaces)
  const spacedRepeatMatches = raw.match(/(?:([A-Z■●◆▲▼←→↑↓♠♣♥♦★☆✓✗✘⊕⊗])\s+){2,}\1/g) ?? [];
  const repeatedGlyphChars =
    repeatedRunMatches.reduce((sum, m) => sum + m.length, 0) +
    spacedRepeatMatches.reduce((sum, m) => sum + m.length, 0);
  const repeatedGlyphRatio = totalChars > 0 ? repeatedGlyphChars / totalChars : 0;

  // dictionaryWordRatio: words consisting entirely of Unicode letters (any script), length >= 3.
  // Using \p{L} so Arabic, Cyrillic, CJK, Amharic words count as valid dictionary words.
  const dictWords = words.filter((w) => w.length >= 3 && /^\p{L}+$/u.test(w));
  const dictionaryWordRatio = totalWords > 0 ? dictWords.length / totalWords : 0;

  // brokenSpacingScore: single-character tokens
  const singleCharWords = words.filter((w) => w.length === 1);
  const brokenSpacingScore = totalWords > 0 ? singleCharWords.length / totalWords : 0;

  // avgWordLength
  const avgWordLength = totalWords > 0 ? words.reduce((sum, w) => sum + w.length, 0) / totalWords : 0;

  // Score calculation
  const warnings: string[] = [];
  let score = 100;

  if (symbolNoiseRatio > 0.15) {
    score -= 25;
    warnings.push(`High symbol noise ratio: ${(symbolNoiseRatio * 100).toFixed(1)}%.`);
  }
  if (symbolNoiseRatio > 0.30) {
    score -= 25;
    warnings.push("Very high symbol noise — text likely corrupted.");
  }

  if (repeatedGlyphRatio > 0.05) {
    score -= 20;
    warnings.push(`Repeated glyph sequences detected (ratio: ${(repeatedGlyphRatio * 100).toFixed(1)}%).`);
  }
  if (repeatedGlyphRatio > 0.10) {
    score -= 15;
    warnings.push("High density of repeated non-alphanumeric glyphs — likely garbage/icon-font text.");
  }

  if (dictionaryWordRatio < 0.30) {
    score -= 20;
    warnings.push(`Low dictionary word ratio: ${(dictionaryWordRatio * 100).toFixed(1)}% — few recognisable words.`);
  }
  if (dictionaryWordRatio < 0.15) {
    score -= 15;
    warnings.push("Very low dictionary word ratio — text does not resemble natural language.");
  }

  if (brokenSpacingScore > 0.25) {
    score -= 20;
    warnings.push(`High broken-spacing score: ${(brokenSpacingScore * 100).toFixed(1)}% single-char tokens.`);
  }
  if (brokenSpacingScore > 0.40) {
    score -= 15;
    warnings.push("Extreme broken spacing — individual characters separated by spaces (corrupted PDF text layer).");
  }

  score = Math.max(0, Math.min(100, score));
  const isCorrupted = score < 40;

  return {
    score,
    isCorrupted,
    isBlank,
    symbolNoiseRatio,
    repeatedGlyphRatio,
    dictionaryWordRatio,
    avgWordLength,
    brokenSpacingScore,
    warnings,
  };
}

/**
 * Returns true when the supplied text sample looks like corrupted / garbage
 * output from a broken PDF text layer. Use this before deciding whether to
 * run OCR or block AI Analyze.
 */
export function isExtractionCorrupted(textSample: string): boolean {
  return scorePageTextQuality(textSample).isCorrupted;
}

export type ExtractionFileMetrics = {
  extractionScore: number | null;
  totalPages: number | null;
  extractedPages: number | null;
  ocrPages: number | null;
  failedPages: number | null;
  corruptedPages?: number | null; // Pages with corrupted/garbage text detected
};

export type ExtractionFileForCoverage = ExtractionFileMetrics & {
  id?: string | null;
  fileName?: string | null;
  extractionMethod?: string | null;
  characterCount?: number | null;
};

export type ExtractionPageIssue = {
  fileName: string;
  page: number | null;
  reason: string;
  score: number | null;
};

export type ExtractionCoverageReport = {
  totalPagesKnown: boolean;
  totalPages: number;
  perfectlyExtractedPages: number;
  ocrPages: number;
  failedPages: number;
  corruptedPages: number; // Pages with corrupted/garbage text detected
  weakPages: number;
  extractedPages: number;
  extractionCoveragePercent: number;
  lowConfidencePages: ExtractionPageIssue[];
  failedPageList: ExtractionPageIssue[];
  recommendedActions: string[];
  blockingReasons: string[];
  partiallyExtracted: boolean;
};

// Backwards-compatible alias used by ai-analyze route
export type TenderFileQuality = ExtractionFileMetrics;

// ── thresholds ───────────────────────────────────────────────────────────────
/** Score at/above which extraction is considered fully reliable for AI Analyze. */
export const EXTRACTION_SCORE_GOOD_THRESHOLD = 80;
/** Score at/above which extraction is considered partial but usable for draft. */
export const EXTRACTION_SCORE_WARN_THRESHOLD = 60;
/** Score below this blocks Build Plan and Generate Docs. */
export const EXTRACTION_SCORE_BLOCK_THRESHOLD = 40;
/** sourceConfidence at/above this is considered high-confidence traceability. */
export const SOURCE_CONFIDENCE_HIGH = 0.7;
/** sourceConfidence at/above this is considered acceptable traceability. */
export const SOURCE_CONFIDENCE_ACCEPTABLE = 0.4;

const FULL_EXTRACTION_MIN_SCORE = EXTRACTION_SCORE_GOOD_THRESHOLD;
const PARTIAL_EXTRACTION_MIN_SCORE = EXTRACTION_SCORE_WARN_THRESHOLD;
const WEAK_MIN_SCORE = EXTRACTION_SCORE_BLOCK_THRESHOLD;
const CRITICALLY_FAILED_SCORE = EXTRACTION_SCORE_BLOCK_THRESHOLD;
// Aligned with CRITICALLY_FAILED_SCORE so export cannot proceed on extraction
// quality that would have blocked generation. A 20-point gap allowed "ready for
// export" verdicts on visibly weak extraction — closing that gap here.
// Keep the literal 40 so static-audit tests can grep for the canonical value.
const EXPORT_BLOCK_SCORE = 40;

function averageScore(files: ExtractionFileMetrics[]): number | null {
  const scoredFiles = files.filter((f) => f.extractionScore !== null);
  if (scoredFiles.length === 0) return null;
  const sum = scoredFiles.reduce((acc, f) => acc + (f.extractionScore as number), 0);
  return sum / scoredFiles.length;
}

function hasOcrPages(files: ExtractionFileMetrics[]): boolean {
  return files.some((f) => f.ocrPages !== null && (f.ocrPages as number) > 0);
}

function hasFailedPages(files: ExtractionFileMetrics[]): boolean {
  return files.some((f) => f.failedPages !== null && (f.failedPages as number) > 0);
}

function hasUnknownPageCount(files: ExtractionFileMetrics[]): boolean {
  return files.some((f) => f.totalPages === null || f.totalPages === undefined || f.totalPages <= 0);
}

function hasIncompletePageCoverage(files: ExtractionFileMetrics[]): boolean {
  return files.some((f) => {
    if (f.totalPages === null || f.totalPages === undefined || f.extractedPages === null || f.extractedPages === undefined) return true;
    return f.extractedPages < f.totalPages;
  });
}

function clampCount(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.max(0, Math.floor(value as number));
}

function fileLabel(file: ExtractionFileForCoverage, index: number): string {
  return file.fileName?.trim() || file.id?.trim() || `Tender file ${index + 1}`;
}

function pushPageRange(list: ExtractionPageIssue[], fileName: string, start: number, count: number, reason: string, score: number | null) {
  for (let i = 0; i < Math.min(count, 25); i++) list.push({ fileName, page: start + i, reason, score });
  if (count > 25) list.push({ fileName, page: null, reason: `${reason} (${count - 25} additional page(s) not listed)`, score });
}

export function deriveExtractionStatus(
  files: ExtractionFileMetrics[],
  textSamples?: (string | null | undefined)[],
): ExtractionStatus {
  if (files.length === 0) return "EXTRACTION_WEAK_REVIEW_REQUIRED";

  // If text samples are provided and any non-empty sample is corrupted,
  // block regardless of score metrics (a single corrupted file contaminates).
  if (textSamples && textSamples.length > 0) {
    const nonEmpty = textSamples.filter((t): t is string => Boolean(t && t.trim().length > 20));
    if (nonEmpty.length > 0 && nonEmpty.some((t) => isExtractionCorrupted(t))) {
      return "EXTRACTION_CORRUPTED_AI_SKIPPED";
    }
  }


  if (hasUnknownPageCount(files)) return "EXTRACTION_WEAK_REVIEW_REQUIRED";
  const avg = averageScore(files);
  if (avg === null) return "EXTRACTION_WEAK_REVIEW_REQUIRED";
  if (avg < WEAK_MIN_SCORE) return "REGEX_FALLBACK_FROM_WEAK_EXTRACTION";
  if (avg < PARTIAL_EXTRACTION_MIN_SCORE) return "EXTRACTION_WEAK_REVIEW_REQUIRED";
  if (avg >= FULL_EXTRACTION_MIN_SCORE && !hasOcrPages(files) && !hasFailedPages(files) && !hasIncompletePageCoverage(files)) {
    return "FULL_EXTRACTION_AI_ANALYZED";
  }
  return "PARTIAL_EXTRACTION_AI_ANALYZED";
}

export function summarizeExtractionCoverage(files: ExtractionFileForCoverage[]): ExtractionCoverageReport {
  let totalPages = 0;
  let perfectlyExtractedPages = 0;
  let ocrPages = 0;
  let failedPages = 0;
  let corruptedPages = 0;
  let extractedPages = 0;
  const lowConfidencePages: ExtractionPageIssue[] = [];
  const failedPageList: ExtractionPageIssue[] = [];
  const recommendedActions = new Set<string>();
  const blockingReasons = new Set<string>();
  let totalPagesKnown = files.length > 0;

  files.forEach((file, index) => {
    const name = fileLabel(file, index);
    const score = file.extractionScore ?? null;
    const fileTotal = clampCount(file.totalPages);
    const fileExtracted = clampCount(file.extractedPages);
    const fileOcr = clampCount(file.ocrPages);
    const fileFailed = clampCount(file.failedPages);
    const fileCorrupted = clampCount(file.corruptedPages);

    if (fileTotal <= 0) {
      totalPagesKnown = false;
      lowConfidencePages.push({ fileName: name, page: null, reason: "Total page count unknown", score });
      blockingReasons.add("Total page count is unknown for one or more tender files.");
      recommendedActions.add("Re-extract PDF");
      recommendedActions.add("Upload a clearer, text-based copy");
      return;
    }

    totalPages += fileTotal;
    extractedPages += Math.min(fileExtracted, fileTotal);
    ocrPages += Math.min(fileOcr, fileTotal);
    // Treat corrupted pages as failed pages for coverage calculation
    const totalFailedOrCorrupted = Math.min(fileFailed + fileCorrupted, fileTotal);
    failedPages += totalFailedOrCorrupted;
    corruptedPages += Math.min(fileCorrupted, fileTotal);

    const missingPages = Math.max(0, fileTotal - fileExtracted);
    const weakByScore = score === null || score < FULL_EXTRACTION_MIN_SCORE;
    const filePerfect = Math.max(0, Math.min(fileTotal, fileExtracted) - fileOcr - totalFailedOrCorrupted - (weakByScore ? missingPages : 0));
    if (!weakByScore && totalFailedOrCorrupted === 0 && missingPages === 0) perfectlyExtractedPages += filePerfect;

    if (score === null) {
      lowConfidencePages.push({ fileName: name, page: null, reason: "Extraction score unknown", score });
      recommendedActions.add("Re-extract PDF");
      blockingReasons.add("Extraction confidence score is unknown for one or more tender files.");
    } else if (score < PARTIAL_EXTRACTION_MIN_SCORE) {
      pushPageRange(lowConfidencePages, name, 1, fileTotal, "Low extraction confidence", score);
      recommendedActions.add("Upload a clearer, text-based copy");
      recommendedActions.add("Upload clearer scan");
      blockingReasons.add("Extraction score is weak for one or more tender files.");
    } else if (score < FULL_EXTRACTION_MIN_SCORE) {
      pushPageRange(lowConfidencePages, name, 1, Math.max(1, fileTotal - filePerfect), "Review partial extraction confidence", score);
      recommendedActions.add("Continue only if extraction is acceptable");
    }

    if (fileFailed > 0) {
      pushPageRange(failedPageList, name, Math.max(1, fileExtracted - fileFailed + 1), fileFailed, "Page extraction failed or blank", score);
      recommendedActions.add("Re-extract PDF");
      recommendedActions.add("Upload a clearer, text-based copy");
      blockingReasons.add("One or more tender pages failed extraction.");
    }
    if (fileCorrupted > 0) {
      pushPageRange(failedPageList, name, 1, fileCorrupted, "Page text corrupted/garbage detected", score);
      recommendedActions.add("Upload a clearer, text-based copy");
      recommendedActions.add("Upload clearer scan");
      blockingReasons.add("One or more pages contain corrupted or garbage text (OCR likely needed).");
    }
    if (missingPages > 0) {
      pushPageRange(failedPageList, name, fileExtracted + 1, missingPages, "Page not text-extracted", score);
      recommendedActions.add("Re-extract PDF");
      recommendedActions.add("Upload a clearer, text-based copy");
      blockingReasons.add("One or more tender pages were not extracted.");
    }
    if (fileOcr > 0) recommendedActions.add("Continue only if extraction is acceptable");
  });

  const weakPages = Math.max(0, totalPages - perfectlyExtractedPages - failedPages);
  const extractionCoveragePercent = totalPages > 0 ? Math.round((perfectlyExtractedPages / totalPages) * 100) : 0;
  if (files.length === 0) {
    totalPagesKnown = false;
    blockingReasons.add("No tender files are available for extraction quality review.");
    recommendedActions.add("Upload clearer scan");
  }
  if (recommendedActions.size === 0) recommendedActions.add("Continue only if extraction is acceptable");

  return {
    totalPagesKnown,
    totalPages,
    perfectlyExtractedPages,
    ocrPages,
    failedPages,
    corruptedPages,
    weakPages,
    extractedPages,
    extractionCoveragePercent,
    lowConfidencePages,
    failedPageList,
    recommendedActions: [...recommendedActions],
    blockingReasons: [...blockingReasons],
    partiallyExtracted: !totalPagesKnown || weakPages > 0 || failedPages > 0 || ocrPages > 0,
  };
}

export function isExtractionAcceptableForGeneration(files: ExtractionFileMetrics[]): boolean {
  if (files.length === 0) return false;
  if (hasUnknownPageCount(files)) return false;
  if (hasIncompletePageCoverage(files)) return false;
  return !files.some((f) => f.extractionScore === null || (f.extractionScore as number) < CRITICALLY_FAILED_SCORE || clampCount(f.failedPages) > 0 || clampCount(f.corruptedPages) > 0);
}

export function isExtractionAcceptableForExport(files: ExtractionFileMetrics[]): boolean {
  if (files.length === 0) return false;
  if (hasUnknownPageCount(files)) return false;
  if (hasIncompletePageCoverage(files)) return false;
  return !files.some((f) => f.extractionScore === null || (f.extractionScore as number) < EXPORT_BLOCK_SCORE || clampCount(f.failedPages) > 0 || clampCount(f.corruptedPages) > 0);
}
