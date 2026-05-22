// Tests for the storage adapter (Gap 7).
//
// Coverage:
//   - Legacy base64 records still read correctly (storagePath=""+fileContent)
//   - Production without blob storage refuses large files (>5 MB)
//   - Small files in production fall back to db-base64 cleanly
//   - Local dev uses the filesystem adapter and returns a non-empty storagePath

import { describe, it, before, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  DB_BASE64_MAX_BYTES,
  getStorageAdapter,
  getActiveStorageProvider,
  resetStorageAdapter,
  resolveStorageProvider,
} from "../lib/storage";

const ENV_KEYS = ["NODE_ENV", "STORAGE_ROOT", "BLOB_READ_WRITE_TOKEN"] as const;
function snap(): Record<(typeof ENV_KEYS)[number], string | undefined> {
  return ENV_KEYS.reduce((acc, k) => {
    acc[k] = process.env[k];
    return acc;
  }, {} as Record<(typeof ENV_KEYS)[number], string | undefined>);
}
function restore(snap: Record<(typeof ENV_KEYS)[number], string | undefined>) {
  const mut = process.env as Record<string, string | undefined>;
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete mut[k];
    else mut[k] = snap[k];
  }
}

let tmp: string;

before(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "storage-adapter-"));
});
after(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  resetStorageAdapter();
});

describe("storage adapter — legacy base64 read", () => {
  it("reads a row with storagePath='' + fileContent populated", async () => {
    const original = Buffer.from("hello-legacy");
    const adapter = getStorageAdapter();
    const buf = await adapter.getFile({
      storagePath: "",
      fileContent: original.toString("base64"),
      fileName: "legacy.txt",
    });
    assert.equal(buf.toString(), "hello-legacy");
  });

  it("reads a row with storagePath=null + fileContent populated", async () => {
    const original = Buffer.from("hello-null");
    const adapter = getStorageAdapter();
    const buf = await adapter.getFile({
      storagePath: null,
      fileContent: original.toString("base64"),
      fileName: "legacy.txt",
    });
    assert.equal(buf.toString(), "hello-null");
  });
});

describe("storage adapter — local provider write", () => {
  it("writes a non-empty storagePath when STORAGE_ROOT is set", async () => {
    const s = snap();
    try {
      const mut = process.env as Record<string, string | undefined>;
      mut.NODE_ENV = "development";
      mut.STORAGE_ROOT = tmp;
      delete mut.BLOB_READ_WRITE_TOKEN;
      resetStorageAdapter();
      assert.equal(resolveStorageProvider(), "local");

      const adapter = getStorageAdapter();
      const written = await adapter.putFile(Buffer.from("hello"), {
        fileName: "test.txt",
        mimeType: "text/plain",
        tenderId: "t1",
      });
      assert.equal(written.provider, "local");
      assert.notEqual(written.storagePath, "");
      assert.ok(existsSync(written.storagePath), "expected the file to exist on disk");
      assert.equal(readFileSync(written.storagePath, "utf8"), "hello");
      assert.equal(getActiveStorageProvider(), "local");
    } finally {
      restore(s);
      resetStorageAdapter();
    }
  });

  it("read-back of a fresh local write returns identical bytes", async () => {
    const s = snap();
    try {
      const mut = process.env as Record<string, string | undefined>;
      mut.NODE_ENV = "development";
      mut.STORAGE_ROOT = tmp;
      delete mut.BLOB_READ_WRITE_TOKEN;
      resetStorageAdapter();
      const adapter = getStorageAdapter();
      const data = Buffer.from("round-trip-bytes");
      const written = await adapter.putFile(data, { fileName: "rt.bin", mimeType: "application/octet-stream" });
      const read = await adapter.getFile({
        storagePath: written.storagePath,
        fileContent: written.fileContent ?? null,
        fileName: "rt.bin",
      });
      assert.equal(read.equals(data), true);
    } finally {
      restore(s);
      resetStorageAdapter();
    }
  });
});

describe("storage adapter — production without blob storage", () => {
  it("refuses large (>5 MB) uploads when only db-base64 is available", async () => {
    const s = snap();
    try {
      const mut = process.env as Record<string, string | undefined>;
      mut.NODE_ENV = "production";
      delete mut.STORAGE_ROOT;
      delete mut.BLOB_READ_WRITE_TOKEN;
      resetStorageAdapter();
      assert.equal(resolveStorageProvider(), "db-base64");

      const adapter = getStorageAdapter();
      const big = Buffer.alloc(DB_BASE64_MAX_BYTES + 1);
      await assert.rejects(
        () => adapter.putFile(big, { fileName: "huge.bin", mimeType: "application/octet-stream" }),
        /db-base64 storage cannot accept files larger than/,
      );
    } finally {
      restore(s);
      resetStorageAdapter();
    }
  });

  it("accepts small files in production via db-base64", async () => {
    const s = snap();
    try {
      const mut = process.env as Record<string, string | undefined>;
      mut.NODE_ENV = "production";
      delete mut.STORAGE_ROOT;
      delete mut.BLOB_READ_WRITE_TOKEN;
      resetStorageAdapter();
      const adapter = getStorageAdapter();
      const small = Buffer.from("small-prod-content");
      const written = await adapter.putFile(small, { fileName: "s.txt", mimeType: "text/plain" });
      assert.equal(written.provider, "db-base64");
      assert.equal(written.storagePath, "");
      assert.equal(written.fileContent, small.toString("base64"));
    } finally {
      restore(s);
      resetStorageAdapter();
    }
  });
});

describe("storage adapter — resolveStorageProvider precedence", () => {
  it("blob > local > db-base64", async () => {
    const s = snap();
    try {
      const mut = process.env as Record<string, string | undefined>;
      mut.NODE_ENV = "production";
      delete mut.STORAGE_ROOT;
      mut.BLOB_READ_WRITE_TOKEN = "fake-token";
      resetStorageAdapter();
      assert.equal(resolveStorageProvider(), "blob");

      delete mut.BLOB_READ_WRITE_TOKEN;
      resetStorageAdapter();
      assert.equal(resolveStorageProvider(), "db-base64");

      mut.STORAGE_ROOT = tmp;
      resetStorageAdapter();
      assert.equal(resolveStorageProvider(), "local");
    } finally {
      restore(s);
      resetStorageAdapter();
    }
  });
});
