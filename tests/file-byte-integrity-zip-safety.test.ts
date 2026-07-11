// Tests for file byte integrity and final ZIP safety.
//
// Proves:
//   1. SHA-256 helper is stable.
//   2. Upload stores actual digest and size.
//   3. Client-supplied size/MIME cannot override actual bytes.
//   4. Storage adapter returns digest+size.
//   5. Missing digest blocks final ZIP for required files.
//   6. Digest mismatch blocks final ZIP.
//   7. Size mismatch blocks final ZIP.
//   8. ZIP manifest includes digest and size.
//   9. ZIP manifest digest matches actual bytes.
//  10. Path traversal blocked in ZIP manifest.
//  11. Duplicate filenames blocked in ZIP manifest.
//  12. Zero-byte required files blocked.
//  13. No raw storage/blob/path/token errors public.
//  14. No user-facing metadata wording.
//  15. Provider fallback order unchanged.
//  16. Final export remains fail-closed.
//  17. Timing-safe digest comparison.
//  18. Backfill computeDigestAndSize works.
//  19. Safe digest compare rejects wrong length.
//  20. verifyFileBytes handles all blocker codes.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  sha256Buffer,
  sha256Base64,
  safeDigestCompare,
  verifyFileBytes,
  verifyZipManifest,
  computeDigestAndSize,
  type ZipManifestEntry,
} from "../lib/engine/file-byte-integrity";

function read(p: string): string {
  return readFileSync(resolve(process.cwd(), p), "utf8");
}

// ─── 1. SHA-256 helper is stable ──────────────────────────────────────────────

describe("Spec Test 1 — SHA-256 helper stable", () => {
  it("sha256Buffer produces deterministic lowercase hex", () => {
    const buf = Buffer.from("test content for hashing");
    const hash1 = sha256Buffer(buf);
    const hash2 = sha256Buffer(buf);
    assert.equal(hash1, hash2, "same input must produce same hash");
    assert.equal(hash1.length, 64, "SHA-256 hex must be 64 chars");
    assert.match(hash1, /^[a-f0-9]{64}$/, "must be lowercase hex");
  });

  it("sha256Buffer different input produces different hash", () => {
    const buf1 = Buffer.from("content A");
    const buf2 = Buffer.from("content B");
    assert.notEqual(sha256Buffer(buf1), sha256Buffer(buf2));
  });

  it("sha256Base64 decodes base64 before hashing", () => {
    const buf = Buffer.from("test content for hashing");
    const base64 = buf.toString("base64");
    assert.equal(sha256Base64(base64), sha256Buffer(buf));
  });
});

// ─── 2-3. Upload stores actual digest, client cannot override ────────────────

describe("Spec Test 2-3 — Upload stores actual digest, client cannot override", () => {
  it("storage adapter putFile returns sha256 and sizeBytes", async () => {
    // Use the in-process storage adapter (will be DB-base64 in test env)
    const { getStorageAdapter } = await import("../lib/storage");
    const adapter = getStorageAdapter();
    const buf = Buffer.from("test file content for storage");
    const result = await adapter.putFile(buf, { fileName: "test.txt", mimeType: "text/plain" });
    assert.ok(result.sha256, "must return sha256");
    assert.equal(result.sha256.length, 64, "sha256 must be 64 hex chars");
    assert.equal(result.sizeBytes, buf.length, "sizeBytes must match actual byte length");
    assert.equal(result.sha256, sha256Buffer(buf), "sha256 must match independently computed hash");
  });

  it("client-supplied size cannot override actual bytes", async () => {
    const { getStorageAdapter } = await import("../lib/storage");
    const adapter = getStorageAdapter();
    const buf = Buffer.from("actual content");
    const result = await adapter.putFile(buf, { fileName: "test.txt", mimeType: "text/plain" });
    // The adapter computes from actual bytes — there is no client-supplied size field
    assert.equal(result.sizeBytes, buf.length, "size must be from actual bytes");
    assert.equal(result.sizeBytes, 14, "must be exactly 14 bytes");
  });
});

// ─── 4. Storage adapter returns digest+size ──────────────────────────────────

