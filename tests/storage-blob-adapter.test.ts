// Exercises the real BlobStorage put/get/delete logic (URL trust-domain
// enforcement, token gating, fallback-when-unconfigured, error propagation)
// against a fake @vercel/blob client, for both company-asset and
// tender-file upload scopes. storage-adapter.test.ts covers provider
// selection and the local/db-base64 adapters; storage-blob-url-security.test.ts
// covers the pure isVercelBlobStorageUrl() predicate in isolation. Neither
// previously exercised BlobStorage's own put/get/delete methods.
//
// Real @vercel/blob is never called: BlobStorage's constructor accepts an
// optional client-override object used only by tests (production's
// getStorageAdapter() always constructs BlobStorage with no arguments).

import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { BlobStorage } from "../lib/storage";

const ENV_KEYS = ["BLOB_READ_WRITE_TOKEN"] as const;
type EnvSnapshot = Record<(typeof ENV_KEYS)[number], string | undefined>;
const mutableEnv = process.env as Record<string, string | undefined>;

function snapshotEnv(): EnvSnapshot {
  return ENV_KEYS.reduce<EnvSnapshot>((acc, key) => {
    acc[key] = process.env[key];
    return acc;
  }, {} as EnvSnapshot);
}
function restoreEnv(snap: EnvSnapshot) {
  for (const key of ENV_KEYS) {
    if (snap[key] === undefined) delete mutableEnv[key];
    else mutableEnv[key] = snap[key];
  }
}

