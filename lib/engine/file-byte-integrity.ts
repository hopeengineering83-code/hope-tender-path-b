/**
 * File Byte Integrity — SHA-256 verification for final-package safety.
 *
 * This module provides:
 *   - sha256Buffer(buffer): deterministic SHA-256 hex digest
 *   - verifyFileBytes(...): recompute + compare digest and size
 *   - Structured blocker codes for integrity failures
 *   - Integration with the final ZIP download path
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

/**
 * Compute SHA-256 from base64 string content (decodes first).
 */
export function sha256Base64(base64Content: string): string {
  const buffer = Buffer.from(base64Content, "base64");
  return sha256Buffer(buffer);
}

/**
 * Timing-safe comparison of two hex digests.
 * Returns true if they match.
 */
export function safeDigestCompare(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// ─── Integrity verification ───────────────────────────────────────────────────

export type FileIntegrityInput = {
  /** Actual file bytes (Buffer or base64 string). Required. */
  bytes: Buffer | string | null | undefined;
  /** Stored SHA-256 digest from DB. If null/empty, the file has no stored digest. */
  storedSha256?: string | null;
  /** Stored byte size from DB. If null, the file has no stored size. */
  storedSizeBytes?: number | null;
  /** Expected MIME type (optional, for type verification). */
  expectedMimeType?: string | null;
  /** Actual MIME type from the record. */
  actualMimeType?: string | null;
  /** Whether this file is required for final export. */
  isRequired?: boolean;
  /** Safe filename for error messages (never raw path). */
  safeFilename: string;
};

/**
 * Verify file byte integrity:
 *   1. Bytes must be present (non-null, non-empty).
 *   2. If storedSha256 exists, recompute and compare.
 *   3. If storedSizeBytes exists, compare actual size.
 *   4. If expectedMimeType exists, compare to actualMimeType.
 *
 * For required files: missing digest is a hard block.
 * For optional files: missing digest is a warning (caller decides).
 */
export function verifyFileBytes(input: FileIntegrityInput): FileIntegrityResult {
  // 1. Bytes must be present
  if (!input.bytes) {
    return {
      ok: false,
      code: "FILE_BYTES_MISSING",
      detail: `File "${input.safeFilename}" has no content bytes.`,
    };
  }

  const buffer = typeof input.bytes === "string"
    ? Buffer.from(input.bytes, "base64")
    : input.bytes;

  if (buffer.length === 0) {
    return {
      ok: false,
      code: "FILE_BYTES_MISSING",
      detail: `File "${input.safeFilename}" has zero bytes.`,
      byteSize: 0,
    };
  }

  const actualSha256 = sha256Buffer(buffer);
  const actualSize = buffer.length;

  // 2. Digest verification
  if (input.storedSha256 && input.storedSha256.trim().length > 0) {
    if (!safeDigestCompare(actualSha256, input.storedSha256)) {
      return {
        ok: false,
        code: "FILE_INTEGRITY_HASH_MISMATCH",
        detail: `File "${input.safeFilename}" digest mismatch — stored hash does not match actual bytes.`,
        sha256: actualSha256,
        byteSize: actualSize,
      };
    }
  } else if (input.isRequired) {
    // Required files MUST have a stored digest — without it, we cannot
    // verify the file hasn't been tampered with since upload/generation.
    return {
      ok: false,
      code: "FILE_DIGEST_MISSING",
      detail: `Required file "${input.safeFilename}" has no stored SHA-256 digest — cannot verify integrity.`,
      sha256: actualSha256,
      byteSize: actualSize,
    };
  }

  // 3. Size verification
  if (input.storedSizeBytes != null && input.storedSizeBytes > 0) {
    if (actualSize !== input.storedSizeBytes) {
      return {
        ok: false,
        code: "FILE_SIZE_MISMATCH",
        detail: `File "${input.safeFilename}" size mismatch — stored ${input.storedSizeBytes} bytes, actual ${actualSize} bytes.`,
        sha256: actualSha256,
        byteSize: actualSize,
      };
    }
  }

  // 4. MIME type verification
  if (input.expectedMimeType && input.actualMimeType && input.expectedMimeType !== input.actualMimeType) {
    return {
      ok: false,
      code: "FILE_TYPE_MISMATCH",
      detail: `File "${input.safeFilename}" type mismatch — expected ${input.expectedMimeType}, got ${input.actualMimeType}.`,
      sha256: actualSha256,
      byteSize: actualSize,
    };
  }

  return { ok: true, sha256: actualSha256, byteSize: actualSize };
}

// ─── ZIP manifest verification ────────────────────────────────────────────────

export type ZipManifestEntry = {
  filename: string;
  byteSize: number;
  sha256: string;
  documentType?: string;
  status?: string;
  required?: boolean;
};

export type ZipManifestVerificationResult = {
  ok: boolean;
  blockers: Array<{ code: FileIntegrityBlockerCode; filename: string; detail: string }>;
  entriesVerified: number;
};

/**
 * Verify a ZIP manifest against actual ZIP entries.
 * Each entry's digest is recomputed from actual bytes and compared.
 *
 * Checks:
 *   - Manifest count matches actual entries
 *   - No duplicate filenames
 *   - No path traversal (../ in filenames)
 *   - No zero-byte required files
 *   - Digest matches for every entry
 */
export function verifyZipManifest(
  manifest: ZipManifestEntry[],
  actualEntries: Array<{ filename: string; bytes: Buffer }>,
): ZipManifestVerificationResult {
  const blockers: Array<{ code: FileIntegrityBlockerCode; filename: string; detail: string }> = [];
  const seenFilenames = new Set<string>();
  const actualMap = new Map(actualEntries.map((e) => [e.filename, e.bytes]));

  // Manifest count check
  if (manifest.length !== actualEntries.length) {
    blockers.push({
      code: "ZIP_MANIFEST_DIGEST_MISMATCH",
      filename: "(manifest)",
      detail: `Manifest count (${manifest.length}) does not match actual ZIP entries (${actualEntries.length}).`,
    });
  }

  for (const entry of manifest) {
    const normalized = entry.filename.trim().toLowerCase();

    // Path traversal check
    if (normalized.includes("..") || normalized.includes("\\")) {
      blockers.push({
        code: "ZIP_MANIFEST_DIGEST_MISMATCH",
        filename: entry.filename,
        detail: `Path traversal detected in filename.`,
      });
      continue;
    }

    // Duplicate check
    if (seenFilenames.has(normalized)) {
      blockers.push({
        code: "ZIP_MANIFEST_DIGEST_MISMATCH",
        filename: entry.filename,
        detail: `Duplicate filename in ZIP.`,
      });
      continue;
    }
    seenFilenames.add(normalized);

    // Zero-byte required file check
    if (entry.required && entry.byteSize <= 0) {
      blockers.push({
        code: "FILE_BYTES_MISSING",
        filename: entry.filename,
        detail: `Required file has zero bytes.`,
      });
      continue;
    }

    // Digest format check
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) {
      blockers.push({
        code: "FILE_DIGEST_MISSING",
        filename: entry.filename,
        detail: `Invalid SHA-256 digest format.`,
      });
      continue;
    }

    // Recompute and compare digest
    const actualBytes = actualMap.get(entry.filename);
    if (!actualBytes) {
      blockers.push({
        code: "FILE_BYTES_MISSING",
        filename: entry.filename,
        detail: `File not found in actual ZIP entries.`,
      });
      continue;
    }

    const actualSha256 = sha256Buffer(actualBytes);
    if (!safeDigestCompare(actualSha256, entry.sha256)) {
      blockers.push({
        code: "ZIP_MANIFEST_DIGEST_MISMATCH",
        filename: entry.filename,
        detail: `Digest mismatch — manifest hash does not match actual ZIP bytes.`,
      });
      continue;
    }

    // Size check
    if (actualBytes.length !== entry.byteSize) {
      blockers.push({
        code: "FILE_SIZE_MISMATCH",
        filename: entry.filename,
        detail: `Size mismatch — manifest ${entry.byteSize} bytes, actual ${actualBytes.length} bytes.`,
      });
      continue;
    }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    entriesVerified: manifest.length,
  };
}

// ─── Backfill helper ──────────────────────────────────────────────────────────

export type BackfillResult = {
  repaired: number;
  skipped: number;
  errors: number;
  details: string[];
};

/**
 * Compute digest and size from actual bytes.
 * Used by backfill scripts to populate sha256/sizeBytes on legacy rows.
 */
export function computeDigestAndSize(bytes: Buffer | string): { sha256: string; sizeBytes: number } {
  const buffer = typeof bytes === "string" ? Buffer.from(bytes, "base64") : bytes;
  return {
    sha256: sha256Buffer(buffer),
    sizeBytes: buffer.length,
  };
}
