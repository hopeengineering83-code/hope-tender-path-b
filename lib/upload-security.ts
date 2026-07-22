import path from "path";
import JSZip from "jszip";
import { MAX_EXTRACTED_TEXT_CHARS as INNER_EXTRACTION_CHAR_LIMIT } from "./extract-text";

export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_FILES = 10;
export const MAX_UPLOAD_TOTAL_BYTES = 30 * 1024 * 1024;
// NOTE: This 2M constant is the outer limiter for limitExtractedText(). The
// inner limiter in lib/extract-text.ts (MAX_EXTRACTED_TEXT_CHARS = 2_000_000)
// fires FIRST during normalizeExtractedText() — so by the time text reaches
// limitExtractedText(), it's already <= 2M chars and this 2M slice is a
// no-op safety guard. limitExtractedText therefore ALSO detects the inner
// cap: output text at exactly the inner limit means normalizeExtractedText
// cut the document's tail, and the truncated flag must be true so the upload
// paths can warn that the extraction is partial. A genuine document landing
// on exactly 2,000,000 chars is treated as truncated too — fail-closed.
export const MAX_EXTRACTED_TEXT_CHARS = 2_000_000;
const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_ARCHIVE_EXPANDED_BYTES = 80 * 1024 * 1024;

const extensionToMime: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/octet-stream"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip", "application/octet-stream"],
  ".csv": ["text/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream"],
  ".txt": ["text/plain", "application/octet-stream"],
};

function startsWith(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) return false;
  return signature.every((value, index) => buffer[index] === value);
}

function safeName(name: string): string {
  const base = path.basename(name).replace(/[\u0000-\u001f\u007f]/g, "_");
  return base.replace(/[^a-zA-Z0-9._()\- ]/g, "_").slice(0, 180) || "upload";
}

function unsafeOfficeEntry(name: string): boolean {
  return /^(word|xl)\/(vbaProject\.bin|activeX\/|embeddings\/|externalLinks\/)|^customUI\//i.test(name);
}

async function validateOpenXml(buffer: Buffer, extension: ".docx" | ".xlsx"): Promise<string | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false });
  } catch {
    return "The Office archive is corrupt or malformed";
  }

  const entries = Object.values(zip.files);
  if (entries.length > MAX_ARCHIVE_ENTRIES) return "The Office archive contains too many entries";
  let expandedBytes = 0;
  for (const entry of entries) {
    if (entry.name.startsWith("/") || entry.name.includes("../") || entry.name.includes("..\\")) {
      return "The Office archive contains an unsafe path";
    }
    if (unsafeOfficeEntry(entry.name)) {
      return "Macro, ActiveX, embedded-object, custom-UI, and external-link content is not permitted";
    }
    if (entry.dir) continue;
    const data = await entry.async("uint8array");
    expandedBytes += data.byteLength;
    if (expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) return "The Office archive expands beyond the permitted limit";
  }

  const expected = extension === ".docx" ? "word/document.xml" : "xl/workbook.xml";
  if (!zip.file("[Content_Types].xml") || !zip.file(expected)) {
    return `The archive is not a valid ${extension.slice(1).toUpperCase()} document`;
  }
  return null;
}

function looksLikeActiveText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 65_536)).toString("utf8").toLowerCase();
  return /<\s*(script|html|svg|iframe|object|embed)\b|javascript\s*:|vbscript\s*:/.test(sample);
}

export type UploadValidation = {
  ok: boolean;
  safeFileName: string;
  normalizedMime: string;
  error?: string;
};

export async function validateUploadFile(file: File, buffer: Buffer): Promise<UploadValidation> {
  const safeFileName = safeName(file.name);
  const extension = path.extname(safeFileName).toLowerCase();

  if (extension === ".doc" || extension === ".xls") {
    return {
      ok: false,
      safeFileName,
      normalizedMime: "application/octet-stream",
      error: "Legacy DOC/XLS files cannot be safely inspected. Convert them to DOCX/XLSX before uploading",
    };
  }

  const allowedMimes = extensionToMime[extension];
  if (!allowedMimes) return { ok: false, safeFileName, normalizedMime: "application/octet-stream", error: "Unsupported file extension" };
  if (buffer.byteLength === 0) return { ok: false, safeFileName, normalizedMime: "application/octet-stream", error: "Empty file" };
  if (buffer.byteLength > MAX_UPLOAD_FILE_BYTES) return { ok: false, safeFileName, normalizedMime: "application/octet-stream", error: "File exceeds the 10 MB limit" };

  const suppliedMime = (file.type || "application/octet-stream").toLowerCase();
  if (!allowedMimes.includes(suppliedMime)) {
    return { ok: false, safeFileName, normalizedMime: suppliedMime, error: "File extension and MIME type do not match" };
  }

  if (extension === ".pdf" && !startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { ok: false, safeFileName, normalizedMime: suppliedMime, error: "Invalid PDF signature" };
  }
  if (extension === ".docx" || extension === ".xlsx") {
    if (!startsWith(buffer, [0x50, 0x4b])) return { ok: false, safeFileName, normalizedMime: suppliedMime, error: "Invalid Office archive signature" };
    const archiveError = await validateOpenXml(buffer, extension);
    if (archiveError) return { ok: false, safeFileName, normalizedMime: suppliedMime, error: archiveError };
  }
  if (extension === ".txt" || extension === ".csv") {
    if (buffer.includes(0)) return { ok: false, safeFileName, normalizedMime: suppliedMime, error: "Binary content is not permitted in text uploads" };
    if (looksLikeActiveText(buffer)) return { ok: false, safeFileName, normalizedMime: suppliedMime, error: "Active web content is not permitted" };
  }

  return { ok: true, safeFileName, normalizedMime: extensionToMime[extension][0] };
}

export function validateUploadBatch(files: File[]): string | null {
  if (files.length === 0) return "No files provided";
  if (files.length > MAX_UPLOAD_FILES) return `A maximum of ${MAX_UPLOAD_FILES} files is permitted per request`;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_UPLOAD_TOTAL_BYTES) return "The upload request exceeds the 30 MB aggregate limit";
  return null;
}

export function limitExtractedText(text: string): { text: string; truncated: boolean } {
  // Inner-cap detection: normalizeExtractedText (lib/extract-text.ts) slices
  // to INNER_EXTRACTION_CHAR_LIMIT, so text AT that length was cut there.
  if (text.length >= INNER_EXTRACTION_CHAR_LIMIT && text.length <= MAX_EXTRACTED_TEXT_CHARS) {
    return { text, truncated: true };
  }
  if (text.length <= MAX_EXTRACTED_TEXT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_EXTRACTED_TEXT_CHARS), truncated: true };
}
