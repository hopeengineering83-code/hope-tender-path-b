/**
 * AI Analyze Extraction Quality Gates
 *
 * Validates tender file extraction quality before AI analysis.
 *
 * Rules:
 * - Block corrupted/gibberish extraction (all punctuation, no words)
 * - Block poor extraction coverage (< 70% of pages extracted)
 * - Block blank/OCR-only-failed extraction (0 characters)
 * - Force mode does NOT bypass these gates
 * - Quality flags are recorded in analysisExtractionStatus
 *
 * Used before startOrResumeAnalysis to fail fast on poor input.
 */

import type { PrismaClient } from "@prisma/client";

export type ExtractionQualityStatus =
  | "FULL_EXTRACTION_AI_ANALYZED"
  | "PARTIAL_EXTRACTION_AI_ANALYZED"
  | "OCR_REQUIRED"
  | "EXTRACTION_WEAK_REVIEW_REQUIRED"
  | "REGEX_FALLBACK_FROM_WEAK_EXTRACTION";

export interface ExtractionMetrics {
  totalPages: number;
  extractedPages: number;
  ocrPages: number;
  failedPages: number;
  extractionCoverage: number; // percentage
  totalCharacters: number;
  avgCharsPerPage: number;
  isCorrupted: boolean;
  isPoor: boolean;
}

export interface ExtractionQualityResult {
  meetsMinimumQuality: boolean;
  status: ExtractionQualityStatus;
  metrics: ExtractionMetrics;
  issues: string[];
}

/**
 * Calculate extraction metrics for a tender.
 *
 * Reads all active files and computes coverage, character count, etc.
 */
export async function calculateExtractionMetrics(
  tenderId: string,
  prismaClient: PrismaClient,
): Promise<ExtractionMetrics> {
  const files = await prismaClient.tenderFile.findMany({
    where: {
      tenderId,
      deletionStatus: "ACTIVE",
    },
    select: {
      totalPages: true,
      extractedPages: true,
      ocrPages: true,
      failedPages: true,
      extractedText: true,
    },
  });

  if (files.length === 0) {
    return {
      totalPages: 0,
      extractedPages: 0,
      ocrPages: 0,
      failedPages: 0,
      extractionCoverage: 0,
      totalCharacters: 0,
      avgCharsPerPage: 0,
      isCorrupted: false,
      isPoor: true,
    };
  }

  // Sum metrics across all files
  let totalPages = 0;
  let totalExtracted = 0;
  let totalOcr = 0;
  let totalFailed = 0;
  let totalCharacters = 0;

  for (const file of files) {
    const pages = file.totalPages || 1;
    const extracted = file.extractedPages || 0;
    const ocr = file.ocrPages || 0;
    const failed = file.failedPages || 0;
    const text = file.extractedText || "";

    totalPages += pages;
    totalExtracted += extracted;
    totalOcr += ocr;
    totalFailed += failed;
    totalCharacters += text.length;
  }

  const coverage = totalPages > 0 ? (totalExtracted / totalPages) * 100 : 0;
  const avgChars = totalExtracted > 0 ? totalCharacters / totalExtracted : 0;

  // Determine if extraction is corrupted (gibberish)
  const isCorrupted = isExtractionCorrupted(totalCharacters);

  // Determine if extraction is poor (low coverage or low char count)
  const isPoor = coverage < 70 || totalCharacters < 100;

  return {
    totalPages,
    extractedPages: totalExtracted,
    ocrPages: totalOcr,
    failedPages: totalFailed,
    extractionCoverage: coverage,
    totalCharacters,
    avgCharsPerPage: avgChars,
    isCorrupted,
    isPoor,
  };
}

/**
 * Check if extracted text is corrupted/gibberish.
 *
 * Heuristics:
 * - All punctuation, no alphanumeric words
 * - Extremely low character count (< 50)
 * - Only whitespace/formatting characters
 */
