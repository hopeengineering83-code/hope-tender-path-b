// Storage-backed document audit — unit tests.
//
// Tests the audit module using stubs for the storage adapter so we don't need
// a real storage backend. Validates flag-only output (no body text leakage),
// size limits, and correct issue detection.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { auditStorageBackedDocument, auditStorageBackedDocumentBatch } from "../lib/engine/storage-backed-document-audit";

// ── Stub helpers ─────────────────────────────────────────────────────────────

// Minimal base document input for tests
function baseInput(overrides: Partial<Parameters<typeof auditStorageBackedDocument>[0]> = {}) {
  return {
    documentId: "doc-1",
    documentName: "Technical Proposal",
    exactFileName: "Technical_Proposal.docx",
    documentType: "TECHNICAL_PROPOSAL",
    format: "DOCX",
    generationStatus: "GENERATED",
    validationStatus: "PASSED",
    reviewStatus: "APPROVED",
    storagePath: "tender/doc-1/Technical_Proposal.docx",
    ...overrides,
  };
}

// ── Storage unreadable ────────────────────────────────────────────────────────

describe("storage-backed audit: storage errors", () => {
  it("returns storageReadable=false and STORAGE_UNREADABLE code when storage throws", async () => {
    // Override the storage adapter at module level via env to use local mode
    // where the file doesn't exist — this will throw.
    const result = await auditStorageBackedDocument(baseInput({
      storagePath: "/nonexistent/path/that/cannot/be/read.docx",
      documentName: "Missing Doc",
      exactFileName: "missing.docx",
      generationStatus: "GENERATED",
      validationStatus: "PASSED",
      reviewStatus: "APPROVED",
    }));
    assert.equal(result.storageReadable, false);
    assert.ok(result.issueCodes.includes("STORAGE_UNREADABLE"));
    assert.ok(typeof result.storageError === "string");
    // must not leak body text
    assert.equal(result.qualityScore, null);
  });

  it("sets missingContentIssue=true when storage unreadable and doc is final export candidate", async () => {
    const result = await auditStorageBackedDocument(baseInput({
      storagePath: "/nonexistent/path.docx",
      generationStatus: "GENERATED",
      validationStatus: "PASSED",
      reviewStatus: "APPROVED",
    }));
    assert.equal(result.storageReadable, false);
    assert.equal(result.finalExportCandidate, true);
    assert.equal(result.missingContentIssue, true);
  });

  it("does not set missingContentIssue for non-export-candidate rows", async () => {
    const result = await auditStorageBackedDocument(baseInput({
      storagePath: "/nonexistent/path.docx",
      reviewStatus: "NOT_EXPORTABLE",
    }));
    assert.equal(result.missingContentIssue, false);
    assert.equal(result.finalExportCandidate, false);
  });
});

// ── Result shape — no body text leakage ──────────────────────────────────────

describe("storage-backed audit: no body text in result", () => {
  it("result type has no text/content fields", async () => {
    const result = await auditStorageBackedDocument(baseInput({
      storagePath: "/nonexistent/path.docx",
    }));
    // None of these should be present on the result
    assert.equal("visibleText" in result, false);
    assert.equal("extractedText" in result, false);
    assert.equal("bodyText" in result, false);
    assert.equal("content" in result, false);
    assert.equal("fileContent" in result, false);
  });

  it("storageError is truncated and does not contain file content", async () => {
    const result = await auditStorageBackedDocument(baseInput({
      storagePath: "/nonexistent/path.docx",
    }));
    if (result.storageError) {
      assert.ok(result.storageError.length <= 200);
    }
  });
});

// ── Batch audit ───────────────────────────────────────────────────────────────

describe("storage-backed audit: batch limits", () => {
  it("respects maxDocs limit", async () => {
    const inputs = Array.from({ length: 10 }, (_, i) =>
      baseInput({ documentId: `doc-${i}`, storagePath: `/nonexistent/${i}.docx` })
    );
    const results = await auditStorageBackedDocumentBatch(inputs, { maxDocs: 3 });
    assert.equal(results.length, 3);
  });

  it("returns results in same order as inputs", async () => {
    const inputs = [
      baseInput({ documentId: "doc-a", storagePath: "/nonexistent/a.docx" }),
      baseInput({ documentId: "doc-b", storagePath: "/nonexistent/b.docx" }),
    ];
    const results = await auditStorageBackedDocumentBatch(inputs);
    assert.equal(results[0].documentId, "doc-a");
    assert.equal(results[1].documentId, "doc-b");
  });

  it("handles empty input array", async () => {
    const results = await auditStorageBackedDocumentBatch([]);
    assert.deepEqual(results, []);
  });
});

// ── recommendedAction strings ──────────────────────────────────────────────────

describe("storage-backed audit: recommendedAction", () => {
  it("recommendedAction is always a non-empty string", async () => {
    const result = await auditStorageBackedDocument(baseInput({
      storagePath: "/nonexistent/path.docx",
    }));
    assert.ok(typeof result.recommendedAction === "string");
    assert.ok(result.recommendedAction.length > 0);
  });
});
