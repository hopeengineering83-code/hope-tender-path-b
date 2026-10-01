// Regression tests for Gap 10 — document output state machine.
//
// Pins the spec's nine state buckets and the export-blocking rule:
// the only state that may pass the export gate is READY_FOR_EXPORT.
// A planned .pdf with DOCX content must NEVER be treated as PDF_GENERATED.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  deriveDocumentOutputState,
  isExportReady,
  exportBlockReason,
  EXPORT_BLOCKING_STATES,
  type DocumentLike,
} from "../lib/engine/document-output-state";

// Real DOCX / PDF base64 headers — first 4 bytes is enough for the
// magic-byte sniff. PK\x03\x04 = ZIP/DOCX, %PDF- = PDF.
const DOCX_HEADER_BASE64 = Buffer.from("PK\x03\x04xx_DOCX_PAYLOAD_PLACEHOLDER").toString("base64");
const PDF_HEADER_BASE64 = Buffer.from("%PDF-1.4_PAYLOAD_PLACEHOLDER").toString("base64");
const NOT_BINARY = "This is just plain text content, not a real DOCX or PDF.";

function doc(fields: Partial<DocumentLike>): DocumentLike {
  return { id: "d1", name: "Test", ...fields };
}

describe("document-output-state — terminal blocking states", () => {
  it("SUPERSEDED when generationStatus is SUPERSEDED", () => {
    assert.equal(deriveDocumentOutputState(doc({ generationStatus: "SUPERSEDED" })), "SUPERSEDED");
  });

  it("SUPERSEDED when validationStatus is SUPERSEDED", () => {
    assert.equal(deriveDocumentOutputState(doc({ validationStatus: "SUPERSEDED" })), "SUPERSEDED");
  });

  it("NEEDS_REVALIDATION when validationStatus is NEEDS_REVALIDATION", () => {
    assert.equal(deriveDocumentOutputState(doc({ validationStatus: "NEEDS_REVALIDATION" })), "NEEDS_REVALIDATION");
  });

  it("ORIGINAL_REQUIRED when reviewStatus is REPLACE_WITH_ORIGINAL", () => {
    assert.equal(deriveDocumentOutputState(doc({ reviewStatus: "REPLACE_WITH_ORIGINAL" })), "ORIGINAL_REQUIRED");
  });

  it("CONTROL_RECORD_ONLY when no fileContent at all", () => {
    assert.equal(deriveDocumentOutputState(doc({ exactFileName: "anything.docx" })), "CONTROL_RECORD_ONLY");
  });
});

describe("document-output-state — planned .pdf vs actual content", () => {
  it("PDF_CONVERSION_REQUIRED when planned .pdf but content is DOCX", () => {
    const d = doc({ exactFileName: "Technical Proposal.pdf", fileContent: DOCX_HEADER_BASE64 });
    assert.equal(deriveDocumentOutputState(d), "PDF_CONVERSION_REQUIRED");
  });

  it("PDF_CONVERSION_REQUIRED when planned .pdf but content is plain text", () => {
    const d = doc({ exactFileName: "Technical Proposal.pdf", fileContent: NOT_BINARY });
    assert.equal(deriveDocumentOutputState(d), "PDF_CONVERSION_REQUIRED");
  });

  it("PDF_GENERATED when planned .pdf and content is a real PDF", () => {
    const d = doc({ exactFileName: "Technical Proposal.pdf", fileContent: PDF_HEADER_BASE64 });
    assert.equal(deriveDocumentOutputState(d), "PDF_GENERATED");
  });

  it("does NOT call it PDF_GENERATED when content is DOCX (the canonical truthfulness bug)", () => {
    const d = doc({ exactFileName: "Bid Submission.pdf", fileContent: DOCX_HEADER_BASE64 });
    assert.notEqual(deriveDocumentOutputState(d), "PDF_GENERATED");
  });
});