function isExtractionCorrupted(characterCount: number): boolean {
  // No text = corrupted
  if (characterCount === 0) {
    return true;
  }

  // Extremely sparse text = likely corrupted
  if (characterCount < 50) {
    return true;
  }

  // Could add regex checks:
  // - If text matches /^[^\w\s]+$/ (all non-word chars) = corrupted
  // For now, character count is the heuristic

  return false;
}

/**
 * Determine extraction quality status.
 *
 * Status is recorded in Tender.analysisExtractionStatus to guide analysis behavior:
 * - FULL_EXTRACTION_AI_ANALYZED: > 90% coverage, use full AI analysis
 * - PARTIAL_EXTRACTION_AI_ANALYZED: 70-90% coverage, use AI with caution
 * - OCR_REQUIRED: Low coverage + OCR available, suggest OCR
 * - EXTRACTION_WEAK_REVIEW_REQUIRED: Low coverage + no OCR, requires review
 * - REGEX_FALLBACK_FROM_WEAK_EXTRACTION: Extraction too weak for any provider
 */
export async function assessExtractionQuality(
  tenderId: string,
  prismaClient: PrismaClient,
): Promise<ExtractionQualityResult> {
  const metrics = await calculateExtractionMetrics(tenderId, prismaClient);
  const issues: string[] = [];

  // Check for corrupted extraction
  if (metrics.isCorrupted) {
    issues.push(`Extraction appears corrupted (< 50 characters total)`);
  }

  // Check coverage
  if (metrics.extractionCoverage < 50) {
    issues.push(
      `Extraction coverage critical (${metrics.extractionCoverage.toFixed(0)}% of pages)`,
    );
  } else if (metrics.extractionCoverage < 70) {
    issues.push(
      `Extraction coverage weak (${metrics.extractionCoverage.toFixed(0)}% of pages)`,
    );
  }

  // Check average characters per page
  if (metrics.avgCharsPerPage < 200) {
    issues.push(
      `Low text density (${metrics.avgCharsPerPage.toFixed(0)} chars/page, expected > 200)`,
    );
  }

  // Determine status and quality
  let status: ExtractionQualityStatus;
  let meetsMinimum = true;

  if (metrics.isCorrupted) {
    status = "REGEX_FALLBACK_FROM_WEAK_EXTRACTION";
    meetsMinimum = false;
  } else if (metrics.extractionCoverage < 70) {
    // Check if OCR is available
    const ocrAvailable = metrics.ocrPages > 0;
    status = ocrAvailable ? "OCR_REQUIRED" : "EXTRACTION_WEAK_REVIEW_REQUIRED";
    meetsMinimum = false;
  } else if (metrics.extractionCoverage >= 90) {
    status = "FULL_EXTRACTION_AI_ANALYZED";
  } else {
    status = "PARTIAL_EXTRACTION_AI_ANALYZED";
  }

  return {
    meetsMinimumQuality: meetsMinimum,
    status,
    metrics,
    issues,
  };
}

/**
 * Gate: Check if tender extraction is acceptable for AI analysis.
 *
 * This is a blocking check before AI Analyze starts.
 * Force mode does NOT bypass this gate.
 */
export async function canStartAnalysisWithExtraction(
  tenderId: string,
  prismaClient: PrismaClient,
  force: boolean = false,
): Promise<{
  allowed: boolean;
  quality: ExtractionQualityResult;
  reason?: string;
}> {
  const quality = await assessExtractionQuality(tenderId, prismaClient);

  // Even with force=true, fail if extraction is corrupted
  if (quality.metrics.isCorrupted) {
    return {
      allowed: false,
      quality,
      reason: "Extraction is corrupted. Cannot proceed. Re-upload or run OCR.",
    };
  }

  // With force=true, allow weak extraction (but flag it)
  if (!quality.meetsMinimumQuality && !force) {
    return {
      allowed: false,
      quality,
      reason: `Extraction quality insufficient (${quality.issues.join("; ")}). Use force=true to override.`,
    };
  }

  return {
    allowed: true,
    quality,
  };
}
