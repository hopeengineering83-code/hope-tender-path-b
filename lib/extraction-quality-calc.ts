import type { ExtractionStatus } from "@prisma/client";

export interface ExtractedFile {
  id: string;
  originalFileName: string | null;
  totalPages: number | null;
  extractedPages: number | null;
  ocrPages: number | null;
  failedPages: number | null;
  extractionScore: number | null;
  extractedText: string | null;
}

export interface ExtractionQuality {
  totalPages: number;
  perfectlyExtractedPages: number;
  ocrPages: number;
  failedPages: number;
  blankPages: number;
  coverage: number;
  isPerfect: boolean;
  isAcceptable: boolean;
  isWeak: boolean;
  isFailed: boolean;
  recommendedAction: string;
}

export function calculateExtractionQuality(files: ExtractedFile[]): ExtractionQuality {
  let totalPages = 0;
  let extractedPages = 0;
  let ocrPages = 0;
  let failedPages = 0;
  let blankPages = 0;

  for (const file of files) {
    if (file.totalPages) {
      totalPages += file.totalPages;
    }
    if (file.extractedPages) {
      extractedPages += file.extractedPages;
    }
    if (file.ocrPages) {
      ocrPages += file.ocrPages;
    }
    if (file.failedPages) {
      failedPages += file.failedPages;
    }
    // Estimate blank pages as total - (extracted + ocr + failed)
    if (file.totalPages) {
      const accountedPages = (file.extractedPages || 0) + (file.ocrPages || 0) + (file.failedPages || 0);
      if (accountedPages < file.totalPages) {
        blankPages += file.totalPages - accountedPages;
      }
    }
  }

  const perfectlyExtractedPages = extractedPages - ocrPages;
  const coverage = totalPages > 0 ? (extractedPages / totalPages) * 100 : 0;

  // Quality thresholds
  const isPerfect = coverage >= 90 && failedPages === 0 && blankPages === 0;
  const isAcceptable = coverage >= 70 && failedPages === 0;
  const isWeak = coverage >= 50 || failedPages > 0;
  const isFailed = coverage < 50;

  let recommendedAction = "Continue analysis";
  if (isFailed) {
    recommendedAction = "Upload clearer scan or enable OCR";
  } else if (isWeak) {
    recommendedAction = "Review extraction or enable OCR for weak pages";
  }

  return {
    totalPages,
    perfectlyExtractedPages,
    ocrPages,
    failedPages,
    blankPages,
    coverage: Math.round(coverage),
    isPerfect,
    isAcceptable,
    isWeak,
    isFailed,
    recommendedAction,
  };
}

export function getExtractionStatusMessage(status: ExtractionStatus | null | undefined): string {
  if (!status) return "Unknown status";

  const statusMap: Record<string, string> = {
    FULL_EXTRACTION_AI_ANALYZED: "Fully extracted and analyzed",
    PARTIAL_EXTRACTION_AI_ANALYZED: "Partially extracted and analyzed",
    REGEX_FALLBACK_FROM_WEAK_EXTRACTION: "Analyzed using regex fallback (weak extraction)",
    OCR_REQUIRED: "OCR required for analysis",
    EXTRACTION_WEAK_REVIEW_REQUIRED: "Weak extraction - manual review recommended",
  };

  return statusMap[status] || status;
}
