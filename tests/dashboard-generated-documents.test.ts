import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { prepareDashboardGeneratedDocuments } from "../lib/dashboard-generated-documents";

describe("dashboard generated document filtering", () => {
  it("hides superseded, typo-superseded, planned-only and duplicate rows", () => {
    const docs = [
      { id: "old-1", name: "Technical-Proposal.docx", exactFileName: "Technical-Proposal.docx", generationStatus: "SUPERSEDED", validationStatus: "SUPERSEDED", reviewStatus: "SUPERSEDED" },
      { id: "old-typo", name: "Old.docx", exactFileName: "Old.docx", generationStatus: "SUPSERSEDED", validationStatus: "SUPSERSEDED", reviewStatus: "SUPSERSEDED" },
      { id: "planned", name: "Expert CV Package.docx", exactFileName: "Expert CV Package.docx", generationStatus: "PLANNED", validationStatus: "PENDING", reviewStatus: "PENDING" },
      { id: "current", name: "Technical Proposal", exactFileName: "Technical-Proposal.docx", exactOrder: 1, generationStatus: "GENERATED", validationStatus: "PASSED", reviewStatus: "READY_FOR_EXPORT" },
      { id: "duplicate", name: "Technical Proposal", exactFileName: "Technical-Proposal.docx", exactOrder: 1, generationStatus: "GENERATED", validationStatus: "PASSED", reviewStatus: "READY_FOR_EXPORT" },
      { id: "original", name: "Financial evidence", exactFileName: "Financial evidence.docx", exactOrder: 2, generationStatus: "GENERATED", validationStatus: "PENDING", reviewStatus: "REPLACE_WITH_ORIGINAL" },
    ];

    const result = prepareDashboardGeneratedDocuments(docs);

    assert.deepEqual(result.documents.map((doc) => doc.id), ["current", "original"]);
    assert.equal(result.summary.total, 6);
    assert.equal(result.summary.shown, 2);
    assert.equal(result.summary.hiddenHistorical, 2);
    assert.equal(result.summary.hiddenPlanned, 1);
    assert.equal(result.summary.hiddenDuplicates, 1);
    assert.equal(result.summary.readyForExport, 1);
    assert.equal(result.summary.replacementRequired, 1);
  });

  it("keeps distinct current generated files sorted by readiness and order", () => {
    const docs = [
      { id: "b", name: "B", exactFileName: "B.docx", exactOrder: 2, generationStatus: "GENERATED", validationStatus: "PENDING", reviewStatus: "PENDING" },
      { id: "a", name: "A", exactFileName: "A.docx", exactOrder: 1, generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "READY_FOR_EXPORT" },
      { id: "c", name: "C", exactFileName: "C.docx", exactOrder: 3, generationStatus: "GENERATED", validationStatus: "NEEDS_REVALIDATION", reviewStatus: "PENDING" },
    ];

    const result = prepareDashboardGeneratedDocuments(docs);
    assert.deepEqual(result.documents.map((doc) => doc.id), ["a", "c", "b"]);
    assert.equal(result.summary.hiddenHistorical, 0);
    assert.equal(result.summary.hiddenPlanned, 0);
    assert.equal(result.summary.hiddenDuplicates, 0);
  });
});
