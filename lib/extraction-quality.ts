export type ExtractionQualitySeverity = "GOOD" | "WARNING" | "POOR" | "FAILED";

export type ExtractionQualityReport = {
  severity: ExtractionQualitySeverity;
  score: number;
  characterCount: number;
  pageMarkers: number;
  averageCharsPerPage: number | null;
  scannedPdfLikely: boolean;
  tableHeavyLikely: boolean;
  hasExtractionFailure: boolean;
  hasOcrPlaceholder: boolean;
  warnings: string[];
  recommendations: string[];
};

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

export function assessExtractionQuality(text: string | null | undefined, fileName?: string | null): ExtractionQualityReport {
  const raw = text ?? "";
  const normalized = raw.replace(/\s+/g, " ").trim();
  const characterCount = normalized.length;
  const pageMarkers = countMatches(raw, /\[Page\s+\d+\]/gi);
  const averageCharsPerPage = pageMarkers > 0 ? Math.round(characterCount / pageMarkers) : null;
  const hasExtractionFailure = /\[Extraction failed for/i.test(raw);
  const hasOcrPlaceholder = /scanned pdf|needs OCR|OCR skipped|\[Image:/i.test(raw);
  const scannedPdfLikely = characterCount < 250 || hasOcrPlaceholder;
  const tableDelimiters = countMatches(raw, /\||\t| {3,}/g);
  const tableHeavyLikely = tableDelimiters > 30 || /evaluation\s+criteria|scoring\s+matrix|price\s+schedule|financial\s+form|boq|bill\s+of\s+quantities/i.test(raw);

  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (hasExtractionFailure) {
    warnings.push("Extraction failure marker detected in extracted text.");
    recommendations.push("Re-upload the file or convert it to a clean PDF/DOCX before analysis.");
  }
  if (scannedPdfLikely) {
    warnings.push("Very low extracted text or OCR placeholder detected; the document is likely scanned/image-heavy.");
    recommendations.push("Enable OCR and re-import the file before tender analysis or company knowledge extraction.");
  }
  if (averageCharsPerPage !== null && averageCharsPerPage < 300) {
    warnings.push(`Low text density detected: approximately ${averageCharsPerPage} characters per extracted page.`);
    recommendations.push("Review extraction quality page-by-page; evaluation criteria and forms may be missing.");
  }
  if (tableHeavyLikely) {
    warnings.push("Table-heavy content detected. Some evaluation matrices, BOQs, and forms may need manual review.");
    recommendations.push("Cross-check extracted tables against the original tender document before relying on scoring/generation.");
  }
  if (/\.doc$/i.test(fileName ?? "")) {
    warnings.push("Legacy .doc file detected. Extraction may be incomplete compared with .docx.");
    recommendations.push("Convert the file to .docx and re-upload when possible.");
  }

  let score = 100;
  if (hasExtractionFailure) score -= 70;
  if (scannedPdfLikely) score -= 45;
  if (averageCharsPerPage !== null && averageCharsPerPage < 300) score -= 20;
  if (tableHeavyLikely) score -= 10;
  if (characterCount < 1000) score -= 10;
  score = Math.max(0, Math.min(100, score));

  const severity: ExtractionQualitySeverity = hasExtractionFailure
    ? "FAILED"
    : score < 45
      ? "POOR"
      : score < 75
        ? "WARNING"
        : "GOOD";

  if (severity === "GOOD" && warnings.length === 0) {
    recommendations.push("Extraction appears usable for analysis. Continue with AI analysis and readiness checks.");
  }

  return {
    severity,
    score,
    characterCount,
    pageMarkers,
    averageCharsPerPage,
    scannedPdfLikely,
    tableHeavyLikely,
    hasExtractionFailure,
    hasOcrPlaceholder,
    warnings,
    recommendations,
  };
}