describe("document-output-state — DOCX content", () => {
  it("DOCX_GENERATED when planned .docx and content is DOCX", () => {
    const d = doc({ exactFileName: "Cover Letter.docx", fileContent: DOCX_HEADER_BASE64 });
    assert.equal(deriveDocumentOutputState(d), "DOCX_GENERATED");
  });

  it("READY_FOR_EXPORT when DOCX content + validationStatus VALIDATED (Gap C: VALIDATED is sufficient)", () => {
    const d = doc({ exactFileName: "Cover Letter.docx", fileContent: DOCX_HEADER_BASE64, validationStatus: "VALIDATED" });
    // Gap C: VALIDATED alone is now sufficient for READY_FOR_EXPORT —
    // the canonical Document Validator is the machine-safe authority.
    assert.equal(deriveDocumentOutputState(d), "READY_FOR_EXPORT");
  });

  it("READY_FOR_EXPORT when DOCX content + VALIDATED + READY_FOR_EXPORT review", () => {
    const d = doc({
      exactFileName: "Cover Letter.docx",
      fileContent: DOCX_HEADER_BASE64,
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
    });
    assert.equal(deriveDocumentOutputState(d), "READY_FOR_EXPORT");
    assert.equal(isExportReady(d), true);
  });
});

describe("document-output-state — export gate", () => {
  it("only READY_FOR_EXPORT passes isExportReady", () => {
    assert.equal(isExportReady(doc({ exactFileName: "x.docx", fileContent: DOCX_HEADER_BASE64 })), false);
    assert.equal(isExportReady(doc({ validationStatus: "SUPERSEDED" })), false);
    assert.equal(isExportReady(doc({ validationStatus: "NEEDS_REVALIDATION" })), false);
    assert.equal(isExportReady(doc({ reviewStatus: "REPLACE_WITH_ORIGINAL" })), false);
    assert.equal(isExportReady(doc({})), false);
    assert.equal(isExportReady(doc({
      exactFileName: "x.docx",
      fileContent: DOCX_HEADER_BASE64,
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
    })), true);
  });

  it("all 5 blocking states are present in EXPORT_BLOCKING_STATES", () => {
    for (const state of ["CONTROL_RECORD_ONLY", "ORIGINAL_REQUIRED", "PDF_CONVERSION_REQUIRED", "SUPERSEDED", "NEEDS_REVALIDATION"]) {
      assert.ok(EXPORT_BLOCKING_STATES.includes(state as never), `${state} should be in EXPORT_BLOCKING_STATES`);
    }
  });

  it("exportBlockReason returns null only for READY_FOR_EXPORT", () => {
    assert.equal(exportBlockReason("READY_FOR_EXPORT"), null);
    for (const state of EXPORT_BLOCKING_STATES) {
      const reason = exportBlockReason(state);
      assert.ok(reason && reason.length > 0, `${state} should have a non-empty block reason`);
    }
  });
});

describe("document-output-state — resolution order (regression)", () => {
  it("SUPERSEDED beats all other signals", () => {
    const d = doc({
      exactFileName: "x.pdf",
      fileContent: PDF_HEADER_BASE64,
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
      generationStatus: "SUPERSEDED",
    });
    assert.equal(deriveDocumentOutputState(d), "SUPERSEDED");
  });

  it("NEEDS_REVALIDATION beats validated content", () => {
    const d = doc({
      exactFileName: "x.docx",
      fileContent: DOCX_HEADER_BASE64,
      validationStatus: "NEEDS_REVALIDATION",
    });
    assert.equal(deriveDocumentOutputState(d), "NEEDS_REVALIDATION");
  });

  it("ORIGINAL_REQUIRED beats content presence", () => {
    const d = doc({
      exactFileName: "license.pdf",
      fileContent: PDF_HEADER_BASE64,
      reviewStatus: "REPLACE_WITH_ORIGINAL",
    });
    assert.equal(deriveDocumentOutputState(d), "ORIGINAL_REQUIRED");
  });
});

describe("document-output-state — metadata-only byte hints", () => {
  it("treats inline bytes as present without loading fileContent", () => {
    const d = doc({ exactFileName: "Cover Letter.docx", hasInlineFileContent: true });
    assert.equal(deriveDocumentOutputState(d), "DOCX_GENERATED");
  });

  it("can surface ready status from metadata-only inline bytes after validation and review", () => {
    const d = doc({
      exactFileName: "Cover Letter.docx",
      hasInlineFileContent: true,
      validationStatus: "VALIDATED",
      reviewStatus: "READY_FOR_EXPORT",
    });
    assert.equal(deriveDocumentOutputState(d), "READY_FOR_EXPORT");
  });
});
