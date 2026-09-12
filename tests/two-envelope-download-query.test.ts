// Verifies the envelope-query parsing used by the download route's strict
// two-envelope handling. The integration test (mixed-ZIP rejection,
// per-envelope filename) is exercised via Vercel preview manual smoke; this
// file pins the pure behaviour.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferEnvelope } from "../lib/engine/submission-plan";
import { detectSubmissionPackageMode } from "../lib/engine/submission-package-mode";

describe("envelope inference — TECHNICAL / FINANCIAL / ADMIN", () => {
  it("classifies FINANCIAL files by keyword", () => {
    assert.equal(inferEnvelope("FINANCIAL", "Financial-Proposal.xlsx"), "FINANCIAL");
    assert.equal(inferEnvelope("TECHNICAL", "Bill-of-Quantities.xlsx"), "FINANCIAL");
    assert.equal(inferEnvelope("TECHNICAL", "Rate-Card.docx"), "FINANCIAL");
    assert.equal(inferEnvelope("TECHNICAL", "Price-Schedule.pdf"), "FINANCIAL");
  });
  it("classifies ADMIN/eligibility files by keyword", () => {
    // The adminRx in inferEnvelope() requires word boundaries with
    // whitespace (e.g. "bid bond" not "bid-bond"), so we use file names
    // that match those boundaries the regex actually recognises.
    assert.equal(inferEnvelope("DECLARATION", "Declaration of Eligibility.docx"), "ADMIN");
    assert.equal(inferEnvelope("ADMIN", "Bid bond.pdf"), "ADMIN");
    assert.equal(inferEnvelope("TECHNICAL", "Annex A.docx"), "ADMIN");
    assert.equal(inferEnvelope("TECHNICAL", "Tender Form.docx"), "ADMIN");
  });
  it("defaults to TECHNICAL for everything else", () => {
    assert.equal(inferEnvelope("TECHNICAL", "Technical-Proposal.docx"), "TECHNICAL");
    assert.equal(inferEnvelope("TECHNICAL", "Methodology.docx"), "TECHNICAL");
    assert.equal(inferEnvelope("FORM", "Technical Proposal.pdf"), "TECHNICAL");
  });
});

describe("strict two-envelope detection", () => {
  it("makes separate packages executable instead of blocking all ZIP export", () => {
    const mode = detectSubmissionPackageMode({
      submissionMethod: "Sealed bid",
      analysisSummary: "Bidders shall submit the Technical Proposal and Financial Proposal in separate sealed envelopes.",
    });
    assert.equal(mode.mode, "SEPARATE_TECHNICAL_FINANCIAL");
    assert.equal(mode.blockingForZip, false);
    assert.match(mode.reason, /isolated Technical, Financial.*Admin ZIPs/i);
  });
  it("does NOT flag separate-envelope when ToR explicitly allows a single ZIP", () => {
    const mode = detectSubmissionPackageMode({
      submissionMethod: "Online portal",
      analysisSummary: "Bidders shall submit a single ZIP file with all required documents.",
    });
    assert.notEqual(mode.mode, "SEPARATE_TECHNICAL_FINANCIAL");
  });
});
