import { describe, it, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  DB_BASE64_MAX_BYTES,
  getStorageAdapter,
  getActiveStorageProvider,
  isProductionStorageReady,
  resetStorageAdapter,
  resolveStorageProvider,
} from "../lib/storage";

const ENV_KEYS = [
  "NODE_ENV",
  "VERCEL_ENV",
  "STORAGE_ROOT",
  "BLOB_READ_WRITE_TOKEN",
  "ALLOW_DB_FILE_STORAGE",
] as const;

type EnvSnapshot = Record<(typeof ENV_KEYS)[number], string | undefined>;

function snapshotEnv(): EnvSnapshot {
  return ENV_KEYS.reduce<EnvSnapshot>((acc, key) => {
    acc[key] = process.env[key];
    return acc;
  }, {} as EnvSnapshot);
}

function restoreEnv(snapshot: EnvSnapshot) {
  const mutable = process.env as Record<string, string | undefined>;
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete mutable[key];
    else mutable[key] = snapshot[key];
  }
}

let temporaryRoot: string;

before(() => {
  temporaryRoot = mkdtempSync(path.join(tmpdir(), "storage-adapter-"));
});

after(() => {
  if (temporaryRoot && existsSync(temporaryRoot)) {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

beforeEach(() => resetStorageAdapter());

describe("legacy database content", () => {
  it("reads legacy base64 rows", async () => {
    const adapter = getStorageAdapter();
    for (const storagePath of ["", null]) {
      const expected = Buffer.from(`legacy-${storagePath === null ? "null" : "empty"}`);
      const actual = await adapter.getFile({
        storagePath,
        fileContent: expected.toString("base64"),
        fileName: "legacy.txt",
      });
      assert.equal(actual.equals(expected), true);
    }
  });
});

describe("development local storage", () => {
  it("writes, reads, and deletes within the configured root", async () => {
    const snapshot = snapshotEnv();
    try {
      const mutable = process.env as Record<string, string | undefined>;
      mutable.NODE_ENV = "development";
      delete mutable.VERCEL_ENV;
      mutable.STORAGE_ROOT = temporaryRoot;
      delete mutable.BLOB_READ_WRITE_TOKEN;
      delete mutable.ALLOW_DB_FILE_STORAGE;
      resetStorageAdapter();

      assert.equal(resolveStorageProvider(), "local");
      assert.equal(isProductionStorageReady(), true);
      const adapter = getStorageAdapter();
      const expected = Buffer.from("round-trip-bytes");
      const written = await adapter.putFile(expected, {
        fileName: "round-trip.txt",
        mimeType: "text/plain",
        companyId: "company-1",
        tenderId: "tender-1",
      });
      assert.equal(written.provider, "local");
      assert.ok(written.storagePath);
      assert.ok(existsSync(written.storagePath));
      assert.equal(readFileSync(written.storagePath).equals(expected), true);
      assert.equal(getActiveStorageProvider(), "local");

      const read = await adapter.getFile({
        storagePath: written.storagePath,
        fileContent: null,
        fileName: "round-trip.txt",
      });
      assert.equal(read.equals(expected), true);
      await adapter.deleteFile({ storagePath: written.storagePath, fileContent: null, fileName: "round-trip.txt" });
      assert.equal(existsSync(written.storagePath), false);
    } finally {
      restoreEnv(snapshot);
      resetStorageAdapter();
    }
  });
});

describe("production storage falls back safely", () => {
  it("does not silently allow database-backed storage when Blob is not configured", async () => {
    const snapshot = snapshotEnv();
    try {
      const mutable = process.env as Record<string, string | undefined>;
      mutable.NODE_ENV = "production";
      delete mutable.VERCEL_ENV;
      delete mutable.BLOB_READ_WRITE_TOKEN;
      delete mutable.ALLOW_DB_FILE_STORAGE;
      mutable.STORAGE_ROOT = temporaryRoot;
      resetStorageAdapter();

      assert.equal(resolveStorageProvider(), "db-base64");
      assert.equal(isProductionStorageReady(), false);
      await assert.rejects(
        () => getStorageAdapter().putFile(Buffer.from("fallback-content"), { fileName: "small.txt", mimeType: "text/plain" }),
        /Durable production storage is not configured/,
      );
    } finally {
      restoreEnv(snapshot);
      resetStorageAdapter();
    }
  });

  it("rejects database storage when explicitly disabled", async () => {
    const snapshot = snapshotEnv();
    try {
      const mutable = process.env as Record<string, string | undefined>;
      mutable.NODE_ENV = "production";
      delete mutable.VERCEL_ENV;
      delete mutable.BLOB_READ_WRITE_TOKEN;
      mutable.ALLOW_DB_FILE_STORAGE = "false";
      mutable.STORAGE_ROOT = temporaryRoot;
      resetStorageAdapter();

      assert.equal(isProductionStorageReady(), false);
      await assert.rejects(
        () => getStorageAdapter().putFile(Buffer.from("small"), { fileName: "small.txt", mimeType: "text/plain" }),
        /Durable production storage is not configured/,
      );
    } finally {
      restoreEnv(snapshot);
      resetStorageAdapter();
    }
  });

  it("allows an explicitly approved small database file and enforces the size cap", async () => {
    const snapshot = snapshotEnv();
    try {
      const mutable = process.env as Record<string, string | undefined>;
      mutable.NODE_ENV = "production";
      delete mutable.VERCEL_ENV;
      delete mutable.BLOB_READ_WRITE_TOKEN;
      mutable.ALLOW_DB_FILE_STORAGE = "true";
      resetStorageAdapter();

      assert.equal(isProductionStorageReady(), true);
      const adapter = getStorageAdapter();
      const small = Buffer.from("approved-small-content");
      const written = await adapter.putFile(small, { fileName: "small.txt", mimeType: "text/plain" });
      assert.equal(written.provider, "db-base64");
      assert.equal(written.fileContent, small.toString("base64"));

      await assert.rejects(
        () => adapter.putFile(Buffer.alloc(DB_BASE64_MAX_BYTES + 1), { fileName: "large.bin", mimeType: "application/octet-stream" }),
        /Database file storage limit exceeded/,
      );
    } finally {
      restoreEnv(snapshot);
      resetStorageAdapter();
    }
  });
});

describe("provider selection", () => {
  it("uses Blob in production, never local disk, and local disk only in development", () => {
    const snapshot = snapshotEnv();
    try {
      const mutable = process.env as Record<string, string | undefined>;
      mutable.NODE_ENV = "production";
      mutable.STORAGE_ROOT = temporaryRoot;
      mutable.BLOB_READ_WRITE_TOKEN = "test-token";
      resetStorageAdapter();
      assert.equal(resolveStorageProvider(), "blob");

      delete mutable.BLOB_READ_WRITE_TOKEN;
      resetStorageAdapter();
      assert.equal(resolveStorageProvider(), "db-base64");

      mutable.NODE_ENV = "development";
      resetStorageAdapter();
      assert.equal(resolveStorageProvider(), "local");
    } finally {
      restoreEnv(snapshot);
      resetStorageAdapter();
    }
  });
});
