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

export type PerPageExtractionDetectionMode = "PAGE_MARKERS" | "DOCUMENT_LEVEL" | "STORED_PAGE_STATUS" | "EMPTY";

export type PerPageExtractionReport = {
  totalDetectedPages: number;
  perfectPages: number[];
  lowDensityPages: number[];
  blankPages: number[];
  failedPages: number[];
  ocrPages: number[];
  tableHeavyPages: number[];
  imageHeavyPages: number[];
  submissionInstructionPages: number[];
  evaluationCriteriaPages: number[];
  requiredDocumentPages: number[];
  clientDetailPages: number[];
  coveragePercent: number;
  pages: PageQualityEntry[];
  detectionMode: PerPageExtractionDetectionMode;
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

const SUBMISSION_SECTION_PATTERN = /submission\s+instructions?|submission\s+method|submission\s+emails?|submission\s+deadline|required\s+email\s+subject|submit(?:ted)?\s+(?:by|via)\s+email|email\s+submission|deadline|delivery\s+rules?|portal|sealed\s+envelope|deliver(?:y)?|hand\s+deliver|drop\s+box/i;
const EVALUATION_SECTION_PATTERN = /evaluation\s+criteria|evaluation\s+methodology|scoring\s+criteria|technical\s+score|financial\s+score|weight(?:ed|s)?|points?|compliance\s+with\s+submission\s+requirements/i;
const REQUIRED_DOCUMENT_SECTION_PATTERN = /required\s+documents?|mandatory\s+documents?|documents?\s+required|required\s+deliverables?|required\s+technical\s+proposal\s+sections?|company\s+profile|relevant\s+experience|technical\s+approach|annex(?:es)?|supporting\s+documents?|checklist|annexure|annex\s+\d|form\s+\d|appendix/i;
const CLIENT_DETAIL_SECTION_PATTERN = /client\s+details?|tender\s+metadata|client\s*\/\s*procuring\s+entity|issuing\s+entity\s*\/\s*client|procuring\s+entity|client\s+name|country\s*:|city\s*\/\s*location|contact\s+email|submission\s+email|telephone|email\s*[:\w\s.-]*@|address\s*:|po\s+box/i;

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
  // Lowered from 250 to 50 — the 20-250 char range was a dead zone where
  // 100-char garbage extractions scored 90 (just -10 for characterCount < 1000)
  // and passed all gates. Now the corruption detector runs on any text >= 50
  // chars, catching garbage that would otherwise reach AI Analyze.
  if (length < 50) return { corrupted: false, signals, symbolRatio: 0, isolatedLetterRatio: 0, commonWordRatio: 0, brokenSpacingRatio: 0 };

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
    recommendations.push("Upload a cleaner, text-based PDF. Extraction and analysis re-run automatically before Build Plan and document generation.");
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
// A table-heavy page that still contains enough text is considered perfectly
// extracted — only low-density table pages are flagged as TABLE_HEAVY.
const TABLE_GOOD_THRESHOLD = 300; // chars above which a TABLE_HEAVY page counts as GOOD

// Lines that are pure header / footer / page-number / separator noise — not real
// tender content. CLAUDE.md's "perfectly extracted page" definition requires
// that the text is NOT only headers/footers/noise, so a page whose MEANINGFUL
// content (after stripping these) is below the density threshold must not count
// as perfectly extracted, even if its raw character count clears the threshold.
// NOTE: the footer/copyright patterns are bounded to SHORT lines (a footer
// phrase plus a little surrounding text). A long content line that merely
// begins with "Confidential …" or "Copyright assignment shall …" is real
// content and must NOT be stripped, so we cap the trailing length instead of
// using a greedy `.*$`.
const NOISE_LINE_PATTERNS: RegExp[] = [
  /^\s*page\s+\d+(?:\s+of\s+\d+)?\s*$/i,        // "Page 3 of 40"
  /^\s*[-–—]?\s*\d{1,4}\s*[-–—]?\s*$/,          // standalone page numbers / "- 5 -"
  /^\s*\d+\s*\/\s*\d+\s*$/,                      // "1 / 10"
  /^\s*(?:confidential|proprietary)\b.{0,30}$/i,                 // short "Confidential" footer
  /^\s*(?:copyright|©|\(c\))\b.{0,40}$/i,                        // short copyright footer
  /^\s*all\s+rights\s+reserved\b.{0,20}$/i,                      // "All rights reserved." footer
  /^\s*©.{0,60}$/,                               // © copyright line (bounded)
  /^\s*[_=*•\-–—]{3,}\s*$/,                // separator rules
];

/**
 * Character count of a page's MEANINGFUL content — its text with pure
 * header/footer/page-number/separator lines removed. Used to implement the
 * "not only headers/footers/noise" criterion for a perfectly-extracted page.
 */
export function meaningfulPageCharCount(pageText: string): number {
  const kept = pageText
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      return !NOISE_LINE_PATTERNS.some((rx) => rx.test(t));
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return kept.length;
}

function classifyPageText(pageText: string): Omit<PageQualityEntry, "page"> {
  const charCount = pageText.replace(/\s+/g, " ").length;
  const isFailure = /\[Extraction failed/i.test(pageText);
  const isOcr = /ocrReason=|OCR skipped|\[Image:/i.test(pageText);
  const isBlank = charCount < 30;
  const isTableHeavy = /\|[\s\S]{0,200}\||\t|\bboq\b|bill of quantities|evaluation.{0,30}criteria|scoring.{0,30}matrix/i.test(pageText);
  const isImageHeavy = /\[Image:/i.test(pageText);
  // Density is measured on MEANINGFUL content (CLAUDE.md criterion: a perfectly
  // extracted page is not only headers/footers/noise). A page whose raw count
  // clears the threshold but whose meaningful content does not is low-density.
  const meaningfulCount = meaningfulPageCharCount(pageText);
  const isLowDensity = !isBlank && !isFailure && meaningfulCount < LOW_DENSITY_THRESHOLD;

  const hasSubmission = SUBMISSION_SECTION_PATTERN.test(pageText);
  const hasEvaluation = EVALUATION_SECTION_PATTERN.test(pageText);
  const hasReqdDocs = REQUIRED_DOCUMENT_SECTION_PATTERN.test(pageText);
  const hasClient = CLIENT_DETAIL_SECTION_PATTERN.test(pageText);

  let status: PageQualityStatus;
  if (isFailure) status = "FAILED";
  else if (isOcr) status = "OCR";
  else if (isBlank) status = "BLANK";
  else if (isImageHeavy) status = "IMAGE_HEAVY";
  else if (isTableHeavy && charCount < TABLE_GOOD_THRESHOLD) status = "TABLE_HEAVY";
  else if (isLowDensity) status = "LOW_DENSITY";
  else status = "GOOD";

  return {
    charCount,
    status,
    hasSubmissionInstructions: hasSubmission,
    hasEvaluationCriteria: hasEvaluation,
    hasRequiredDocuments: hasReqdDocs,
    hasClientDetails: hasClient,
  };
}

function reportFromPages(pages: PageQualityEntry[], detectionMode: PerPageExtractionDetectionMode): PerPageExtractionReport {
  const perfectPages = pages.filter((p) => p.status === "GOOD").map((p) => p.page);
  const lowDensityPages = pages.filter((p) => p.status === "LOW_DENSITY").map((p) => p.page);
  const blankPages = pages.filter((p) => p.status === "BLANK").map((p) => p.page);
  const failedPages = pages.filter((p) => p.status === "FAILED").map((p) => p.page);
  const ocrPages = pages.filter((p) => p.status === "OCR").map((p) => p.page);
  const tableHeavyPages = pages.filter((p) => p.status === "TABLE_HEAVY").map((p) => p.page);
  const imageHeavyPages = pages.filter((p) => p.status === "IMAGE_HEAVY").map((p) => p.page);
  const submissionInstructionPages = pages.filter((p) => p.hasSubmissionInstructions).map((p) => p.page);
  const evaluationCriteriaPages = pages.filter((p) => p.hasEvaluationCriteria).map((p) => p.page);
  const requiredDocumentPages = pages.filter((p) => p.hasRequiredDocuments).map((p) => p.page);
  const clientDetailPages = pages.filter((p) => p.hasClientDetails).map((p) => p.page);
  const totalDetectedPages = pages.length;
  const coveragePercent = totalDetectedPages > 0 ? Math.round((perfectPages.length / totalDetectedPages) * 100) : 0;
  return { totalDetectedPages, perfectPages, lowDensityPages, blankPages, failedPages, ocrPages, tableHeavyPages, imageHeavyPages, submissionInstructionPages, evaluationCriteriaPages, requiredDocumentPages, clientDetailPages, coveragePercent, pages, detectionMode };
}

export function buildReportFromStoredPages(pages: PageQualityEntry[]): PerPageExtractionReport {
  return reportFromPages(pages, pages.length > 0 ? "STORED_PAGE_STATUS" : "EMPTY");
}

export function assessExtractionQualityPerPage(text: string | null | undefined): PerPageExtractionReport {
  const raw = text ?? "";
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return reportFromPages([], "EMPTY");

  const markerRegex = /\[Page\s+\d+\]/i;
  const segments = raw.split(/(?=\[Page\s+\d+\])/i);
  const pages: PageQualityEntry[] = [];

  for (const segment of segments) {
    const markerMatch = segment.match(/\[Page\s+(\d+)\]/i);
    if (!markerMatch) continue;
    const pageNum = parseInt(markerMatch[1], 10);
    const pageText = segment.replace(/\[Page\s+\d+\]/i, "").trim();
    pages.push({ page: pageNum, ...classifyPageText(pageText) });
  }

  if (pages.length > 0) return reportFromPages(pages, "PAGE_MARKERS");

  // DOCX and some text extractions do not have physical page markers. Do not
  // report false zeros for Submission/Evaluation/Required Docs/Client Details;
  // scan the full extracted document as one logical segment instead.
  const wholeDocumentPage: PageQualityEntry = { page: 1, ...classifyPageText(raw) };
  return reportFromPages([wholeDocumentPage], markerRegex.test(raw) ? "PAGE_MARKERS" : "DOCUMENT_LEVEL");
}

export type ExtractionConsistencyStatus =
  | "CONSISTENT"
  | "PAGE_STATUS_INCOMPLETE"
  | "PAGE_COUNT_MISMATCH"
  | "EXTRACTION_STALE"
  | "REEXTRACTION_REQUIRED";

export interface ExtractionSnapshot {
  fileId: string;
  sourcePageCount: number;
  storedPageStatusCount: number;
  extractedPages: number;
  ocrPages: number;
  weakPages: number;
  blankPages: number;
  failedPages: number;
  extractionScore: number;
  extractionMethod: string;
  contentHash: string | null;
  extractionRunAt: Date | null;
  consistencyStatus: ExtractionConsistencyStatus;
}

export function computeExtractionSnapshot(file: any): ExtractionSnapshot {
  const pageStatus = JSON.parse(file.pageStatusJson || "[]");
  const storedPageStatusCount = pageStatus.length;
  const sourcePageCount = file.totalPages || 0;

  const snapshot: ExtractionSnapshot = {
    fileId: file.id,
    sourcePageCount,
    storedPageStatusCount,
    extractedPages: file.extractedPages || 0,
    ocrPages: file.ocrPages || 0,
    weakPages: pageStatus.filter((p: any) => p.status === "LOW_DENSITY" || p.status === "TABLE_HEAVY").length,
    blankPages: pageStatus.filter((p: any) => p.status === "BLANK").length,
    failedPages: file.failedPages || 0,
    extractionScore: file.extractionScore || 0,
    extractionMethod: file.extractionMethod || "UNKNOWN",
    contentHash: file.contentHash || null,
    extractionRunAt: file.updatedAt || null,
    consistencyStatus: "CONSISTENT",
  };

  if (storedPageStatusCount === 0 && sourcePageCount > 0) {
    snapshot.consistencyStatus = "PAGE_STATUS_INCOMPLETE";
  } else if (sourcePageCount > 0 && storedPageStatusCount !== sourcePageCount) {
    snapshot.consistencyStatus = "PAGE_COUNT_MISMATCH";
  } else if (!file.extractedText || file.extractedText.length < 50) {
    snapshot.consistencyStatus = "REEXTRACTION_REQUIRED";
  }

  return snapshot;
}
