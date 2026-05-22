// Unit tests for export-readiness gates covering QUICK_DRAFT blocking,
// NOT_EXPORTABLE blocking, and the zero-documents gate.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { deriveDocumentOutputState, EXPORT_BLOCKING_STATES } from "../lib/engine/document-output-state";
import { checkExportReadiness } from "../lib/engine/export-readiness";

describe("document-output-state — draft/non-exportable blocking", () => {
  it("QUICK_DRAFT documentType → CONTROL_RECORD_ONLY (blocked)", () => {
    const state = deriveDocumentOutputState({
      generationStatus: "GENERATED",
      validationStatus: "PENDING",
      reviewStatus: "PENDING",
      documentType: "QUICK_DRAFT",
      format: null,
      fileContent: "abc",
    });
    assert.ok(
      (EXPORT_BLOCKING_STATES as readonly string[]).includes(state),
      `expected blocking state, got ${state}`,
    );
  });

  it("MARKDOWN format → CONTROL_RECORD_ONLY (blocked)", () => {
    const state = deriveDocumentOutputState({
      generationStatus: "GENERATED",
      validationStatus: "PENDING",
      reviewStatus: "PENDING",
      documentType: null,
      format: "MARKDOWN",
      fileContent: "# draft",
    });
    assert.ok(
      (EXPORT_BLOCKING_STATES as readonly string[]).includes(state),
      `expected blocking state, got ${state}`,
    );
  });

  it("NOT_EXPORTABLE reviewStatus → ORIGINAL_REQUIRED (blocked)", () => {
    const state = deriveDocumentOutputState({
      generationStatus: "GENERATED",
      validationStatus: "PENDING",
      reviewStatus: "NOT_EXPORTABLE",
      documentType: null,
      format: null,
      fileContent: "abc",
    });
    assert.equal(state, "ORIGINAL_REQUIRED");
    assert.ok((EXPORT_BLOCKING_STATES as readonly string[]).includes("ORIGINAL_REQUIRED"));
  });

  it("REPLACE_WITH_ORIGINAL → ORIGINAL_REQUIRED (still blocked)", () => {
    const state = deriveDocumentOutputState({
      generationStatus: "GENERATED",
      validationStatus: "PENDING",
      reviewStatus: "REPLACE_WITH_ORIGINAL",
      documentType: null,
      format: null,
      fileContent: null,
    });
    assert.equal(state, "ORIGINAL_REQUIRED");
  });
});

describe("checkExportReadiness — zero documents gate", () => {
  it("returns ok=false when docs array is empty", () => {
    const result = checkExportReadiness([]);
    assert.equal(result.ok, false);
    assert.ok(result.failures.length > 0);
    assert.ok(/NO_ACTIVE_GENERATED_DOCUMENTS|zero active|at least one/i.test(result.failures[0].reasons[0]));
  });

  it("QUICK_DRAFT document cannot export", () => {
    const result = checkExportReadiness([{
      id: "d1",
      name: "Quick Draft",
      exactFileName: "draft.md",
      generationStatus: "GENERATED",
      validationStatus: "PENDING",
      reviewStatus: "NOT_EXPORTABLE",
      documentType: "QUICK_DRAFT",
      format: "MARKDOWN",
      fileContent: "# draft",
    }]);
    assert.equal(result.ok, false);
  });

  it("NOT_EXPORTABLE document cannot export", () => {
    const result = checkExportReadiness([{
      id: "d2",
      name: "Background Draft",
      exactFileName: "proposal.md",
      generationStatus: "GENERATED",
      validationStatus: "PENDING",
      reviewStatus: "NOT_EXPORTABLE",
      documentType: null,
      format: "MARKDOWN",
      fileContent: "# draft",
    }]);
    assert.equal(result.ok, false);
  });
});
