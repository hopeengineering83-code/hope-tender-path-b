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
// The TenderFile fields consumed here (extractionScore, totalPages,
// extractedPages, ocrPages, failedPages) may be null when the app has
// not yet recorded per-file extraction metrics — in that case the gate
// treats the file as partially extracted but not critically failed.

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
};

// Backwards-compatible alias used by ai-analyze route
export type TenderFileQuality = ExtractionFileMetrics;

// ── thresholds ───────────────────────────────────────────────────────────────
const FULL_EXTRACTION_MIN_SCORE = 80;
const PARTIAL_EXTRACTION_MIN_SCORE = 60;
const WEAK_MIN_SCORE = 40;
const CRITICALLY_FAILED_SCORE = 40;
const EXPORT_BLOCK_SCORE = 20;

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

export function deriveExtractionStatus(
  files: ExtractionFileMetrics[],
  textSamples?: (string | null | undefined)[],
): ExtractionStatus {
  if (files.length === 0) return "EXTRACTION_WEAK_REVIEW_REQUIRED";

  // If text samples are provided and every non-empty sample is corrupted,
  // the extraction cannot be trusted regardless of score metrics.
  if (textSamples && textSamples.length > 0) {
    const nonEmpty = textSamples.filter((t): t is string => Boolean(t && t.trim().length > 20));
    if (nonEmpty.length > 0 && nonEmpty.every((t) => isExtractionCorrupted(t))) {
      return "EXTRACTION_CORRUPTED_AI_SKIPPED";
    }
  }

  const avg = averageScore(files);
  if (avg === null) return "PARTIAL_EXTRACTION_AI_ANALYZED";
  if (avg < WEAK_MIN_SCORE) return "REGEX_FALLBACK_FROM_WEAK_EXTRACTION";
  if (avg < PARTIAL_EXTRACTION_MIN_SCORE) return "EXTRACTION_WEAK_REVIEW_REQUIRED";
  if (avg >= FULL_EXTRACTION_MIN_SCORE && !hasOcrPages(files) && !hasFailedPages(files)) {
    return "FULL_EXTRACTION_AI_ANALYZED";
  }
  return "PARTIAL_EXTRACTION_AI_ANALYZED";
}

export function isExtractionAcceptableForGeneration(files: ExtractionFileMetrics[]): boolean {
  if (files.length === 0) return true;
  return !files.some((f) => f.extractionScore !== null && (f.extractionScore as number) < CRITICALLY_FAILED_SCORE);
}

export function isExtractionAcceptableForExport(files: ExtractionFileMetrics[]): boolean {
  if (files.length === 0) return false;
  return !files.some((f) => f.extractionScore !== null && (f.extractionScore as number) < EXPORT_BLOCK_SCORE);
}
