import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { deriveDocumentOutputState } from "../lib/engine/document-output-state";

describe("original-required export repair policy", () => {
  it("keeps replace-with-original rows as original-required blockers", () => {
    const state = deriveDocumentOutputState({
      id: "form-1",
      name: "Tender Form.docx",
      exactFileName: "Tender Form.docx",
      generationStatus: "GENERATED",
      validationStatus: "NEEDS_REVALIDATION",
      reviewStatus: "REPLACE_WITH_ORIGINAL",
      documentType: "FORM_OR_ANNEX",
      format: "DOCX",
      fileContent: null,
    });

    assert.equal(state, "ORIGINAL_REQUIRED");
  });

  it("keeps not-exportable rows as original-required blockers", () => {
    const state = deriveDocumentOutputState({
      id: "draft-1",
      name: "Official template placeholder",
      exactFileName: "Official template placeholder.docx",
      generationStatus: "GENERATED",
      validationStatus: "PENDING",
      reviewStatus: "NOT_EXPORTABLE",
      documentType: "CONTROL",
      format: "DOCX",
      fileContent: null,
    });

    assert.equal(state, "ORIGINAL_REQUIRED");
  });

  it("does not classify planned-only rows as export-ready", () => {
    const state = deriveDocumentOutputState({
      id: "planned-1",
      name: "Financial schedule",
      exactFileName: "Financial schedule.docx",
      generationStatus: "PLANNED",
      validationStatus: "PENDING",
      reviewStatus: "PENDING",
      documentType: "FORM_OR_ANNEX",
      format: "DOCX",
      fileContent: null,
    });

    assert.equal(state, "CONTROL_RECORD_ONLY");
  });
});
