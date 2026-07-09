// lib/extraction/tender-source-integrity.ts
//
// Source integrity validation for extracted tender files.
// Checks for corrupt files, encrypted PDFs, empty extractions, and
// ensures file hashes are stable and verifiable.

import { createHash } from "node:crypto";

export type SourceIntegrityResult = {
  fileId: string;
  fileName: string;
  isValid: boolean;
  issues: string[];
  recommendations: string[];
};

/**
 * Validate the integrity of an extracted source file.
 */
export function validateSourceIntegrity(args: {
  fileId: string;
  fileName: string;
  fileType: string;
  sizeBytes: number;
  sha256: string;
  extractedText: string;
  extractionStatus: string;
  pageCount: number | null;
}): SourceIntegrityResult {
  const { fileId, fileName, fileType, sizeBytes, sha256, extractedText, extractionStatus, pageCount } = args;
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check file size
  if (sizeBytes === 0) {
    issues.push("File is zero bytes (empty upload)");
    recommendations.push("Re-upload the file — it appears to be empty.");
  }

  // Check hash
  if (!sha256 || sha256.length !== 64) {
    issues.push("File hash is missing or invalid");
    recommendations.push("Re-upload the file to compute a valid content hash.");
  }

  // Check extraction status
  if (extractionStatus === "corrupt") {
    issues.push("File is corrupt and could not be extracted");
    recommendations.push("Re-upload a valid file.");
  } else if (extractionStatus === "encrypted") {
    issues.push("File is encrypted/password-protected");
    recommendations.push("Provide the password or upload an unencrypted version.");
  } else if (extractionStatus === "ocr_required") {
    issues.push("File requires OCR — no text was extracted");
    recommendations.push("Enable OCR or upload a text-based version.");
  } else if (extractionStatus === "ocr_unavailable") {
    issues.push("File requires OCR but OCR is not configured");
    recommendations.push("Configure OCR or upload a text-based version.");
  } else if (extractionStatus === "unsupported") {
    issues.push(`Unsupported file type: ${fileType}`);
    recommendations.push("Convert to PDF, DOCX, XLSX, CSV, or TXT.");
  } else if (extractionStatus === "failed") {
    issues.push("Extraction failed for unknown reason");
    recommendations.push("Re-upload the file or try a different format.");
  }

  // Check extracted text
  if (extractionStatus === "extracted" || extractionStatus === "partial") {
    if (!extractedText || extractedText.trim().length === 0) {
      issues.push("Extraction status says 'extracted' but text is empty");
      recommendations.push("Re-run extraction or re-upload the file.");
    }
  }

  // Check page count
  if (fileType === "PDF" && pageCount !== null && pageCount === 0) {
    issues.push("PDF has 0 pages — file may be corrupt");
    recommendations.push("Re-upload a valid PDF.");
  }

  return {
    fileId,
    fileName,
    isValid: issues.length === 0,
    issues,
    recommendations,
  };
}

/**
 * Compute SHA-256 hash for file content.
 */
export function computeSha256(content: string | Buffer): string {
  const data = typeof content === "string" ? Buffer.from(content, "base64") : content;
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Check if a file hash matches the stored hash.
 */
export function verifyFileHash(content: string | Buffer, expectedHash: string): boolean {
  const actualHash = computeSha256(content);
  return actualHash === expectedHash;
}

/**
 * Safe preview of extracted text for diagnostics (truncated, no full text).
 */
export function safeTextPreview(text: string, maxChars = 200): string {
  if (!text || !text.trim()) return "(empty)";
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars - 3) + "...";
}