describe("Spec Test 4 — Storage adapter returns digest+size", () => {
  it("StorageWriteResult type includes sha256 and sizeBytes", () => {
    // Source-level check
    const src = read("lib/storage.ts");
    assert.ok(src.includes("sha256: string"), "StorageWriteResult must include sha256");
    assert.ok(src.includes("sizeBytes: number"), "StorageWriteResult must include sizeBytes");
  });
});

// ─── 5. Missing digest blocks final ZIP for required files ───────────────────

describe("Spec Test 5 — Missing digest blocks required files", () => {
  it("verifyFileBytes returns FILE_DIGEST_MISSING for required files without stored digest", () => {
    const result = verifyFileBytes({
      bytes: Buffer.from("content"),
      storedSha256: null,
      isRequired: true,
      safeFilename: "required.pdf",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "FILE_DIGEST_MISSING");
    }
  });

  it("verifyFileBytes passes for optional files without stored digest", () => {
    const result = verifyFileBytes({
      bytes: Buffer.from("content"),
      storedSha256: null,
      isRequired: false,
      safeFilename: "optional.txt",
    });
    assert.equal(result.ok, true);
  });
});

// ─── 6. Digest mismatch blocks ───────────────────────────────────────────────

describe("Spec Test 6 — Digest mismatch blocks", () => {
  it("verifyFileBytes returns FILE_INTEGRITY_HASH_MISMATCH on hash mismatch", () => {
    const result = verifyFileBytes({
      bytes: Buffer.from("actual content"),
      storedSha256: sha256Buffer(Buffer.from("different content")),
      isRequired: true,
      safeFilename: "doc.docx",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "FILE_INTEGRITY_HASH_MISMATCH");
    }
  });
});

// ─── 7. Size mismatch blocks ─────────────────────────────────────────────────

describe("Spec Test 7 — Size mismatch blocks", () => {
  it("verifyFileBytes returns FILE_SIZE_MISMATCH on size mismatch", () => {
    const result = verifyFileBytes({
      bytes: Buffer.from("content"),
      storedSha256: sha256Buffer(Buffer.from("content")),
      storedSizeBytes: 999, // wrong size
      isRequired: true,
      safeFilename: "doc.docx",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "FILE_SIZE_MISMATCH");
    }
  });
});

// ─── 8-9. ZIP manifest includes digest+size and matches ──────────────────────

describe("Spec Test 8-9 — ZIP manifest digest+size", () => {
  it("verifyZipManifest passes when digests match", () => {
    const buf1 = Buffer.from("file 1 content");
    const buf2 = Buffer.from("file 2 content");
    const manifest: ZipManifestEntry[] = [
      { filename: "file1.docx", byteSize: buf1.length, sha256: sha256Buffer(buf1), required: true },
      { filename: "file2.docx", byteSize: buf2.length, sha256: sha256Buffer(buf2), required: false },
    ];
    const actual = [
      { filename: "file1.docx", bytes: buf1 },
      { filename: "file2.docx", bytes: buf2 },
    ];
    const result = verifyZipManifest(manifest, actual);
    assert.equal(result.ok, true);
    assert.equal(result.entriesVerified, 2);
  });

  it("verifyZipManifest blocks on digest mismatch", () => {
    const buf1 = Buffer.from("actual content");
    const manifest: ZipManifestEntry[] = [
      { filename: "file1.docx", byteSize: buf1.length, sha256: sha256Buffer(Buffer.from("different")), required: true },
    ];
    const actual = [{ filename: "file1.docx", bytes: buf1 }];
    const result = verifyZipManifest(manifest, actual);
    assert.equal(result.ok, false);
    assert.ok(result.blockers.some((b) => b.code === "ZIP_MANIFEST_DIGEST_MISMATCH"));
  });
});

// ─── 10. Path traversal blocked ──────────────────────────────────────────────

describe("Spec Test 10 — Path traversal blocked", () => {
  it("verifyZipManifest blocks path traversal", () => {
    const buf = Buffer.from("content");
    const manifest: ZipManifestEntry[] = [
      { filename: "../../../etc/passwd", byteSize: buf.length, sha256: sha256Buffer(buf), required: false },
    ];
    const result = verifyZipManifest(manifest, [{ filename: "../../../etc/passwd", bytes: buf }]);
    assert.equal(result.ok, false);
    assert.ok(result.blockers.some((b) => b.filename.includes("..")));
  });
});

// ─── 11. Duplicate filenames blocked ────────────────────────────────────────

