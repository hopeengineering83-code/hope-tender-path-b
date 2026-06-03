export type ExtractionQualitySeverity = "GOOD" | "WARNING" | "POOR" | "FAILED";

export type PageQualityStatus = "GOOD" | "LOW_DENSITY" | "BLANK" | "FAILED" | "OCR" | "TABLE_HEAVY" | "IMAGE_HEAVY";

export type PageQualityEntry = {
  page: number;
  charCount: number;
  status: PageQualityStatus;
  hasSubmissionInstructions: boolean;
  hasEvaluationCriteria: boolean;
  hasRequiredDocuments: boolean;
  hasClientDetails: boolean;
};

export type PerPageExtractionReport = {
  totalDetectedPages: number;
  perfectPages: number[];
  lowDensityPages: number[];
  blankPages: number[];
  failedPages: number[];
  ocrPages: number[];
  tableHeavyPages: number[];
  submissionInstructionPages: number[];
  evaluationCriteriaPages: number[];
  requiredDocumentPages: number[];
  clientDetailPages: number[];
  coveragePercent: number;
  pages: PageQualityEntry[];
};

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
  // A completely empty extraction must score below the WARNING threshold (45).
  // Without this, 0 chars → scannedPdfLikely(−45) + charCount<1000(−10) = 45
  // exactly, which misclassifies as WARNING instead of POOR.
  if (characterCount === 0) score -= 6;
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

const LOW_DENSITY_THRESHOLD = 150; // chars per page below which we flag as low-density

export function assessExtractionQualityPerPage(text: string | null | undefined): PerPageExtractionReport {
  const raw = text ?? "";

  // Split by [Page N] markers, keeping the marker as part of each segment
  const segments = raw.split(/(?=\[Page\s+\d+\])/i);

  const pages: PageQualityEntry[] = [];
  const perfectPages: number[] = [];
  const lowDensityPages: number[] = [];
  const blankPages: number[] = [];
  const failedPages: number[] = [];
  const ocrPages: number[] = [];
  const tableHeavyPages: number[] = [];
  const submissionInstructionPages: number[] = [];
  const evaluationCriteriaPages: number[] = [];
  const requiredDocumentPages: number[] = [];
  const clientDetailPages: number[] = [];

  for (const segment of segments) {
    const markerMatch = segment.match(/\[Page\s+(\d+)\]/i);
    if (!markerMatch) continue;
    const pageNum = parseInt(markerMatch[1], 10);
    const pageText = segment.replace(/\[Page\s+\d+\]/i, "").trim();
    const charCount = pageText.replace(/\s+/g, " ").length;

    const isFailure = /\[Extraction failed/i.test(pageText);
    const isOcr = /ocrReason=|OCR skipped|\[Image:/i.test(pageText);
    const isBlank = charCount < 30;
    const isTableHeavy = /\|[\s\S]{0,200}\||\t|\bboq\b|bill of quantities|evaluation.{0,30}criteria|scoring.{0,30}matrix/i.test(pageText);
    const isImageHeavy = /\[Image:/i.test(pageText);
    const isLowDensity = !isBlank && !isFailure && charCount < LOW_DENSITY_THRESHOLD;

    const hasSubmission = /submission|submit|address|portal|email.*submit|deliver|drop.{0,10}box|hand.{0,10}deliver/i.test(pageText);
    const hasEvaluation = /evaluation.{0,30}criteria|scoring|technical\s+score|financial\s+score|weight.*point|points.*weight/i.test(pageText);
    const hasReqdDocs = /required\s+document|mandatory\s+document|documents?\s+required|checklist|annexure|annex\s+\d|form\s+\d|appendix/i.test(pageText);
    const hasClient = /procuring\s+entity|client\s+name|contact\s+person|telephone|email.*@|address.*street|po\s+box/i.test(pageText);

    let status: PageQualityStatus;
    if (isFailure) status = "FAILED";
    else if (isOcr) status = "OCR";
    else if (isBlank) status = "BLANK";
    else if (isImageHeavy) status = "IMAGE_HEAVY";
    else if (isTableHeavy) status = "TABLE_HEAVY";
    else if (isLowDensity) status = "LOW_DENSITY";
    else status = "GOOD";

    pages.push({ page: pageNum, charCount, status, hasSubmissionInstructions: hasSubmission, hasEvaluationCriteria: hasEvaluation, hasRequiredDocuments: hasReqdDocs, hasClientDetails: hasClient });

    if (status === "GOOD") perfectPages.push(pageNum);
    if (isLowDensity) lowDensityPages.push(pageNum);
    if (isBlank) blankPages.push(pageNum);
    if (isFailure) failedPages.push(pageNum);
    if (isOcr) ocrPages.push(pageNum);
    if (isTableHeavy) tableHeavyPages.push(pageNum);
    if (hasSubmission) submissionInstructionPages.push(pageNum);
    if (hasEvaluation) evaluationCriteriaPages.push(pageNum);
    if (hasReqdDocs) requiredDocumentPages.push(pageNum);
    if (hasClient) clientDetailPages.push(pageNum);
  }

  const totalDetectedPages = pages.length;
  const coveragePercent = totalDetectedPages > 0 ? Math.round((perfectPages.length / totalDetectedPages) * 100) : 0;

  return {
    totalDetectedPages,
    perfectPages,
    lowDensityPages,
    blankPages,
    failedPages,
    ocrPages,
    tableHeavyPages,
    submissionInstructionPages,
    evaluationCriteriaPages,
    requiredDocumentPages,
    clientDetailPages,
    coveragePercent,
    pages,
  };
}
