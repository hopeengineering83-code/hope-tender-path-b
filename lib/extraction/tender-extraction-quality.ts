// lib/extraction/tender-extraction-quality.ts
//
// Extraction quality scoring. Returns explicit, recoverable status
// (good / partial / needs_review / blocked) with blockers, warnings,
// and next actions.

export type TenderExtractionQualityResult = {
  tenderId: string;
  totalFiles: number;
  extractedFiles: number;
  failedFiles: number;
  totalPages: number;
  extractedPages: number;
  emptyPages: number;
  scannedPages: number;
  tableCount: number;
  extractedTextLength: number;
  hasSubmissionInstructions: boolean;
  hasEvaluationCriteria: boolean;
  hasRequiredDocuments: boolean;
  hasScopeOfServices: boolean;
  qualityScore: number;
  status: "good" | "partial" | "needs_review" | "blocked";
  blockers: string[];
  warnings: string[];
  nextActions: string[];
};

/**
 * Assess extraction quality from extracted source files.
 *
 * Renamed from `assessExtractionQuality` to `assessTenderExtractionQuality`
 * to disambiguate from the text-level `assessExtractionQuality` in
 * lib/extraction-quality.ts. This variant takes structured per-file args
 * (fileId, fileName, extractionStatus, pages, tables) and returns a
 * TenderExtractionQualityResult with status / blockers / warnings /
 * nextActions. The text-level variant takes (text, fileName?) and returns
 * an ExtractionQualityReport with a quality score.
 *
 * Backward-compat alias `assessExtractionQuality` is preserved below so
 * existing imports continue to work.
 */
export function assessTenderExtractionQuality(args: {
  tenderId: string;
  files: Array<{
    fileId: string;
    fileName: string;
    extractionStatus: string;
    extractedText: string;
    pageCount: number | null;
    pages: Array<{ pageNumber: number; text: string; charCount: number; extractionMethod: string }>;
    tables: Array<{ rowCount: number }>;
  }>;
}): TenderExtractionQualityResult {
  const { tenderId, files } = args;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const nextActions: string[] = [];

  const totalFiles = files.length;
  let extractedFiles = 0;
  let failedFiles = 0;
  let totalPages = 0;
  let extractedPages = 0;
  let emptyPages = 0;
  let scannedPages = 0;
  let tableCount = 0;
  let extractedTextLength = 0;

  for (const file of files) {
    if (file.extractionStatus === "extracted" || file.extractionStatus === "partial") {
      extractedFiles++;
    } else {
      failedFiles++;
    }

    if (file.pageCount) totalPages += file.pageCount;
    extractedPages += file.pages.length;
    emptyPages += file.pages.filter((p) => p.charCount === 0).length;
    scannedPages += file.pages.filter((p) => p.extractionMethod === "ocr" || (p.charCount === 0 && file.extractionStatus === "ocr_required")).length;
    tableCount += file.tables.length;
    extractedTextLength += file.extractedText.length;

    // Check for blockers
    if (file.extractionStatus === "encrypted") {
      blockers.push(`File "${file.fileName}" is encrypted. Provide the password or re-upload an unencrypted version.`);
    }
    if (file.extractionStatus === "corrupt") {
      blockers.push(`File "${file.fileName}" is corrupt. Re-upload a valid file.`);
    }
    if (file.extractionStatus === "ocr_required") {
      blockers.push(`File "${file.fileName}" requires OCR (scanned PDF). Enable OCR or upload a text-based version.`);
    }
    if (file.extractionStatus === "ocr_unavailable") {
      blockers.push(`File "${file.fileName}" requires OCR but OCR is not configured. Enable OCR or upload a text-based version.`);
    }
    if (file.extractionStatus === "unsupported") {
      blockers.push(`File "${file.fileName}" is an unsupported format. Convert to PDF, DOCX, XLSX, CSV, or TXT.`);
    }
    if (file.extractionStatus === "failed") {
      blockers.push(`File "${file.fileName}" extraction failed. Re-upload or try a different format.`);
    }
  }

  // Check content signals in combined text
  const combinedText = files.map((f) => f.extractedText).join("\n\n").toLowerCase();
  const hasSubmissionInstructions = combinedText.includes("submission instructions") || combinedText.includes("instructions to bidders") || combinedText.includes("submission method");
  const hasEvaluationCriteria = combinedText.includes("evaluation criteria") || combinedText.includes("evaluation methodology") || combinedText.includes("technical weight");
  const hasRequiredDocuments = combinedText.includes("required documents") || combinedText.includes("documents to be submitted") || combinedText.includes("required forms");
  const hasScopeOfServices = combinedText.includes("scope of services") || combinedText.includes("scope of work") || combinedText.includes("terms of reference");

  // Warnings for missing content signals
  if (!hasSubmissionInstructions) warnings.push("Submission instructions not detected in extracted text.");
  if (!hasEvaluationCriteria) warnings.push("Evaluation criteria not detected in extracted text.");
  if (!hasRequiredDocuments) warnings.push("Required documents list not detected in extracted text.");
  if (!hasScopeOfServices) warnings.push("Scope of services not detected in extracted text.");

  // Check text length
  if (extractedTextLength < 200 && totalFiles > 0) {
    blockers.push("Total extracted text is too short for analysis. Upload a text-based document or enable OCR.");
  } else if (extractedTextLength < 1000) {
    warnings.push("Extracted text is short — analysis may be incomplete.");
  }

  // Compute quality score
  let score = 100;
  if (failedFiles > 0) score -= 30 * (failedFiles / totalFiles);
  if (emptyPages > 0 && totalPages > 0) score -= 10 * (emptyPages / totalPages);
  if (!hasSubmissionInstructions) score -= 15;
  if (!hasEvaluationCriteria) score -= 10;
  if (!hasRequiredDocuments) score -= 10;
  if (!hasScopeOfServices) score -= 5;
  if (extractedTextLength < 1000) score -= 20;
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Determine status
  let status: TenderExtractionQualityResult["status"] = "good";
  if (blockers.length > 0) {
    status = "blocked";
    nextActions.push("Resolve extraction blockers before proceeding with analysis.");
  } else if (score < 50) {
    status = "needs_review";
    nextActions.push("Review extraction quality and consider re-uploading clearer files.");
  } else if (score < 75 || warnings.length > 2) {
    status = "partial";
    nextActions.push("Extraction is partial — analysis can proceed but may miss some sections.");
  }

  if (warnings.length > 0 && status !== "blocked") {
    nextActions.push("Review extraction warnings for missing content sections.");
  }

  return {
    tenderId,
    totalFiles,
    extractedFiles,
    failedFiles,
    totalPages,
    extractedPages,
    emptyPages,
    scannedPages,
    tableCount,
    extractedTextLength,
    hasSubmissionInstructions,
    hasEvaluationCriteria,
    hasRequiredDocuments,
    hasScopeOfServices,
    qualityScore: score,
    status,
    blockers,
    warnings,
    nextActions,
  };
}
