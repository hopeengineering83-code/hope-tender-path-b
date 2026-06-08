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
  corrupted: boolean;
  corruptionSignals: string[];
  warnings: string[];
  recommendations: string[];
};

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

const COMMON_TENDER_WORDS = new Set([
  "the", "and", "for", "shall", "proposal", "tender", "bid", "submission", "technical", "financial",
  "consultant", "consultancy", "services", "project", "requirements", "criteria", "evaluation", "deadline",
  "client", "procuring", "entity", "contract", "document", "documents", "experience", "methodology",
  "work", "plan", "qualification", "form", "envelope", "address", "email", "date", "reference", "scope",
]);

export type ExtractionCorruptionReport = {
  corrupted: boolean;
  signals: string[];
  symbolRatio: number;
  isolatedLetterRatio: number;
  commonWordRatio: number;
  brokenSpacingRatio: number;
};

export function isExtractionCorrupted(text: string | null | undefined): ExtractionCorruptionReport {
  const raw = text ?? "";
  const normalized = raw.replace(/\s+/g, " ").trim();
  const length = normalized.length;
  const signals: string[] = [];
  if (length < 250) return { corrupted: false, signals, symbolRatio: 0, isolatedLetterRatio: 0, commonWordRatio: 0, brokenSpacingRatio: 0 };

  const symbols = countMatches(normalized, /[■□�⬛⬜◆◇●○▲▼▶◀→←↔↕☐☑✓✗×÷≠≤≥≈~`^_={}\[\]<>|\\]/g);
  const symbolRatio = symbols / Math.max(1, length);
  const replacementCount = countMatches(normalized, /[■□�⬛⬜]/g);
  const repeatedGlyphRuns = countMatches(normalized, /\b([A-Za-z])\1{3,}\b|([■□�⬛⬜◆◇●○▲▼▶◀])\2{2,}/g);
  const isolatedLetters = countMatches(normalized, /(?:^|\s)[A-Za-z](?=\s|$)/g);
  const wordTokens = normalized.match(/[A-Za-z]{2,}/g) ?? [];
  const isolatedLetterRatio = isolatedLetters / Math.max(1, wordTokens.length + isolatedLetters);
  const commonWordHits = wordTokens.filter((token) => COMMON_TENDER_WORDS.has(token.toLowerCase())).length;
  const commonWordRatio = commonWordHits / Math.max(1, wordTokens.length);
  const brokenSpacing = countMatches(raw, /(?:[A-Za-z]\s){5,}[A-Za-z]/g);
  const brokenSpacingRatio = brokenSpacing / Math.max(1, raw.split(/\n+/).length);
  const sentenceLike = countMatches(normalized, /[A-Z][a-z]{2,}[^.!?]{15,}[.!?]/g);
  const normalWords = wordTokens.filter((token) => token.length >= 4).length;
  const arrowOrBoxNoise = countMatches(normalized, /(?:[→←↔↕■□�⬛⬜◆◇●○▲▼▶◀]\s*){4,}/g);

  if (replacementCount >= 8 || symbolRatio > 0.08) signals.push("excessive replacement symbols or black squares");
  if (repeatedGlyphRuns >= 3) signals.push("excessive repeated glyph runs");
  if (isolatedLetterRatio > 0.35 && isolatedLetters >= 30) signals.push("too many isolated single letters");
  if (brokenSpacingRatio > 0.18 || brokenSpacing >= 8) signals.push("abnormal broken character spacing");
  if (arrowOrBoxNoise >= 2) signals.push("too many non-word symbols/arrows");
  if (wordTokens.length >= 80 && commonWordRatio < 0.015) signals.push("low common tender-word ratio");
  if (length > 1500 && sentenceLike < 2 && normalWords < 40) signals.push("text lacks normal sentence/word patterns");

  return {
    corrupted: signals.length >= 2 || replacementCount >= 20 || symbolRatio > 0.12 || (length > 1500 && isolatedLetterRatio > 0.45),
    signals,
    symbolRatio,
    isolatedLetterRatio,
    commonWordRatio,
    brokenSpacingRatio,
  };
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
  const corruption = isExtractionCorrupted(raw);
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
  if (corruption.corrupted) {
    warnings.push(`Extraction corrupted / OCR required: ${corruption.signals.join("; ")}.`);
    recommendations.push("Run OCR or upload a cleaner PDF before AI Analyze, Build Plan, or Generate Docs.");
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
  if (corruption.corrupted) score -= 75;
  if (corruption.signals.length > 0 && !corruption.corrupted) score -= Math.min(35, corruption.signals.length * 10);
  if (characterCount < 1000) score -= 10;
  // A completely empty extraction must score below the WARNING threshold (45).
  // Without this, 0 chars → scannedPdfLikely(−45) + charCount<1000(−10) = 45
  // exactly, which misclassifies as WARNING instead of POOR.
  if (characterCount === 0) score -= 6;
  score = Math.max(0, Math.min(100, score));

  const severity: ExtractionQualitySeverity = hasExtractionFailure || corruption.corrupted
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
    corrupted: corruption.corrupted,
    corruptionSignals: corruption.signals,
    warnings,
    recommendations,
  };
}

const LOW_DENSITY_THRESHOLD = 150; // chars per page below which we flag as low-density

export function buildReportFromStoredPages(pages: PageQualityEntry[]): PerPageExtractionReport {
  const perfectPages = pages.filter((p) => p.status === "GOOD").map((p) => p.page);
  const lowDensityPages = pages.filter((p) => p.status === "LOW_DENSITY").map((p) => p.page);
  const blankPages = pages.filter((p) => p.status === "BLANK").map((p) => p.page);
  const failedPages = pages.filter((p) => p.status === "FAILED").map((p) => p.page);
  const ocrPages = pages.filter((p) => p.status === "OCR").map((p) => p.page);
  const tableHeavyPages = pages.filter((p) => p.status === "TABLE_HEAVY").map((p) => p.page);
  const submissionInstructionPages = pages.filter((p) => p.hasSubmissionInstructions).map((p) => p.page);
  const evaluationCriteriaPages = pages.filter((p) => p.hasEvaluationCriteria).map((p) => p.page);
  const requiredDocumentPages = pages.filter((p) => p.hasRequiredDocuments).map((p) => p.page);
  const clientDetailPages = pages.filter((p) => p.hasClientDetails).map((p) => p.page);
  const totalDetectedPages = pages.length;
  const coveragePercent = totalDetectedPages > 0 ? Math.round((perfectPages.length / totalDetectedPages) * 100) : 0;
  return { totalDetectedPages, perfectPages, lowDensityPages, blankPages, failedPages, ocrPages, tableHeavyPages, submissionInstructionPages, evaluationCriteriaPages, requiredDocumentPages, clientDetailPages, coveragePercent, pages };
}

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
