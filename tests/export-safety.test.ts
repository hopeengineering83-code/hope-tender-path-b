// Focused export-safety tests — pins all exclusion rules for
// isFinalExportCandidateDocument and key ZIP pre-check behaviours.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isFinalExportCandidateDocument,
  filterFinalExportCandidateDocuments,
  isInternalDraftDocument,
} from "../lib/engine/document-output-state";

// ─── isFinalExportCandidateDocument — exclusions ──────────────────────────

describe("Final export filtering — exclusions", () => {
  const base = { generationStatus: "GENERATED", validationStatus: "PASSED", reviewStatus: "READY_FOR_EXPORT" };

  it("excludes SUPERSEDED generationStatus", () => {
    assert.ok(!isFinalExportCandidateDocument({ ...base, generationStatus: "SUPERSEDED" }));
  });

  it("excludes SUPERSEDED validationStatus", () => {
    assert.ok(!isFinalExportCandidateDocument({ ...base, validationStatus: "SUPERSEDED" }));
  });

  it("excludes PLANNED generationStatus", () => {
    assert.ok(!isFinalExportCandidateDocument({ ...base, generationStatus: "PLANNED" }));
  });

  it("excludes NOT_EXPORTABLE reviewStatus", () => {
    assert.ok(!isFinalExportCandidateDocument({ ...base, reviewStatus: "NOT_EXPORTABLE" }));
  });

  it("excludes REPLACE_WITH_ORIGINAL reviewStatus — official-original placeholder never enters ZIP", () => {
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

  it("excludes document with 'quick draft' in name", () => {
    assert.ok(!isFinalExportCandidateDocument({ ...base, name: "AI Proposal (Quick Draft)" }));
  });

  it("allows valid READY_FOR_EXPORT document", () => {
    assert.ok(isFinalExportCandidateDocument(base));
  });

  it("allows APPROVED reviewStatus document", () => {
    assert.ok(isFinalExportCandidateDocument({ ...base, reviewStatus: "APPROVED" }));
  });

  it("allows valid document with exactFileName and format", () => {
    assert.ok(isFinalExportCandidateDocument({
      ...base,
      format: "DOCX",
      documentType: "TECHNICAL_PROPOSAL",
      exactFileName: "Technical-Proposal.docx",
    }));
  });
});

// ─── filterFinalExportCandidateDocuments — bulk filtering ─────────────────

describe("filterFinalExportCandidateDocuments — removes all non-export rows", () => {
  const ready = { id: "r1", generationStatus: "GENERATED", validationStatus: "PASSED", reviewStatus: "READY_FOR_EXPORT" };

  it("keeps only export-ready documents", () => {
    const docs = [
      { ...ready, id: "r1" },
      { ...ready, id: "r2", reviewStatus: "REPLACE_WITH_ORIGINAL" },
      { ...ready, id: "r3", generationStatus: "SUPERSEDED" },
      { ...ready, id: "r4", documentType: "SUBMISSION_RULES" },
      { ...ready, id: "r5", documentType: "QUICK_DRAFT" },
    ];
    const result = filterFinalExportCandidateDocuments(docs);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "r1");
  });

  it("returns empty array when all docs are non-exportable", () => {
    const docs = [
      { ...ready, reviewStatus: "REPLACE_WITH_ORIGINAL" },
      { ...ready, generationStatus: "PLANNED", validationStatus: "PENDING", reviewStatus: "PENDING" },
      { ...ready, documentType: "SUBMISSION_CONTROL" },
    ];
    assert.equal(filterFinalExportCandidateDocuments(docs).length, 0);
  });

  it("returns all docs when all are export-ready", () => {
    const docs = [
      { ...ready, id: "a" },
      { ...ready, id: "b" },
      { ...ready, id: "c" },
    ];
    assert.equal(filterFinalExportCandidateDocuments(docs).length, 3);
  });
});

// ─── isInternalDraftDocument ──────────────────────────────────────────────

describe("isInternalDraftDocument — internal workspace rows", () => {
  it("detects QUICK_DRAFT documentType", () => {
    assert.ok(isInternalDraftDocument({ documentType: "QUICK_DRAFT" }));
  });

  it("detects draft_only in name", () => {
    assert.ok(isInternalDraftDocument({ name: "draft_only workspace copy" }));
  });

  it("detects AI Proposal (Quick Draft) name pattern", () => {
    assert.ok(isInternalDraftDocument({ name: "AI Proposal (Quick Draft)" }));
  });

  it("detects markdown non-exportable row", () => {
    assert.ok(isInternalDraftDocument({ format: "MARKDOWN", reviewStatus: "NOT_EXPORTABLE" }));
  });

  it("does NOT flag a clean technical proposal", () => {
    assert.ok(!isInternalDraftDocument({ name: "Technical Proposal", documentType: "TECHNICAL_PROPOSAL", format: "DOCX" }));
  });
});

// ─── ZIP pre-check logic: DOCUMENTS_MISSING_CONTENT ──────────────────────
// Tests the logic used in app/api/tenders/[id]/download/route.ts to detect
// documents that have neither fileContent nor storagePath before starting
// the ZIP loop.

describe("ZIP pre-check — DOCUMENTS_MISSING_CONTENT detection logic", () => {
  type DocEntry = { id: string; name: string; fileContent: string | null; storagePath: string | null };

  function findMissingContent(docs: DocEntry[]): DocEntry[] {
    return docs.filter((d) => !d.fileContent && !d.storagePath);
  }

  it("identifies docs with no fileContent and no storagePath", () => {
    const docs: DocEntry[] = [
      { id: "d1", name: "Technical Proposal", fileContent: "base64content", storagePath: null },
      { id: "d2", name: "CV Package", fileContent: null, storagePath: "/storage/cv.docx" },
      { id: "d3", name: "Methodology", fileContent: null, storagePath: null },
    ];
    const missing = findMissingContent(docs);
    assert.equal(missing.length, 1);
    assert.equal(missing[0].id, "d3");
    assert.equal(missing[0].name, "Methodology");
  });

  it("returns empty array when all docs have content", () => {
    const docs: DocEntry[] = [
      { id: "d1", name: "Doc A", fileContent: "abc", storagePath: null },
      { id: "d2", name: "Doc B", fileContent: null, storagePath: "/storage/b.docx" },
    ];
    assert.equal(findMissingContent(docs).length, 0);
  });

  it("a storage-backed file is not considered missing (has storagePath)", () => {
    const doc: DocEntry = { id: "d1", name: "Official Original", fileContent: null, storagePath: "/storage/original.pdf" };
    assert.equal(findMissingContent([doc]).length, 0);
  });

  it("REPLACE_WITH_ORIGINAL is excluded from ZIP candidates before the content check", () => {
    // The content check only runs on docs that passed filterFinalExportCandidateDocuments.
    // REPLACE_WITH_ORIGINAL docs are excluded before reaching the content check.
    const officialOriginalPlaceholder = {
      generationStatus: "GENERATED",
      validationStatus: "PASSED",
      reviewStatus: "REPLACE_WITH_ORIGINAL",
      fileContent: null,
      storagePath: null,
    };
    assert.equal(
      isFinalExportCandidateDocument(officialOriginalPlaceholder),
      false,
      "REPLACE_WITH_ORIGINAL is excluded before the content check runs",
    );
  });
});
