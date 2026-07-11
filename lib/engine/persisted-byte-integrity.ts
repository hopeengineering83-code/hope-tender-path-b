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
};

function expectedFormat(filename: string): string | null {
  const lower = filename.trim().toLowerCase();
  if (lower.endsWith(".pdf")) return "PDF";
  if (lower.endsWith(".docx")) return "DOCX";
  if (lower.endsWith(".xlsx")) return "XLSX";
  if (lower.endsWith(".zip")) return "ZIP";
  if (lower.endsWith(".png")) return "PNG";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "JPEG";
  if (lower.endsWith(".csv")) return "CSV";
  if (lower.endsWith(".txt")) return "TEXT";
  if (lower.endsWith(".json")) return "JSON";
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

export function detectActualByteFormat(bytes: Buffer, filename: string): string | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "PDF";
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const expected = expectedFormat(filename);
    return expected === "DOCX" || expected === "XLSX" ? expected : "ZIP";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "PNG";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "JPEG";
  if (looksLikeText(bytes)) {
    const expected = expectedFormat(filename);
    if (expected === "CSV" || expected === "JSON" || expected === "TEXT") return expected;
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

  const expected = expectedFormat(input.filename);
  const detected = detectActualByteFormat(bytes, input.filename);
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
  const claimedMime = input.claimedMimeType?.trim() || null;
  if (claimedMime && claimedMime !== "application/octet-stream" && claimedMime !== detectedMime) {
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
