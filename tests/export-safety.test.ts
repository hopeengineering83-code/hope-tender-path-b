import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isFinalExportCandidateDocument } from "../lib/engine/document-output-state";

describe("Final export filtering — exclusions", () => {
  const base = { generationStatus: "GENERATED", validationStatus: "PASSED", reviewStatus: "READY_FOR_EXPORT" };

  it("excludes SUPERSEDED generationStatus", () => {
    assert.ok(!isFinalExportCandidateDocument({ ...base, generationStatus: "SUPERSEDED" }));
  });

  it("excludes PLANNED generationStatus", () => {
    assert.ok(!isFinalExportCandidateDocument({ ...base, generationStatus: "PLANNED" }));
  });

  it("excludes NOT_EXPORTABLE reviewStatus", () => {
    assert.ok(!isFinalExportCandidateDocument({ ...base, reviewStatus: "NOT_EXPORTABLE" }));
  });

  it("excludes REPLACE_WITH_ORIGINAL reviewStatus", () => {
    assert.ok(!isFinalExportCandidateDocument({ ...base, reviewStatus: "REPLACE_WITH_ORIGINAL" }));
  });

  it("excludes CONTROL format", () => {
    assert.ok(!isFinalExportCandidateDocument({ ...base, format: "CONTROL" }));
  });

  it("excludes SUBMISSION_RULES documentType", () => {
    assert.ok(!isFinalExportCandidateDocument({ ...base, documentType: "SUBMISSION_RULES" }));
  });

  it("excludes SUBMISSION_CONTROL documentType", () => {
    assert.ok(!isFinalExportCandidateDocument({ ...base, documentType: "SUBMISSION_CONTROL" }));
  });

  it("excludes QUICK_DRAFT documentType", () => {
    assert.ok(!isFinalExportCandidateDocument({ ...base, documentType: "QUICK_DRAFT" }));
  });

  it("excludes DRAFT_ONLY name", () => {
    assert.ok(!isFinalExportCandidateDocument({ ...base, name: "draft_only version" }));
  });

  it("allows valid READY_FOR_EXPORT document", () => {
    assert.ok(isFinalExportCandidateDocument(base));
  });

  it("allows VALIDATED document without reviewStatus issues", () => {
    assert.ok(isFinalExportCandidateDocument({ ...base, reviewStatus: "APPROVED" }));
  });
});
