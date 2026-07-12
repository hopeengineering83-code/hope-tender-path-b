import { createHash, timingSafeEqual } from "node:crypto";

export type ByteIntegrityStatus =
  | "UNKNOWN"
  | "VERIFIED"
  | "MISMATCH"
  | "MISSING"
  | "UNSUPPORTED";

export type PersistedByteIntegrity = {
  contentSha256: string | null;
  contentByteLength: number | null;
  contentMimeType: string | null;
  detectedFormat: string | null;
  integrityStatus: ByteIntegrityStatus;
  integrityVerifiedAt: Date | null;
  integrityFailureCode: string | null;
};

export type PersistedByteIntegrityRecord = {
  contentSha256?: string | null;
  contentByteLength?: number | null;
  contentMimeType?: string | null;
  detectedFormat?: string | null;
  integrityStatus?: string | null;
};

const FORMAT_MIME: Record<string, string> = {
  PDF: "application/pdf",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ZIP: "application/zip",
  PNG: "image/png",
  JPEG: "image/jpeg",
  CSV: "text/csv",
  TEXT: "text/plain",
  JSON: "application/json",
  MARKDOWN: "text/markdown",
};

function expectedFormat(filename: string): string | null {
  const lower = filename.trim().toLowerCase();
  if (lower.endsWith(".pdf")) return "PDF";
  if (lower.endsWith(".docx")) return "DOCX";
  if (lower.endsWith(".xlsx")) return "XLSX";
  // Legacy Office extensions: tender plans regularly require ".doc"/".xls"
  // names, but genuine legacy binaries are banned at upload and the app only
  // ever produces/attaches modern OOXML bytes under those names
  // (formatForName maps them to DOCX/XLSX). Expect the modern container.
  if (lower.endsWith(".doc")) return "DOCX";
  if (lower.endsWith(".xls")) return "XLSX";
  if (lower.endsWith(".zip")) return "ZIP";
  if (lower.endsWith(".png")) return "PNG";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "JPEG";
  if (lower.endsWith(".csv")) return "CSV";
  if (lower.endsWith(".txt")) return "TEXT";
  if (lower.endsWith(".json")) return "JSON";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "MARKDOWN";
  return null;
}

function hasFileExtension(filename: string): boolean {
  return /\.[a-z0-9]{2,8}$/i.test(filename.trim());
}

// Legacy MIME aliases a caller may legitimately claim for a detected format.
const CLAIMED_MIME_ALIASES: Record<string, string[]> = {
  DOCX: ["application/msword"],
  XLSX: ["application/vnd.ms-excel"],
};

function formatFromMime(mime: string | null | undefined): string | null {
  const cleaned = mime?.trim().toLowerCase();
  if (!cleaned || cleaned === "application/octet-stream") return null;
  for (const [format, formatMime] of Object.entries(FORMAT_MIME)) {
    if (formatMime === cleaned) return format;
  }
  for (const [format, aliases] of Object.entries(CLAIMED_MIME_ALIASES)) {
    if (aliases.includes(cleaned)) return format;
  }
  return null;
}

function looksLikeText(bytes: Buffer): boolean {
  if (bytes.length === 0 || bytes.includes(0)) return false;
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let printable = 0;
  for (const value of sample) {
    if (value === 9 || value === 10 || value === 13 || (value >= 32 && value <= 126) || value >= 0xc2) {
      printable += 1;
    }
  }
  return printable / sample.length >= 0.9;
}

export function detectActualByteFormat(bytes: Buffer, filename: string, expectedHint?: string | null): string | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "PDF";
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const expected = expectedHint ?? expectedFormat(filename);
    return expected === "DOCX" || expected === "XLSX" ? expected : "ZIP";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "PNG";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "JPEG";
  if (looksLikeText(bytes)) {
    const expected = expectedHint ?? expectedFormat(filename);
    if (expected === "CSV" || expected === "JSON" || expected === "TEXT" || expected === "MARKDOWN") return expected;
    return "TEXT";
  }
  return null;
}

