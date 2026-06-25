import assert from "node:assert";
import { describe, it, beforeEach } from "node:test";

describe("Storage Preflight validation in scripts/check-env.mjs", () => {
  let errors: string[] = [];
  let warnings: string[] = [];
  let isProd = false;
  let isVercelPreview = false;
  let strictPreviewEnvCheck = false;

  function validateStorage(env: Record<string, string>) {
    const blobToken = env.BLOB_READ_WRITE_TOKEN;
    const allowDb = ["1", "true", "yes"].includes((env.ALLOW_DB_FILE_STORAGE || "").trim().toLowerCase());

    if (!blobToken && !allowDb) {
      const msg = "Production storage is NOT configured. Either set BLOB_READ_WRITE_TOKEN for Vercel Blob storage, or set ALLOW_DB_FILE_STORAGE=true to enable emergency-only database fallback (bounded to 5MiB per file). Filesystem storage is not supported in production.";
      if (isProd) {
        errors.push(`  ✗ STORAGE_NOT_READY: ${msg}`);
      } else if (isVercelPreview && strictPreviewEnvCheck) {
        errors.push(`  ✗ STORAGE_NOT_READY: ${msg}`);
      } else {
        warnings.push(`  ⚠  STORAGE_NOT_READY: ${msg} [Preview/Dev build allowed; uploads may fail]`);
      }
    } else if (allowDb && !blobToken) {
      warnings.push("  ⚠  STORAGE_EMERGENCY_FALLBACK: ALLOW_DB_FILE_STORAGE=true is enabled. Files will be stored as base64 in the database. This is for emergency use only — monitor database size carefully.");
    }
  }

  beforeEach(() => {
    errors = [];
    warnings = [];
    isProd = false;
    isVercelPreview = false;
    strictPreviewEnvCheck = false;
  });

  it("fails in production when both are missing", () => {
    isProd = true;
    validateStorage({});
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /STORAGE_NOT_READY/);
  });

  it("passes in production with Blob token", () => {
    isProd = true;
    validateStorage({ BLOB_READ_WRITE_TOKEN: "test-token" });
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(warnings.length, 0);
  });

  it("warns in production with ALLOW_DB_FILE_STORAGE=true", () => {
    isProd = true;
    validateStorage({ ALLOW_DB_FILE_STORAGE: "true" });
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /STORAGE_EMERGENCY_FALLBACK/);
  });

  it("fails in strict preview when both are missing", () => {
    isVercelPreview = true;
    strictPreviewEnvCheck = true;
    validateStorage({});
    assert.strictEqual(errors.length, 1);
  });

  it("warns in relaxed preview when both are missing", () => {
    isVercelPreview = true;
    strictPreviewEnvCheck = false;
    validateStorage({});
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(warnings.length, 1);
  });
});
