// Gap 2: Send every generated or repaired document through the existing
// canonical Document Validator. Persist VALIDATED only after real
// validation passes.
//
// The auto-finalize continuation service now has a Step 3 that calls
// checkFullExportReadiness (the same function /api/tenders/:id/validate
// uses) and persists validationStatus=VALIDATED ONLY for documents with
// zero failures. Documents with failures are set to FAILED. Documents
// not in PENDING state are left alone.
//
// This is the SINGLE authority for validationStatus=VALIDATED in the
// automatic pipeline. No other code path may write it.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const service = readFileSync("lib/ai-jobs/auto-finalize-continuation-service.ts", "utf8");

describe("Gap 2 — canonical Document Validator is the single VALIDATED authority", () => {
  it("imports checkFullExportReadiness from the canonical export-readiness module", () => {
    assert.match(service, /checkFullExportReadiness/);
    assert.match(service, /export-readiness/);
  });

  it("has a runCanonicalValidation function", () => {
    assert.match(service, /async function runCanonicalValidation/);
  });

  it("calls checkFullExportReadiness on all non-superseded documents", () => {
    assert.match(service, /checkFullExportReadiness\(/);
    assert.match(service, /generationStatus: \{ not: "SUPERSEDED" \}/);
  });

  it("collects failed documentIds from the readiness result", () => {
    assert.match(service, /readiness\.failures\.map/);
    assert.match(service, /failedDocIds/);
  });

  it("persists VALIDATED only for documents NOT in the failed set", () => {
    assert.match(service, /const passes = !failedDocIds\.has\(doc\.id\)/);
    assert.match(service, /validationStatus: passes \? "VALIDATED" : "FAILED"/);
  });

  it("only auto-validates documents currently in PENDING state", () => {
    assert.match(service, /if \(doc\.validationStatus !== "PENDING"\)/);
  });

  it("verifies tenant ownership before reading/writing documents (Gap B)", () => {
    assert.match(service, /where: \{ id: tenderId, userId \}/);
  });

  it("records a canonical-validation step in the job progress", () => {
    assert.match(service, /stepName: "auto-finalize\.canonical-validation"/);
    assert.match(service, /stepName: "auto-finalize\.canonical-validation\.complete"/);
  });

  it("never fabricates VALIDATED — failures stay FAILED", () => {
    // The code must explicitly set FAILED for documents with failures,
    // not leave them at PENDING or silently mark them VALIDATED.
    assert.match(service, /validationStatus: passes \? "VALIDATED" : "FAILED"/);
  });

  it("returns validation counts (validated, failed, pending)", () => {
    assert.match(service, /validation: \{ validated: number; failed: number; pending: number \}/);
  });
});
