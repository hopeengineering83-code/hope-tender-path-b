// Verifies that filterFinalExportCandidateDocuments() (used by Bid Control,
// the canonical readiness helper, the download route, and the admin audit
// endpoint) excludes every internal/control row type the spec lists, and
// still admits a valid READY_FOR_EXPORT row.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterFinalExportCandidateDocuments,
  isFinalExportCandidateDocument,
  isValidationPassed,
} from "../lib/engine/document-output-state";

type Doc = Parameters<typeof isFinalExportCandidateDocument>[0];

function doc(overrides: Partial<Doc>): Doc {
  return {
    id: "x",
    name: "Technical Proposal",
    exactFileName: "Technical-Proposal.docx",
    documentType: "TECHNICAL_PROPOSAL",
    format: "DOCX",
    fileContent: null,
    storagePath: null,
    generationStatus: "GENERATED",
    validationStatus: "VALIDATED",
    reviewStatus: "READY_FOR_EXPORT",
    ...overrides,
  };
}

describe("final-export-candidate exclusions", () => {
  it("SUPERSEDED is excluded", () => {
    assert.equal(isFinalExportCandidateDocument(doc({ generationStatus: "SUPERSEDED" })), false);
    assert.equal(isFinalExportCandidateDocument(doc({ validationStatus: "SUPERSEDED" })), false);
  });
  it("PLANNED is excluded", () => {
    assert.equal(isFinalExportCandidateDocument(doc({ generationStatus: "PLANNED" })), false);
  });
  it("CONTROL format is excluded", () => {
    assert.equal(isFinalExportCandidateDocument(doc({ format: "CONTROL" })), false);
  });
  it("SUBMISSION_CONTROL / SUBMISSION_RULES document types are excluded", () => {
    assert.equal(isFinalExportCandidateDocument(doc({ documentType: "SUBMISSION_CONTROL" })), false);
    assert.equal(isFinalExportCandidateDocument(doc({ documentType: "SUBMISSION_RULES" })), false);
  });
  it("NOT_EXPORTABLE / REPLACE_WITH_ORIGINAL review statuses are excluded", () => {
    assert.equal(isFinalExportCandidateDocument(doc({ reviewStatus: "NOT_EXPORTABLE" })), false);
    assert.equal(isFinalExportCandidateDocument(doc({ reviewStatus: "REPLACE_WITH_ORIGINAL" })), false);
  });
  it("QUICK_DRAFT / DRAFT_ONLY are excluded via internal-draft heuristic", () => {
    assert.equal(isFinalExportCandidateDocument(doc({ name: "AI Proposal (Quick Draft)", documentType: "TECHNICAL_PROPOSAL" })), false);
    assert.equal(isFinalExportCandidateDocument(doc({ documentType: "DRAFT_ONLY" })), false);
  });

  it("a valid READY_FOR_EXPORT row IS admitted", () => {
    assert.equal(isFinalExportCandidateDocument(doc({})), true);
  });

  it("filterFinalExportCandidateDocuments preserves valid rows and drops every spec-listed exclusion", () => {
    const rows: Doc[] = [
      doc({ id: "valid", name: "Technical Proposal" }),
      doc({ id: "superseded", generationStatus: "SUPERSEDED" }),
      doc({ id: "planned", generationStatus: "PLANNED" }),
      doc({ id: "control", format: "CONTROL" }),
      doc({ id: "not-exportable", reviewStatus: "NOT_EXPORTABLE" }),
      doc({ id: "replace-original", reviewStatus: "REPLACE_WITH_ORIGINAL" }),
      doc({ id: "quick-draft", name: "AI Proposal (Quick Draft)" }),
      doc({ id: "draft-only", documentType: "DRAFT_ONLY" }),
      doc({ id: "submission-rules", documentType: "SUBMISSION_RULES" }),
      doc({ id: "submission-control", documentType: "SUBMISSION_CONTROL" }),
    ];
    const out = filterFinalExportCandidateDocuments(rows);
    assert.deepEqual(out.map((r) => r.id), ["valid"]);
  });
});

describe("isValidationPassed — PASSED and VALIDATED treated identically", () => {
  it("accepts both PASSED and VALIDATED", () => {
    assert.equal(isValidationPassed("PASSED"), true);
    assert.equal(isValidationPassed("VALIDATED"), true);
  });
  it("rejects everything else", () => {
    assert.equal(isValidationPassed("PENDING"), false);
    assert.equal(isValidationPassed("FAILED"), false);
    assert.equal(isValidationPassed(null), false);
    assert.equal(isValidationPassed(undefined), false);
    assert.equal(isValidationPassed("NEEDS_REVALIDATION"), false);
  });
});
