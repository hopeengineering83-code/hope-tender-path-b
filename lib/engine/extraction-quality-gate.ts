/**
 * extraction-quality-gate.ts
 *
 * Derives a machine-readable extraction status from the per-file quality
 * metrics stored on TenderFile rows, and exposes two gate functions used
 * by the Generate Docs and Export routes to decide whether the extraction
 * quality is acceptable for the requested operation.
 */

export type ExtractionStatus =
  | "FULL_EXTRACTION_AI_ANALYZED"
  | "PARTIAL_EXTRACTION_AI_ANALYZED"
  | "OCR_REQUIRED"
  | "EXTRACTION_WEAK_REVIEW_REQUIRED"
  | "REGEX_FALLBACK_FROM_WEAK_EXTRACTION";

export interface TenderFileQuality {
  totalPages: number | null;
  extractedPages: number | null;
  ocrPages: number | null;
  failedPages: number | null;
  extractionScore: number | null; // 0-100
}

/**
 * Derives the overall extraction status from an array of TenderFile quality
 * snapshots. Returns a conservative status when any data is missing.
 */
export function deriveExtractionStatus(files: TenderFileQuality[]): ExtractionStatus {
  if (files.length === 0) return "EXTRACTION_WEAK_REVIEW_REQUIRED";
  const hasScore = files.some(f => f.extractionScore !== null);
  if (!hasScore) return "PARTIAL_EXTRACTION_AI_ANALYZED"; // unknown quality — treat as partial
  const avgScore = files.reduce((s, f) => s + (f.extractionScore ?? 50), 0) / files.length;
  const hasOcr = files.some(f => (f.ocrPages ?? 0) > 0);
  const hasFailed = files.some(f => (f.failedPages ?? 0) > 0);
  if (avgScore >= 75 && !hasFailed) return hasOcr ? "PARTIAL_EXTRACTION_AI_ANALYZED" : "FULL_EXTRACTION_AI_ANALYZED";
  if (avgScore >= 45) return "EXTRACTION_WEAK_REVIEW_REQUIRED";
  return "REGEX_FALLBACK_FROM_WEAK_EXTRACTION";
}

/**
 * Returns true when extraction quality is good enough to run document
 * generation. Blocks only on very poor extraction (REGEX_FALLBACK).
 */
export function isExtractionAcceptableForGeneration(files: TenderFileQuality[]): boolean {
  // Allow generation if at least partial extraction; block only on REGEX_FALLBACK from very poor extraction
  const status = deriveExtractionStatus(files);
  return status !== "REGEX_FALLBACK_FROM_WEAK_EXTRACTION";
}

/**
 * Returns true when extraction quality is good enough to proceed with
 * final ZIP export. Rejects files with an extractionScore below 20 (nearly
 * no usable text extracted).
 */
export function isExtractionAcceptableForExport(files: TenderFileQuality[]): boolean {
  // Export requires at least partial extraction — no failed-only files
  if (files.length === 0) return false;
  return !files.some(f => f.extractionScore !== null && f.extractionScore < 20);
}