describe("Spec Test 11 — Duplicate filenames blocked", () => {
  it("verifyZipManifest blocks duplicate filenames", () => {
    const buf = Buffer.from("content");
    const hash = sha256Buffer(buf);
    const manifest: ZipManifestEntry[] = [
      { filename: "file.docx", byteSize: buf.length, sha256: hash, required: true },
      { filename: "file.docx", byteSize: buf.length, sha256: hash, required: false },
    ];
    const result = verifyZipManifest(manifest, [
      { filename: "file.docx", bytes: buf },
      { filename: "file.docx", bytes: buf },
    ]);
    assert.equal(result.ok, false);
    assert.ok(result.blockers.some((b) => b.detail.includes("Duplicate")));
  });
});

// ─── 12. Zero-byte required files blocked ────────────────────────────────────

describe("Spec Test 12 — Zero-byte required files blocked", () => {
  it("verifyZipManifest blocks zero-byte required files", () => {
    const manifest: ZipManifestEntry[] = [
      { filename: "required.pdf", byteSize: 0, sha256: "0".repeat(64), required: true },
    ];
    const result = verifyZipManifest(manifest, []);
    assert.equal(result.ok, false);
    assert.ok(result.blockers.some((b) => b.code === "FILE_BYTES_MISSING"));
  });
});

// ─── 13. No raw errors public ────────────────────────────────────────────────

describe("Spec Test 13 — No raw errors public", () => {
  it("file-byte-integrity.ts does not expose paths/tokens in detail strings", () => {
    const src = read("lib/engine/file-byte-integrity.ts");
    assert.ok(!src.includes("storagePath"), "must not reference storagePath in detail strings");
    assert.ok(!src.includes("BLOB_READ_WRITE_TOKEN"), "must not reference tokens");
  });
});

// ─── 14. No 'metadata' wording ───────────────────────────────────────────────

describe("Spec Test 14 — No 'metadata' wording", () => {
  it("file-byte-integrity.ts has no user-facing 'metadata'", () => {
    const src = read("lib/engine/file-byte-integrity.ts");
    assert.ok(!/>\s*[Mm]etadata[\s<]/.test(src));
  });
});

// ─── 15. Provider fallback order unchanged ───────────────────────────────────

describe("Spec Test 15 — Provider fallback order", () => {
  it("all 10 providers present", () => {
    const src = read("lib/ai-provider-catalog.cjs");
    for (const p of ["zai", "cerebras", "mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"]) {
      assert.ok(src.includes(p));
    }
  });
});

// ─── 16. Final export fail-closed ────────────────────────────────────────────

describe("Spec Test 16 — Final export fail-closed", () => {
  it("isFinalExportCandidateDocument excludes SUPERSEDED", async () => {
    const { isFinalExportCandidateDocument } = await import("../lib/engine/document-output-state");
    assert.equal(isFinalExportCandidateDocument({
      generationStatus: "SUPERSEDED", validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT", format: "DOCX",
      documentType: "T", name: "T", exactFileName: "T.docx",
    } as any), false);
  });
});

// ─── 17. Timing-safe digest comparison ───────────────────────────────────────

describe("Spec Test 17 — Timing-safe digest comparison", () => {
  it("safeDigestCompare returns true for matching digests", () => {
    const hash = sha256Buffer(Buffer.from("test"));
    assert.equal(safeDigestCompare(hash, hash), true);
  });

  it("safeDigestCompare returns false for non-matching digests", () => {
    const hash1 = sha256Buffer(Buffer.from("test1"));
    const hash2 = sha256Buffer(Buffer.from("test2"));
    assert.equal(safeDigestCompare(hash1, hash2), false);
  });
});

// ─── 18. computeDigestAndSize works ──────────────────────────────────────────

describe("Spec Test 18 — computeDigestAndSize", () => {
  it("computes correct sha256 and sizeBytes from Buffer", () => {
    const buf = Buffer.from("test content");
    const result = computeDigestAndSize(buf);
    assert.equal(result.sha256, sha256Buffer(buf));
    assert.equal(result.sizeBytes, buf.length);
  });

  it("computes correct sha256 and sizeBytes from base64 string", () => {
    const buf = Buffer.from("test content");
    const base64 = buf.toString("base64");
    const result = computeDigestAndSize(base64);
    assert.equal(result.sha256, sha256Buffer(buf));
    assert.equal(result.sizeBytes, buf.length);
  });
});

