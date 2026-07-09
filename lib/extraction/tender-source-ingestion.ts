// lib/extraction/tender-source-ingestion.ts
//
// Production-grade tender source-file ingestion.
// Extracts PDF, DOCX, XLSX, CSV, TXT with file identity, page/sheet/row
// references, stable hashes, table text equivalents, and honest extraction
// status (no fabricated OCR text).

import { createHash } from "node:crypto";
import type { ExtractedTenderSourceFile, ExtractedTenderPage, ExtractedTenderTable } from "./tender-text-extractor";

export type IngestionResult = {
  file: ExtractedTenderSourceFile;
  warnings: string[];
  errors: string[];
};

/**
 * Compute SHA-256 hash of file content.
 */
export function computeFileHash(content: string | Buffer): string {
  const data = typeof content === "string" ? Buffer.from(content, "base64") : content;
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Detect file type from MIME type and filename extension.
 */
export function detectFileType(mimeType: string | null, fileName: string): "PDF" | "DOCX" | "XLSX" | "CSV" | "TXT" | "UNKNOWN" {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const mt = (mimeType ?? "").toLowerCase();

  if (mt.includes("pdf") || ext === "pdf") return "PDF";
  if (mt.includes("officedocument.wordprocessingml") || ext === "docx") return "DOCX";
  if (mt.includes("officedocument.spreadsheetml") || ext === "xlsx") return "XLSX";
  if (mt.includes("csv") || ext === "csv") return "CSV";
  if (mt.includes("text/plain") || ext === "txt") return "TXT";
  return "UNKNOWN";
}

/**
 * Validate a file before extraction.
 * Returns an error string if invalid, null if valid.
 */
export function validateFile(args: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  allowedTypes?: string[];
}): string | null {
  const { fileName, mimeType, sizeBytes, allowedTypes } = args;

  if (sizeBytes === 0) return "File is zero bytes (empty upload)";
  if (sizeBytes > 100 * 1024 * 1024) return "File exceeds 100MB limit";

  const fileType = detectFileType(mimeType, fileName);
  if (fileType === "UNKNOWN") {
    return `Unsupported file type: ${mimeType || "unknown"} (${fileName})`;
  }

  if (allowedTypes && !allowedTypes.includes(fileType)) {
    return `File type ${fileType} is not in the allowed list: ${allowedTypes.join(", ")}`;
  }

  // MIME/extension mismatch check
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" && !mimeType.includes("pdf")) return `MIME/extension mismatch: file has .pdf extension but MIME is ${mimeType}`;
  if (ext === "docx" && !mimeType.includes("wordprocessingml") && !mimeType.includes("octet-stream")) return `MIME/extension mismatch: .docx but MIME is ${mimeType}`;
  if (ext === "xlsx" && !mimeType.includes("spreadsheetml") && !mimeType.includes("octet-stream")) return `MIME/extension mismatch: .xlsx but MIME is ${mimeType}`;

  return null;
}

/**
 * Build an ExtractedTenderSourceFile from raw extraction results.
 */
export function buildExtractedSourceFile(args: {
  tenderId: string;
  fileId: string;
  originalFileName: string;
  mimeType: string | null;
  sizeBytes: number;
  sha256: string;
  fileType: "PDF" | "DOCX" | "XLSX" | "CSV" | "TXT" | "UNKNOWN";
  extractionStatus: ExtractedTenderSourceFile["extractionStatus"];
  extractedText: string;
  pages: ExtractedTenderPage[];
  tables: ExtractedTenderTable[];
  pageCount: number | null;
  sheetCount: number | null;
  warnings?: string[];
}): ExtractedTenderSourceFile {
  return {
    tenderId: args.tenderId,
    fileId: args.fileId,
    originalFileName: args.originalFileName,
    fileType: args.fileType,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
    sha256: args.sha256,
    pageCount: args.pageCount,
    sheetCount: args.sheetCount,
    extractionStatus: args.extractionStatus,
    extractedText: args.extractedText,
    pages: args.pages,
    tables: args.tables,
    warnings: args.warnings ?? [],
  };
}
