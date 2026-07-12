/**
 * File Byte Integrity — SHA-256 verification for final-package safety.
 *
 * The canonical persisted trust model is:
 *   contentSha256/contentByteLength/contentMimeType/detectedFormat/
 *   integrityStatus/integrityVerifiedAt.
 *
 * Legacy sha256/byteSize columns may still exist during schema transition. They
 * are treated only as an optional second cross-check. Missing legacy aliases do
 * not block a buffer that has already passed the canonical persisted-integrity
 * verifier; every other missing-digest case remains fail closed.
 */
import { createHash, timingSafeEqual } from "node:crypto";

const CANONICAL_VERIFIED_BUFFER = Symbol.for("hope.canonicalVerifiedFileBuffer");

type CanonicallyVerifiedBuffer = Buffer & {
  [CANONICAL_VERIFIED_BUFFER]?: true;
};

export function markBufferCanonicallyVerified(buffer: Buffer): Buffer {
  Object.defineProperty(buffer, CANONICAL_VERIFIED_BUFFER, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  });
  return buffer;
}

export function isBufferCanonicallyVerified(buffer: Buffer | null | undefined): boolean {
  return Boolean(buffer && (buffer as CanonicallyVerifiedBuffer)[CANONICAL_VERIFIED_BUFFER] === true);
}

export type FileIntegrityBlockerCode =
  | "FILE_DIGEST_MISSING"
  | "FILE_INTEGRITY_HASH_MISMATCH"
  | "FILE_SIZE_MISMATCH"
  | "FILE_BYTES_MISSING"
  | "FILE_STORAGE_READ_FAILED"
  | "FILE_TYPE_MISMATCH"
  | "ZIP_MANIFEST_DIGEST_MISMATCH";

export type FileIntegrityResult =
  | { ok: true; sha256: string; byteSize: number }
  | { ok: false; code: FileIntegrityBlockerCode; detail: string; sha256?: string; byteSize?: number };

export function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Verify actual bytes against the legacy digest aliases when those aliases are
 * present. When they are absent, accept only a Buffer explicitly marked by
 * readGeneratedDocumentContent after the richer canonical persisted-integrity
 * verifier succeeded. This removes the contradictory double-truth blocker
 * without allowing UNKNOWN or unverified bytes into final ZIP.
 */
export function verifyFileBytes(input: {
  storedSha256: string | null | undefined;
  storedByteSize: number | null | undefined;
  buffer: Buffer | null | undefined;
  fileName: string;
}): FileIntegrityResult {
  const { storedSha256, storedByteSize, buffer, fileName } = input;

  if (!buffer || buffer.length === 0) {
    return {
      ok: false,
      code: "FILE_BYTES_MISSING",
      detail: `File bytes are missing or empty for "${fileName}".`,
    };
  }

  const actualSha256 = sha256Buffer(buffer);
  const actualByteSize = buffer.length;

  if (!storedSha256) {
    if (isBufferCanonicallyVerified(buffer)) {
      return { ok: true, sha256: actualSha256, byteSize: actualByteSize };
    }
    return {
      ok: false,
      code: "FILE_DIGEST_MISSING",
      detail: `File digest (SHA-256) is missing for "${fileName}" and canonical persisted integrity was not verified.`,
      sha256: actualSha256,
      byteSize: actualByteSize,
    };
  }

  if (storedByteSize != null && storedByteSize !== actualByteSize) {
    return {
      ok: false,
      code: "FILE_SIZE_MISMATCH",
      detail: `File size mismatch for "${fileName}": expected ${storedByteSize} bytes, got ${actualByteSize}.`,
      sha256: actualSha256,
      byteSize: actualByteSize,
    };
  }

  let storedHashBuffer: Buffer;
  try {
    storedHashBuffer = Buffer.from(storedSha256, "hex");
  } catch {
    return {
      ok: false,
      code: "FILE_INTEGRITY_HASH_MISMATCH",
      detail: `File integrity check failed for "${fileName}": stored SHA-256 is invalid.`,
      sha256: actualSha256,
      byteSize: actualByteSize,
    };
  }
  const actualHashBuffer = Buffer.from(actualSha256, "hex");

  if (
    storedHashBuffer.length !== actualHashBuffer.length
    || !timingSafeEqual(storedHashBuffer, actualHashBuffer)
  ) {
    return {
      ok: false,
      code: "FILE_INTEGRITY_HASH_MISMATCH",
      detail: `File integrity check failed for "${fileName}": SHA-256 hash mismatch.`,
      sha256: actualSha256,
      byteSize: actualByteSize,
    };
  }

  return { ok: true, sha256: actualSha256, byteSize: actualByteSize };
}

export function computeDigestFromBase64(
  base64Content: string | null | undefined,
): { sha256: string; byteSize: number } | null {
  if (!base64Content || base64Content.trim().length === 0) return null;
  try {
    const buffer = Buffer.from(base64Content, "base64");
    if (buffer.length === 0) return null;
    return { sha256: sha256Buffer(buffer), byteSize: buffer.length };
  } catch {
    return null;
  }
}

export function buildManifestEntry(input: {
  fileName: string;
  sha256: string;
  byteSize: number;
  documentType?: string;
  exactOrder?: number;
}): Record<string, unknown> {
  return {
    fileName: input.fileName,
    sha256: input.sha256,
    byteSize: input.byteSize,
    documentType: input.documentType ?? null,
    exactOrder: input.exactOrder ?? null,
    verifiedAt: new Date().toISOString(),
  };
}