function streamFor(content: string): ReadableStream {
  const bytes = Buffer.from(content);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

const TENDER_SCOPE = { fileName: "instructions.pdf", mimeType: "application/pdf", companyId: "company-1", tenderId: "tender-1" };
const COMPANY_ASSET_SCOPE = { fileName: "logo.png", mimeType: "image/png", companyId: "company-1" };

describe("BlobStorage — putFile", () => {
  let snap: EnvSnapshot;
  beforeEach(() => { snap = snapshotEnv(); });

  it("uploads a tender source file to Blob and returns its trusted URL", async () => {
    mutableEnv.BLOB_READ_WRITE_TOKEN = "fake-token";
    const calls: unknown[] = [];
    const storage = new BlobStorage({
      put: async (key, body, options) => {
        calls.push({ key, size: body.byteLength, options });
        return { url: `https://storeid.private.blob.vercel-storage.com/${key}` };
      },
    });

    const result = await storage.putFile(Buffer.from("tender pdf bytes"), TENDER_SCOPE);
    assert.equal(result.provider, "blob");
    assert.ok(result.storagePath?.includes("company-1/tender-tender-1/"));
    assert.equal(calls.length, 1);
    assert.deepEqual((calls[0] as { options: unknown }).options, { access: "private", token: "fake-token" });
    restoreEnv(snap);
  });

  it("uploads a company asset (brand logo) to Blob, scoped under company/ not tender-<id>/", async () => {
    mutableEnv.BLOB_READ_WRITE_TOKEN = "fake-token";
    const storage = new BlobStorage({
      put: async (key) => ({ url: `https://storeid.blob.vercel-storage.com/${key}` }),
    });

    const result = await storage.putFile(Buffer.from("png bytes"), COMPANY_ASSET_SCOPE);
    assert.equal(result.provider, "blob");
    assert.ok(result.storagePath?.includes("company-1/company/"));
    restoreEnv(snap);
  });

  it("rejects a Blob response whose URL is outside the trusted vercel-storage.com domain", async () => {
    mutableEnv.BLOB_READ_WRITE_TOKEN = "fake-token";
    const storage = new BlobStorage({
      put: async () => ({ url: "https://attacker.example/exfiltrate" }),
    });

    await assert.rejects(
      () => storage.putFile(Buffer.from("bytes"), TENDER_SCOPE),
      /Blob provider returned an unexpected storage URL/,
    );
    restoreEnv(snap);
  });

  it("falls back to bounded database storage (never calling the Blob client) when no token is configured", async () => {
    delete mutableEnv.BLOB_READ_WRITE_TOKEN;
    let putCalled = false;
    const storage = new BlobStorage({ put: async () => { putCalled = true; return { url: "https://x.blob.vercel-storage.com/x" }; } });

    // isDatabaseStorageAllowed() defaults to true outside production; this
    // asserts the *routing* decision (Blob client never invoked), not the
    // production ALLOW_DB_FILE_STORAGE policy, which storage-adapter.test.ts
    // already covers.
    const result = await storage.putFile(Buffer.from("small"), TENDER_SCOPE);
    assert.equal(result.provider, "db-base64");
    assert.equal(putCalled, false, "the Blob client must not be called when BLOB_READ_WRITE_TOKEN is unset");
    restoreEnv(snap);
  });
});

describe("BlobStorage — getFile", () => {
  let snap: EnvSnapshot;
  beforeEach(() => { snap = snapshotEnv(); });

  it("reads back the exact bytes previously stored (tender source file)", async () => {
    mutableEnv.BLOB_READ_WRITE_TOKEN = "fake-token";
    const storage = new BlobStorage({
      get: async (url, options) => {
        assert.equal(url, "https://storeid.private.blob.vercel-storage.com/company-1/tender-tender-1/file.pdf");
        assert.deepEqual(options, { access: "private", token: "fake-token" });
        return { statusCode: 200, stream: streamFor("tender pdf bytes") };
      },
    });

    const buffer = await storage.getFile({
      storagePath: "https://storeid.private.blob.vercel-storage.com/company-1/tender-tender-1/file.pdf",
      fileContent: null,
      fileName: "file.pdf",
    });
    assert.equal(buffer.toString(), "tender pdf bytes");
    restoreEnv(snap);
  });

  it("reads back a company asset (brand logo) the same way", async () => {
    mutableEnv.BLOB_READ_WRITE_TOKEN = "fake-token";
    const storage = new BlobStorage({
      get: async () => ({ statusCode: 200, stream: streamFor("png bytes") }),
    });
    const buffer = await storage.getFile({
      storagePath: "https://storeid.blob.vercel-storage.com/company-1/company/logo.png",
      fileContent: null,
      fileName: "logo.png",
    });
    assert.equal(buffer.toString(), "png bytes");
    restoreEnv(snap);
  });

  it("refuses to read a URL outside the trusted Vercel Blob domain, without calling the client", async () => {
    mutableEnv.BLOB_READ_WRITE_TOKEN = "fake-token";
    let getCalled = false;
    const storage = new BlobStorage({ get: async () => { getCalled = true; return { statusCode: 200, stream: streamFor("x") }; } });

    await assert.rejects(
      () => storage.getFile({ storagePath: "https://attacker.example/steal", fileContent: null, fileName: "x" }),
      /Stored Blob URL is outside the trusted Vercel Blob domain/,
    );
    assert.equal(getCalled, false);
    restoreEnv(snap);
  });

  it("surfaces a clear error when the object is missing", async () => {
    mutableEnv.BLOB_READ_WRITE_TOKEN = "fake-token";
    const storage = new BlobStorage({ get: async () => null });
    await assert.rejects(
      () => storage.getFile({ storagePath: "https://storeid.blob.vercel-storage.com/missing.pdf", fileContent: null, fileName: "missing.pdf" }),
      /Blob read failed: object not found/,
    );
    restoreEnv(snap);
  });

  it("surfaces a clear error for a non-200 Blob response", async () => {
    mutableEnv.BLOB_READ_WRITE_TOKEN = "fake-token";
    const storage = new BlobStorage({ get: async () => ({ statusCode: 403, stream: null as unknown as ReadableStream }) });
    await assert.rejects(
      () => storage.getFile({ storagePath: "https://storeid.blob.vercel-storage.com/forbidden.pdf", fileContent: null, fileName: "forbidden.pdf" }),
      /Blob read failed with status 403/,
    );
    restoreEnv(snap);
  });

  it("requires a token to read an existing Blob URL even when one is not configured at read time", async () => {
    delete mutableEnv.BLOB_READ_WRITE_TOKEN;
    const storage = new BlobStorage({ get: async () => ({ statusCode: 200, stream: streamFor("x") }) });
    await assert.rejects(
      () => storage.getFile({ storagePath: "https://storeid.blob.vercel-storage.com/file.pdf", fileContent: null, fileName: "file.pdf" }),
      /Blob storage token is not configured/,
    );
    restoreEnv(snap);
  });

  it("falls back to database content for non-URL storage paths", async () => {
    mutableEnv.BLOB_READ_WRITE_TOKEN = "fake-token";
    const storage = new BlobStorage({ get: async () => { throw new Error("must not be called"); } });
    const buffer = await storage.getFile({ storagePath: "", fileContent: Buffer.from("legacy").toString("base64"), fileName: "legacy.txt" });
    assert.equal(buffer.toString(), "legacy");
    restoreEnv(snap);
  });
});

describe("BlobStorage — deleteFile", () => {
  let snap: EnvSnapshot;
  beforeEach(() => { snap = snapshotEnv(); });

  it("deletes a tender source file from Blob with the configured token", async () => {
    mutableEnv.BLOB_READ_WRITE_TOKEN = "fake-token";
    const calls: unknown[] = [];
    const storage = new BlobStorage({ del: async (url, options) => { calls.push({ url, options }); } });

    await storage.deleteFile({ storagePath: "https://storeid.private.blob.vercel-storage.com/company-1/tender-tender-1/file.pdf", fileContent: null, fileName: "file.pdf" });
    assert.deepEqual(calls, [{ url: "https://storeid.private.blob.vercel-storage.com/company-1/tender-tender-1/file.pdf", options: { token: "fake-token" } }]);
    restoreEnv(snap);
  });

  it("deletes a company asset (brand logo) from Blob the same way", async () => {
    mutableEnv.BLOB_READ_WRITE_TOKEN = "fake-token";
    let deleted: string | null = null;
    const storage = new BlobStorage({ del: async (url) => { deleted = url; } });
    await storage.deleteFile({ storagePath: "https://storeid.blob.vercel-storage.com/company-1/company/logo.png", fileContent: null, fileName: "logo.png" });
    assert.equal(deleted, "https://storeid.blob.vercel-storage.com/company-1/company/logo.png");
    restoreEnv(snap);
  });

  it("refuses to delete a URL outside the trusted Vercel Blob domain, without calling the client", async () => {
    mutableEnv.BLOB_READ_WRITE_TOKEN = "fake-token";
    let delCalled = false;
    const storage = new BlobStorage({ del: async () => { delCalled = true; } });
    await assert.rejects(
      () => storage.deleteFile({ storagePath: "https://attacker.example/x", fileContent: null, fileName: "x" }),
      /Stored Blob URL is outside the trusted Vercel Blob domain/,
    );
    assert.equal(delCalled, false);
    restoreEnv(snap);
  });

  it("is a safe no-op for an empty storage path (already-deleted or inline-only record)", async () => {
    mutableEnv.BLOB_READ_WRITE_TOKEN = "fake-token";
    let delCalled = false;
    const storage = new BlobStorage({ del: async () => { delCalled = true; } });
    await storage.deleteFile({ storagePath: "", fileContent: "aGk=", fileName: "x.txt" });
    assert.equal(delCalled, false);
    restoreEnv(snap);
  });
});
