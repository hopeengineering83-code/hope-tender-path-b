import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVercelBlobStorageUrl } from "../lib/storage";

describe("Vercel Blob storage URL trust boundary", () => {
  it("accepts private Vercel Blob hosts", () => {
    assert.equal(
      isVercelBlobStorageUrl("https://store-id.private.blob.vercel-storage.com/company/tender/file.pdf"),
      true,
    );
  });

  it("accepts standard Vercel Blob hosts", () => {
    assert.equal(
      isVercelBlobStorageUrl("https://store-id.blob.vercel-storage.com/company/file.docx"),
      true,
    );
  });

  it("rejects non-HTTPS URLs", () => {
    assert.equal(
      isVercelBlobStorageUrl("http://store-id.private.blob.vercel-storage.com/file.pdf"),
      false,
    );
  });

  it("rejects arbitrary HTTPS hosts", () => {
    assert.equal(isVercelBlobStorageUrl("https://example.com/file.pdf"), false);
  });

  it("rejects suffix-spoofed hosts", () => {
    assert.equal(
      isVercelBlobStorageUrl("https://store-id.blob.vercel-storage.com.attacker.example/file.pdf"),
      false,
    );
  });

  it("rejects the bare parent domain and malformed values", () => {
    assert.equal(isVercelBlobStorageUrl("https://blob.vercel-storage.com/file.pdf"), false);
    assert.equal(isVercelBlobStorageUrl("not-a-url"), false);
    assert.equal(isVercelBlobStorageUrl(""), false);
  });
});
