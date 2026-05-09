// G7 — export readiness pure-function tests.
// Covers checkExportReadiness + exportReadinessError. The DB-dependent
// checkTenderLevelExportBlockers is integration-level and not covered
// here.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { checkExportReadiness, exportReadinessError, isReadyForFinalExport } from "../lib/engine/export-readiness";

const READY = { id: "doc-1", name: "Cover Letter", exactFileName: "Cover-Letter.docx", generationStatus: "GENERATED", validationStatus: "VALIDATED", reviewStatus: "READY_FOR_EXPORT", fileContent: "AA==" };

describe("isReadyForFinalExport", () => {
  it("returns true when all three statuses are correct", () => {
    assert.equal(isReadyForFinalExport(READY), true);
  });
  it("returns false when reviewStatus is PENDING", () => {
    assert.equal(isReadyForFinalExport({ ...READY, reviewStatus: "PENDING" }), false);
  });
});

describe("checkExportReadiness", () => {
  it("returns ok=true for a single ready doc", () => {
    const res = checkExportReadiness([READY]);
    assert.equal(res.ok, true);
    assert.equal(res.failures.length, 0);
  });

  it("flags every wrong status with a clear reason", () => {
    const bad = { ...READY, generationStatus: "FAILED", reviewStatus: "PENDING" };
    const res = checkExportReadiness([bad]);
    assert.equal(res.ok, false);
    assert.equal(res.failures.length, 1);
    const reasons = res.failures[0].reasons;
    assert.ok(reasons.some((r) => r.includes("generationStatus")));
    assert.ok(reasons.some((r) => r.includes("reviewStatus")));
  });

  it("requires fileContent when option is set", () => {
    const noContent = { ...READY, fileContent: null };
    const res = checkExportReadiness([noContent], { requireFileContent: true });
    assert.equal(res.ok, false);
    assert.ok(res.failures[0].reasons.some((r) => r.includes("fileContent is missing")));
  });
});

describe("exportReadinessError", () => {
  it("returns empty string when nothing is wrong", () => {
    assert.equal(exportReadinessError([]), "");
  });
  it("includes blocker title and recommended action", () => {
    const msg = exportReadinessError([], [{
      category: "EVALUATOR_EVAL_CRITERION_MISS",
      severity: "HIGH",
      title: "Healthcare design depth not demonstrated",
      recommendedAction: "Add IPC and clinical workflow paragraphs to Section C",
    }]);
    assert.ok(msg.includes("Healthcare design depth"));
    assert.ok(msg.includes("Action: Add IPC"));
  });
  it("includes file-level reasons when failures present", () => {
    const msg = exportReadinessError([{
      documentId: "doc-1", name: "Cover Letter", fileName: "Cover-Letter.docx",
      reasons: ["reviewStatus is PENDING, expected READY_FOR_EXPORT"],
    }]);
    assert.ok(msg.includes("Cover-Letter.docx"));
    assert.ok(msg.includes("reviewStatus"));
  });
});
