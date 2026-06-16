import path from "path";
import JSZip from "jszip";
import { DB_BASE64_MAX_BYTES } from "./storage";

export const COMPANY_ASSET_TYPES = ["LETTERHEAD", "LOGO", "HEADER", "FOOTER", "SIGNATURE", "STAMP"] as const;
export type CompanyAssetType = (typeof COMPANY_ASSET_TYPES)[number];
export const COMPANY_ASSET_MAX_BYTES = DB_BASE64_MAX_BYTES;

const MAX_DOCX_ENTRIES = 2_000;
const MAX_DOCX_EXPANDED_BYTES = 50 * 1024 * 1024;

export type CompanyAssetInput = {
  assetType: string;
  fileName: string;
  mimeType?: string | null;
  size?: number | null;
};

export type CompanyAssetValidation = {
  ok: boolean;
  safeFileName: string;
  normalizedMime: string;
  error?: string;
};

function startsWith(buffer: Buffer, signature: number[]): boolean {
  return signature.every((value, index) => buffer[index] === value);
}

export function sanitizeCompanyAssetFileName(name: string): string {
  const base = path.basename(String(name || "asset")).replace(/[\u0000-\u001f\u007f]/g, "_");
  return base.replace(/[^a-zA-Z0-9._()\- ]/g, "_").slice(0, 180) || "asset";
}

function normalizedType(value: string): CompanyAssetType | null {
  const type = value.trim().toUpperCase();
  return (COMPANY_ASSET_TYPES as readonly string[]).includes(type) ? type as CompanyAssetType : null;
}

async function validateLetterheadDocx(buffer: Buffer): Promise<string | null> {
  if (!startsWith(buffer, [0x50, 0x4b])) return "The letterhead is not a valid DOCX archive";

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false });
  } catch {
    return "The letterhead DOCX is corrupt or malformed";
  }

  const entries = Object.values(zip.files);
  if (entries.length > MAX_DOCX_ENTRIES) return "The letterhead DOCX contains too many archive entries";

  let expandedBytes = 0;
  for (const entry of entries) {
    if (entry.name.startsWith("/") || entry.name.includes("../") || entry.name.includes("..\\")) {
      return "The letterhead DOCX contains an unsafe archive path";
    }
    if (/^(word\/(vbaProject\.bin|activeX\/|embeddings\/)|customUI\/)/i.test(entry.name)) {
      return "Macro, ActiveX, and embedded-object content is not permitted in letterhead templates";
    }
    if (entry.dir) continue;
    const bytes = await entry.async("uint8array");
    expandedBytes += bytes.byteLength;
    if (expandedBytes > MAX_DOCX_EXPANDED_BYTES) {
      return "The letterhead DOCX expands beyond the permitted limit";
    }
  }

  if (!zip.file("[Content_Types].xml") || !zip.file("word/document.xml")) {
    return "The uploaded archive is not a valid Word DOCX document";
  }
  return null;
}

export async function validateCompanyAsset(
  input: CompanyAssetInput,
  buffer: Buffer,
): Promise<CompanyAssetValidation> {
  const safeFileName = sanitizeCompanyAssetFileName(input.fileName);
  const type = normalizedType(input.assetType);
  if (!type) {
    return { ok: false, safeFileName, normalizedMime: "application/octet-stream", error: "Unsupported company asset type" };
  }

  if (buffer.byteLength === 0) {
    return { ok: false, safeFileName, normalizedMime: "application/octet-stream", error: "Empty files are not permitted" };
  }
  if (buffer.byteLength > COMPANY_ASSET_MAX_BYTES) {
    return {
      ok: false,
      safeFileName,
      normalizedMime: "application/octet-stream",
      error: `Company assets must not exceed ${Math.floor(COMPANY_ASSET_MAX_BYTES / (1024 * 1024))} MB`,
    };
  }

  const extension = path.extname(safeFileName).toLowerCase();
  const suppliedMime = String(input.mimeType || "application/octet-stream").toLowerCase();

  if (type === "LETTERHEAD") {
    if (extension !== ".docx") {
      return { ok: false, safeFileName, normalizedMime: suppliedMime, error: "Letterhead templates must be DOCX files" };
    }
    if (!["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/octet-stream"].includes(suppliedMime)) {
      return { ok: false, safeFileName, normalizedMime: suppliedMime, error: "Letterhead extension and MIME type do not match" };
    }
    const error = await validateLetterheadDocx(buffer);
    if (error) return { ok: false, safeFileName, normalizedMime: suppliedMime, error };
    return {
      ok: true,
      safeFileName,
      normalizedMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }

  if (extension === ".png") {
    if (!startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      return { ok: false, safeFileName, normalizedMime: suppliedMime, error: "Invalid PNG signature" };
    }
    if (!["image/png", "application/octet-stream"].includes(suppliedMime)) {
      return { ok: false, safeFileName, normalizedMime: suppliedMime, error: "PNG extension and MIME type do not match" };
    }
    return { ok: true, safeFileName, normalizedMime: "image/png" };
  }

  if (extension === ".jpg" || extension === ".jpeg") {
    if (!startsWith(buffer, [0xff, 0xd8, 0xff])) {
      return { ok: false, safeFileName, normalizedMime: suppliedMime, error: "Invalid JPEG signature" };
    }
    if (!["image/jpeg", "image/jpg", "application/octet-stream"].includes(suppliedMime)) {
      return { ok: false, safeFileName, normalizedMime: suppliedMime, error: "JPEG extension and MIME type do not match" };
    }
    return { ok: true, safeFileName, normalizedMime: "image/jpeg" };
  }

  return {
    ok: false,
    safeFileName,
    normalizedMime: suppliedMime,
    error: "Logo, header, footer, signature, and stamp assets must be PNG or JPEG images",
  };
}

export function isInlineSafeCompanyAssetMime(mimeType: string): boolean {
  return mimeType === "image/png" || mimeType === "image/jpeg";
}
