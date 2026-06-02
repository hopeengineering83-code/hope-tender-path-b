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
  | "REGEX_FALLBACK_FROM_WEAK_EXTRACTION";

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

export function deriveExtractionStatus(files: ExtractionFileMetrics[]): ExtractionStatus {
  if (files.length === 0) return "EXTRACTION_WEAK_REVIEW_REQUIRED";
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