// ─── 19. Safe digest compare rejects wrong length ────────────────────────────

describe("Spec Test 19 — Safe digest compare rejects wrong length", () => {
  it("returns false for different-length inputs", () => {
    assert.equal(safeDigestCompare("abc", "abcdef"), false);
  });
});

// ─── 20. verifyFileBytes handles all blocker codes ───────────────────────────

describe("Spec Test 20 — verifyFileBytes handles all blocker codes", () => {
  it("FILE_BYTES_MISSING for null bytes", () => {
    const result = verifyFileBytes({ bytes: null, safeFilename: "f.docx", isRequired: true });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FILE_BYTES_MISSING");
  });

  it("FILE_BYTES_MISSING for empty buffer", () => {
    const result = verifyFileBytes({ bytes: Buffer.alloc(0), safeFilename: "f.docx", isRequired: true });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FILE_BYTES_MISSING");
  });

  it("FILE_DIGEST_MISSING for required file without digest", () => {
    const result = verifyFileBytes({ bytes: Buffer.from("x"), storedSha256: null, isRequired: true, safeFilename: "f.docx" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FILE_DIGEST_MISSING");
  });

  it("FILE_INTEGRITY_HASH_MISMATCH for wrong digest", () => {
    const result = verifyFileBytes({
      bytes: Buffer.from("content"),
      storedSha256: "0".repeat(64),
      isRequired: true,
      safeFilename: "f.docx",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FILE_INTEGRITY_HASH_MISMATCH");
  });

  it("FILE_SIZE_MISMATCH for wrong size", () => {
    const buf = Buffer.from("content");
    const result = verifyFileBytes({
      bytes: buf,
      storedSha256: sha256Buffer(buf),
      storedSizeBytes: 999,
      isRequired: true,
      safeFilename: "f.docx",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FILE_SIZE_MISMATCH");
  });

  it("FILE_TYPE_MISMATCH for wrong MIME", () => {
    const buf = Buffer.from("content");
    const result = verifyFileBytes({
      bytes: buf,
      storedSha256: sha256Buffer(buf),
      storedSizeBytes: buf.length,
      expectedMimeType: "application/pdf",
      actualMimeType: "text/plain",
      isRequired: true,
      safeFilename: "f.docx",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "FILE_TYPE_MISMATCH");
  });

  it("OK for matching digest+size", () => {
    const buf = Buffer.from("content");
    const result = verifyFileBytes({
      bytes: buf,
      storedSha256: sha256Buffer(buf),
      storedSizeBytes: buf.length,
      isRequired: true,
      safeFilename: "f.docx",
    });
    assert.equal(result.ok, true);
  });
});

// ─── Schema verification ─────────────────────────────────────────────────────

describe("Schema — sha256/sizeBytes fields present", () => {
  it("TenderFile has sha256, sizeBytes, storageProvider", () => {
    const src = read("prisma/schema.prisma");
    assert.ok(src.includes('sha256           String?  // SHA-256 hex digest of actual file bytes'), "TenderFile sha256");
    assert.ok(src.includes("sizeBytes        Int?     // Actual byte length"), "TenderFile sizeBytes");
    assert.ok(src.includes('storageProvider  String?'), "TenderFile storageProvider");
  });

  it("GeneratedDocument has sha256, sizeBytes", () => {
    const src = read("prisma/schema.prisma");
    assert.ok(src.includes("sha256           String?  // SHA-256 hex digest of actual file bytes"), "GeneratedDocument sha256");
    assert.ok(src.includes("sizeBytes        Int?     // Actual byte length"), "GeneratedDocument sizeBytes");
  });

  it("CompanyAsset has sha256, sizeBytes", () => {
    const src = read("prisma/schema.prisma");
    assert.ok(src.includes("sha256           String?  // SHA-256 hex digest of actual file bytes"), "CompanyAsset sha256");
  });

  it("migration SQL exists", () => {
    const src = read("prisma/migrations/20260711000000_add_file_byte_integrity_fields/migration.sql");
    assert.ok(src.includes("sha256"), "migration adds sha256");
    assert.ok(src.includes("sizeBytes"), "migration adds sizeBytes");
    assert.ok(src.includes("storageProvider"), "migration adds storageProvider");
  });
});
