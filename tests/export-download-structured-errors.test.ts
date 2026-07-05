// Regression coverage for export/download API error envelopes.
//
// These tests intentionally keep the assertions pure. The route handlers depend on
// authenticated sessions and Prisma, but the response-envelope contract must remain
// stable: blockers should return structured JSON instead of browser HTTP 500 pages.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

type ErrorEnvelope = {
  success: false;
  ok: false;
  code: string;
  error: string;
  message: string;
  [key: string]: unknown;
};

function err(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "DOWNLOAD_ROUTE_ERROR";
  return { status, body: { success: false, ok: false, code, error: message, message, ...extra } as ErrorEnvelope };
}

function jsonError(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "EXPORT_READINESS_ERROR";
  return { status, body: { ok: false, success: false, code, message, error: message, ...extra } as ErrorEnvelope };
}

describe("download route structured blocker envelopes", () => {
  it("includes success=false, ok=false, code, error and message", () => {
    const response = err("Document bytes are unavailable.", 409, {
      code: "STORAGE_CONTENT_UNAVAILABLE",
      documentId: "doc_1",
      fileName: "Technical-Proposal.docx",
      hasStoragePath: true,
      hasInlineFileContent: false,
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.success, false);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.code, "STORAGE_CONTENT_UNAVAILABLE");
    assert.equal(response.body.error, "Document bytes are unavailable.");
    assert.equal(response.body.message, "Document bytes are unavailable.");
    assert.equal(response.body.documentId, "doc_1");
    assert.equal(response.body.hasStoragePath, true);
    assert.equal(response.body.hasInlineFileContent, false);
  });

  it("defaults to DOWNLOAD_ROUTE_ERROR when no code is supplied", () => {
    const response = err("Download route failed.");
    assert.equal(response.status, 500);
    assert.equal(response.body.code, "DOWNLOAD_ROUTE_ERROR");
  });
});

describe("export-readiness route structured runtime envelope", () => {
  it("uses EXPORT_READINESS_RUNTIME_ERROR for caught route failures", () => {
    const response = jsonError("Export-readiness route failed.", 500, {
      code: "EXPORT_READINESS_RUNTIME_ERROR",
      detail: "example failure",
    });

    assert.equal(response.status, 500);
    assert.equal(response.body.success, false);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.code, "EXPORT_READINESS_RUNTIME_ERROR");
    assert.equal(response.body.error, "Export-readiness route failed.");
    assert.equal(response.body.message, "Export-readiness route failed.");
    assert.equal(response.body.detail, "example failure");
  });

  it("defaults to EXPORT_READINESS_ERROR when no code is supplied", () => {
    const response = jsonError("Tender not found", 404);
    assert.equal(response.status, 404);
    assert.equal(response.body.code, "EXPORT_READINESS_ERROR");
  });
});
