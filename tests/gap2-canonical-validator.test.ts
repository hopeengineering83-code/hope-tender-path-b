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
    assert.match(service, /readiness\.failures/);
    assert.match(service, /\.map\(\(f\) => f\.documentId\)/);
    assert.match(service, /failedDocIds/);
  });

  it("excludes only circular workflow reasons, never real rejections", () => {
    // The failed set is built from readiness.failures, but two of those reasons
    // are not rejections: "reviewStatus is ..." is a review-workflow state, and
    // "validationStatus is ..." is the very field this function decides, so
    // using it as evidence is circular. Counting them downgraded freshly
    // finalized, byte-verified documents to FAILED.
    //
    // This pins the narrowing itself: content and integrity reasons — the ones
    // that matter — must still land a document in the failed set.
    assert.match(service, /isReviewWorkflowReason/);
    assert.match(service, /\^reviewStatus is /);
    assert.match(service, /\^validationStatus is /);
    // A document is failed when it has ANY reason that is not one of those two
    // workflow reasons, so every content and integrity rejection still counts.
    assert.match(service, /some\(\(reason\) => !isReviewWorkflowReason\(reason\)\)/);
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
    // The inline shape became the named CanonicalValidationOutcome when the
    // outcome gained the rejected documents — "1 auto-finalized PDF(s) failed
    // canonical validation" named neither the file nor the defect. The three
    // counts are still the contract, so assert them on the type rather than on
    // one literal spelling of it.
    assert.match(service, /validation: CanonicalValidationOutcome;/);
    assert.match(service, /pdfValidation: CanonicalValidationOutcome;/);
    assert.match(
      service,
      /export type CanonicalValidationOutcome = \{\s*validated: number;\s*failed: number;\s*pending: number;/,
    );
  });

  it("names the documents it rejected, so the blocker can be acted on", () => {
    assert.match(service, /rejected: Array<\{ documentId: string; fileName: string; reasons: string\[\] \}>;/);
    assert.match(service, /function namedRejections\(/);
  });
});
