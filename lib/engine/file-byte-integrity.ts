/**
 * File Byte Integrity — SHA-256 verification for final-package safety.
 *
 * This module provides:
 *   - sha256Buffer(buffer): deterministic SHA-256 hex digest
 *   - verifyFileBytes(...): recompute + compare digest and size
 *   - Structured blocker codes for integrity failures
 *   - Integration helpers for the final ZIP download path
 *
 * Design rules:
 *   - Never trust client-supplied hash — always recompute from actual bytes.
 *   - Legacy rows without digest: draft work may continue, but final
 *     ZIP/download must not silently pass required files with unknown integrity.
 *   - All public errors use safe codes, never raw paths/tokens/stack traces.
 */

import { createHash, timingSafeEqual } from "node:crypto";

// ─── Structured blocker codes ─────────────────────────────────────────────────

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

// ─── SHA-256 helper ───────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hex digest from a Buffer.
 * Always lowercase hex, deterministic, computed from actual bytes only.
 */
export function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// ─── Verification ─────────────────────────────────────────────────────────────

/**
 * Verify that a file's actual bytes match its stored SHA-256 digest and byte size.
 *
 * Returns { ok: true } when the recomputed digest matches the stored digest
 * AND the actual byte size matches the stored byte size.
 *
 * Returns { ok: false, code } with a structured blocker code when:
 *   - FILE_DIGEST_MISSING: the stored sha256 is null (legacy row) — final ZIP must block
 *   - FILE_BYTES_MISSING: the buffer is null/empty — cannot verify
 *   - FILE_INTEGRITY_HASH_MISMATCH: recomputed digest doesn't match stored digest
 *   - FILE_SIZE_MISMATCH: actual byte size doesn't match stored byte size
 *
 * Uses timingSafeEqual for hash comparison to prevent timing attacks.
 */
export function verifyFileBytes(input: {
  storedSha256: string | null | undefined;
  storedByteSize: number | null | undefined;
  buffer: Buffer | null | undefined;
  fileName: string;
}): FileIntegrityResult {
  const { storedSha256, storedByteSize, buffer, fileName } = input;

  // Cannot verify without actual bytes
  if (!buffer || buffer.length === 0) {
    return {
      ok: false,
      code: "FILE_BYTES_MISSING",
      detail: `File bytes are missing or empty for "${fileName}".`,
    };
  }

  // Legacy rows without digest — final ZIP must block (fail-closed)
  if (!storedSha256) {
    return {
      ok: false,
      code: "FILE_DIGEST_MISSING",
      detail: `File digest (SHA-256) is missing for "${fileName}". Run the backfill script before exporting.`,
    };
  }

  // Recompute the digest from actual bytes
  const actualSha256 = sha256Buffer(buffer);
  const actualByteSize = buffer.length;

  // Size check (fast fail before hash compare)
  if (storedByteSize != null && storedByteSize !== actualByteSize) {
    return {
      ok: false,
      code: "FILE_SIZE_MISMATCH",
      detail: `File size mismatch for "${fileName}": expected ${storedByteSize} bytes, got ${actualByteSize}.`,
      sha256: actualSha256,
      byteSize: actualByteSize,
    };
  }

  // Hash check — use timingSafeEqual to prevent timing attacks
  const storedHashBuffer = Buffer.from(storedSha256, "hex");
  const actualHashBuffer = Buffer.from(actualSha256, "hex");

  if (storedHashBuffer.length !== actualHashBuffer.length || !timingSafeEqual(storedHashBuffer, actualHashBuffer)) {
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

/**
 * Compute the SHA-256 and byte size from a base64-encoded file content string.
 * Returns null when the base64 is empty or invalid.
 */
export function computeDigestFromBase64(base64Content: string | null | undefined): { sha256: string; byteSize: number } | null {
  if (!base64Content || base64Content.trim().length === 0) return null;
  try {
    const buffer = Buffer.from(base64Content, "base64");
    if (buffer.length === 0) return null;
    return { sha256: sha256Buffer(buffer), byteSize: buffer.length };
  } catch {
    return null;
  }
}

/**
 * Build a ZIP manifest entry with SHA-256 digest for audit trail.
 */
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
