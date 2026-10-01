import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isFinalExportCandidateDocument,
  deriveDocumentOutputState,
  exportBlockReason,
  isExportReady,
} from "../lib/engine/document-output-state";

const READY_DOC = {
  name: "Technical Proposal.docx",
  exactFileName: "Technical_Proposal.docx",
  documentType: "TECHNICAL",
  format: "DOCX",
  generationStatus: "GENERATED",
  validationStatus: "VALIDATED",
  reviewStatus: "READY_FOR_EXPORT",
  fileContent: "UEsDBBQAAAAA", // minimal base64 DOCX magic (PK\x03\x04 header, >= 8 chars required)
  storagePath: null,
};

describe("Final Package Manifest — isFinalExportCandidateDocument", () => {
  it("includes a normal generated TECHNICAL doc", () => {
    assert.equal(isFinalExportCandidateDocument(READY_DOC), true);
  });

  it("excludes a SUPERSEDED doc", () => {
    assert.equal(
      isFinalExportCandidateDocument({ ...READY_DOC, generationStatus: "SUPERSEDED" }),
      false,
    );
  });

  it("excludes a PLANNED doc", () => {
    assert.equal(
      isFinalExportCandidateDocument({ ...READY_DOC, generationStatus: "PLANNED" }),
      false,
    );
  });

  it("excludes a NOT_EXPORTABLE review-status doc", () => {
    assert.equal(
      isFinalExportCandidateDocument({ ...READY_DOC, reviewStatus: "NOT_EXPORTABLE" }),
      false,
    );
  });

  it("excludes a REPLACE_WITH_ORIGINAL doc", () => {
    assert.equal(
      isFinalExportCandidateDocument({ ...READY_DOC, reviewStatus: "REPLACE_WITH_ORIGINAL" }),
      false,
    );
  });

  it("excludes a CONTROL-format doc", () => {
    assert.equal(
      isFinalExportCandidateDocument({ ...READY_DOC, format: "CONTROL" }),
      false,
    );
  });

  it("excludes SUBMISSION_CONTROL document type", () => {
    assert.equal(
      isFinalExportCandidateDocument({ ...READY_DOC, documentType: "SUBMISSION_CONTROL" }),
      false,
    );
  });

  it("excludes an internal quick-draft document by name pattern", () => {
    assert.equal(
      isFinalExportCandidateDocument({ ...READY_DOC, name: "AI Proposal (Quick Draft)" }),
      false,
    );
  });
});

describe("Final Package Manifest — deriveDocumentOutputState", () => {
  it("returns READY_FOR_EXPORT for validated+reviewed doc with content", () => {
    assert.equal(deriveDocumentOutputState(READY_DOC), "READY_FOR_EXPORT");
  });

  it("returns CONTROL_RECORD_ONLY for doc with no content and no storagePath", () => {
    assert.equal(
      deriveDocumentOutputState({ ...READY_DOC, fileContent: null, storagePath: null }),
      "CONTROL_RECORD_ONLY",
    );
  });

  it("returns SUPERSEDED for superseded doc", () => {
    assert.equal(
      deriveDocumentOutputState({ ...READY_DOC, generationStatus: "SUPERSEDED" }),
      "SUPERSEDED",
    );
  });

  it("returns ORIGINAL_REQUIRED for REPLACE_WITH_ORIGINAL", () => {
    assert.equal(
      deriveDocumentOutputState({ ...READY_DOC, reviewStatus: "REPLACE_WITH_ORIGINAL" }),
      "ORIGINAL_REQUIRED",
    );
  });

  it("returns NEEDS_REVALIDATION when validationStatus is NEEDS_REVALIDATION", () => {
    assert.equal(
      deriveDocumentOutputState({ ...READY_DOC, validationStatus: "NEEDS_REVALIDATION", reviewStatus: null }),
      "NEEDS_REVALIDATION",
    );
  });
});

describe("Final Package Manifest — isExportReady", () => {
  it("doc with validated+reviewed content is export ready", () => {
    assert.equal(isExportReady(READY_DOC), true);
  });

  it("doc without content is not export ready", () => {
    assert.equal(isExportReady({ ...READY_DOC, fileContent: null, storagePath: null }), false);
  });

  it("validated doc is export ready even without human review approval (Gap C: VALIDATED is sufficient)", () => {
    // Gap C: per Gap 5, VALIDATED is sufficient for the automatic path.
    // The canonical Document Validator is the machine-safe authority.
    assert.equal(
      isExportReady({ ...READY_DOC, reviewStatus: "PENDING_REVIEW" }),
      true,
    );
  });
});

describe("Final Package Manifest — exportBlockReason", () => {
  it("returns null for READY_FOR_EXPORT", () => {
    assert.equal(exportBlockReason("READY_FOR_EXPORT"), null);
  });

  it("returns a string for CONTROL_RECORD_ONLY", () => {
    assert.ok(typeof exportBlockReason("CONTROL_RECORD_ONLY") === "string");
  });

  it("returns a string for ORIGINAL_REQUIRED", () => {
    assert.ok(typeof exportBlockReason("ORIGINAL_REQUIRED") === "string");
  });

  it("returns a string for SUPERSEDED", () => {
    assert.ok(typeof exportBlockReason("SUPERSEDED") === "string");
  });

  it("CONTROL_RECORD_ONLY block reason mentions generate or attach", () => {
    const reason = exportBlockReason("CONTROL_RECORD_ONLY") ?? "";
    assert.ok(/generate|attach/i.test(reason));
  });

  it("ORIGINAL_REQUIRED block reason mentions original", () => {
    const reason = exportBlockReason("ORIGINAL_REQUIRED") ?? "";
    assert.ok(/original/i.test(reason));
  });
});