export function computeByteSha256(bytes: Buffer | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeDigestEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function inspectActualFileBytes(input: {
  bytes: Buffer | Uint8Array;
  filename: string;
  claimedMimeType?: string | null;
  verifiedAt?: Date;
}): PersistedByteIntegrity {
  const bytes = Buffer.from(input.bytes);
  const verifiedAt = input.verifiedAt ?? new Date();
  if (bytes.length === 0) {
    return {
      contentSha256: null,
      contentByteLength: 0,
      contentMimeType: input.claimedMimeType?.trim() || null,
      detectedFormat: null,
      integrityStatus: "MISSING",
      integrityVerifiedAt: verifiedAt,
      integrityFailureCode: "EMPTY_FILE_BYTES",
    };
  }

  // Tender-required filenames legitimately come without an extension. With no
  // extension there is no label for the bytes to contradict, so fall back to
  // the claimed MIME type to establish the expected format. A filename WITH an
  // unrecognized extension stays UNSUPPORTED — that label cannot be checked.
  const extensionExpected = expectedFormat(input.filename);
  const expected = extensionExpected ?? (hasFileExtension(input.filename) ? null : formatFromMime(input.claimedMimeType));
  const detected = detectActualByteFormat(bytes, input.filename, expected);
  if (!expected || !detected) {
    return {
      contentSha256: computeByteSha256(bytes),
      contentByteLength: bytes.length,
      contentMimeType: input.claimedMimeType?.trim() || null,
      detectedFormat: detected,
      integrityStatus: "UNSUPPORTED",
      integrityVerifiedAt: verifiedAt,
      integrityFailureCode: !expected ? "UNSUPPORTED_FILE_EXTENSION" : "UNRECOGNIZED_BYTE_SIGNATURE",
    };
  }
  if (detected !== expected) {
    return {
      contentSha256: computeByteSha256(bytes),
      contentByteLength: bytes.length,
      contentMimeType: input.claimedMimeType?.trim() || null,
      detectedFormat: detected,
      integrityStatus: "MISMATCH",
      integrityVerifiedAt: verifiedAt,
      integrityFailureCode: "FILE_SIGNATURE_MISMATCH",
    };
  }

  const detectedMime = FORMAT_MIME[detected] ?? "application/octet-stream";
  const claimedMime = input.claimedMimeType?.trim().toLowerCase() || null;
  const claimedMimeAcceptable = claimedMime === detectedMime || (CLAIMED_MIME_ALIASES[detected] ?? []).includes(claimedMime ?? "");
  if (claimedMime && claimedMime !== "application/octet-stream" && !claimedMimeAcceptable) {
    return {
      contentSha256: computeByteSha256(bytes),
      contentByteLength: bytes.length,
      contentMimeType: detectedMime,
      detectedFormat: detected,
      integrityStatus: "MISMATCH",
      integrityVerifiedAt: verifiedAt,
      integrityFailureCode: "FILE_MIME_MISMATCH",
    };
  }

  return {
    contentSha256: computeByteSha256(bytes),
    contentByteLength: bytes.length,
    contentMimeType: detectedMime,
    detectedFormat: detected,
    integrityStatus: "VERIFIED",
    integrityVerifiedAt: verifiedAt,
    integrityFailureCode: null,
  };
}

export function verifyPersistedFileBytes(input: {
  bytes: Buffer | Uint8Array;
  filename: string;
  claimedMimeType?: string | null;
  persisted: PersistedByteIntegrityRecord;
  verifiedAt?: Date;
}): PersistedByteIntegrity {
  const fresh = inspectActualFileBytes(input);
  if (fresh.integrityStatus !== "VERIFIED") return fresh;

  if (input.persisted.integrityStatus !== "VERIFIED") {
    return {
      ...fresh,
      integrityStatus: "UNKNOWN",
      integrityFailureCode: "LEGACY_INTEGRITY_UNKNOWN",
    };
  }

  const storedHash = input.persisted.contentSha256 ?? "";
  const matches =
    safeDigestEqual(storedHash, fresh.contentSha256 ?? "") &&
    input.persisted.contentByteLength === fresh.contentByteLength &&
    input.persisted.contentMimeType === fresh.contentMimeType &&
    input.persisted.detectedFormat === fresh.detectedFormat;

  return matches
    ? fresh
    : {
        ...fresh,
        integrityStatus: "MISMATCH",
        integrityFailureCode: "PERSISTED_BYTE_INTEGRITY_MISMATCH",
      };
}

export function requireVerifiedPersistedFileBytes(input: Parameters<typeof verifyPersistedFileBytes>[0]): PersistedByteIntegrity {
  const result = verifyPersistedFileBytes(input);
  if (result.integrityStatus !== "VERIFIED") {
    throw new Error(result.integrityFailureCode ?? "FILE_INTEGRITY_NOT_VERIFIED");
  }
  return result;
}

export function verifiedIntegrityDataFromBase64(input: {
  fileContent: string;
  filename: string;
  claimedMimeType?: string | null;
}): PersistedByteIntegrity {
  const normalized = input.fileContent.replace(/\s+/g, "");
  if (
    !normalized ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)
  ) {
    throw new Error("INVALID_BASE64_FILE_CONTENT");
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.toString("base64") !== normalized) {
    throw new Error("INVALID_BASE64_FILE_CONTENT");
  }
  const result = inspectActualFileBytes({
    bytes,
    filename: input.filename,
    claimedMimeType: input.claimedMimeType,
  });
  if (result.integrityStatus !== "VERIFIED") {
    throw new Error(result.integrityFailureCode ?? "FILE_INTEGRITY_NOT_VERIFIED");
  }
  return result;
}
