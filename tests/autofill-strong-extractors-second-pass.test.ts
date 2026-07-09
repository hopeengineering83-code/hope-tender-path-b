// autoFillTenderMetadata now runs the strong extractors from #523 as a SECOND
// PASS for any field that the conservative inferTenderMetadata left null. The
// user-facing pain — "the app asks me to fill metadata even though the tender
// file plainly carries the value" — is addressed by silently calling the
// extractors on every engine run, no Repair-button click required.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("auto-fill — strong-extractor second pass wiring", () => {
  const src = readFileSync("lib/engine/auto-fill-tender-metadata.ts", "utf8");

  it("imports every #523 field extractor + the methodology extractor", () => {
    for (const fn of [
      "extractReference",
      "extractDeadline",
      "extractSubmissionEmails",
      "extractSubmissionMethod",
      "extractPageLimit",
      "extractValidityDays",
      "extractBidBondAmount",
      "extractNumberOfCopies",
      "extractMandatorySiteVisit",
      "extractEvaluationMethodologyFromSource",
    ]) {
      assert.match(src, new RegExp(fn));
    }
  });

  it("only runs the second-pass extractor when the field is still empty", () => {
    assert.match(src, /function shouldFillScalar/);
    assert.match(src, /if \(shouldFillScalar\("reference"/);
    assert.match(src, /if \(shouldFillScalar\("deadline"/);
    assert.match(src, /if \(shouldFillScalar\("submissionEmails"/);
    assert.match(src, /if \(shouldFillScalar\("submissionMethod"/);
    assert.match(src, /if \(shouldFillScalar\("pageLimit"/);
    assert.match(src, /if \(shouldFillScalar\("validityDays"/);
    assert.match(src, /if \(shouldFillScalar\("bidBondAmount"/);
    assert.match(src, /if \(shouldFillScalar\("numberOfCopiesRequired"/);
    assert.match(src, /if \(shouldFillScalar\("evaluationMethodology"/);
  });

  it("never patches a percent-only bid bond (no honest absolute amount)", () => {
    assert.match(src, /r\.value\.amount > 0\s*&&\s*r\.value\.currency !== "PERCENT"/);
  });

  it("preserves the no-overwrite rule (filled.includes guard inside shouldFillScalar)", () => {
    assert.match(src, /if \(filled\.includes\(field\)\) return false/);
  });

  it("evaluationMethodology field is part of the TenderForAutoFill type", () => {
    assert.match(src, /evaluationMethodology\?:\s*string \| null/);
  });
});

describe("generate route — metadata is non-blocking for draft work", () => {
  const src = readFileSync("app/api/tenders/[id]/generate/route.ts", "utf8");
  it("does NOT return CLIENT_NAME_REQUIRED 422", () => {
    assert.doesNotMatch(src, /errorCode.*CLIENT_NAME_REQUIRED/);
  });
  it("does NOT return PLACEHOLDER_CLIENT_NAME 422", () => {
    assert.doesNotMatch(src, /errorCode.*PLACEHOLDER_CLIENT_NAME/);
  });
  it("does NOT return METADATA_VALIDATION_FAILED 422", () => {
    assert.doesNotMatch(src, /errorCode.*METADATA_VALIDATION_FAILED/);
  });
  it("does NOT return CRITICAL_METADATA_MISSING 422", () => {
    assert.doesNotMatch(src, /errorCode.*CRITICAL_METADATA_MISSING/);
  });
  it("does NOT return METADATA_INCOMPLETE 422", () => {
    assert.doesNotMatch(src, /errorCode.*METADATA_INCOMPLETE/);
  });
});

describe("readiness helper — FULL_PROPOSAL_METADATA_INCOMPLETE blocker mirrors the new copy", () => {
  const src = readFileSync("lib/tender-generation-readiness.ts", "utf8");
  it("the warning message mentions repair (not a hard blocker)", () => {
    assert.doesNotMatch(src, /Tender details incomplete/);
  });
  it("nextAction is REPAIR_OR_EDIT_TENDER", () => {
    assert.match(src, /nextAction:\s*"REPAIR_OR_EDIT_TENDER"/);
  });
});
