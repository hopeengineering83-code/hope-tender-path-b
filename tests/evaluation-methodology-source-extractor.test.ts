// Deterministic evaluationMethodology extractor — pure-function unit tests.
// Verifies the extractor across realistic tender prose styles, never invents,
// and surfaces explicit `found:false` with a reason when no section matches.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractEvaluationMethodologyFromSource,
  formatExtractionForAudit,
  type EvaluationCriteriaExtractionFound,
} from "../lib/engine/analysis/evaluation-methodology-source-extractor";

describe("extractEvaluationMethodologyFromSource", () => {
  it("returns found:false with a reason when no plausible section exists", () => {
    const r = extractEvaluationMethodologyFromSource({
      files: [{ fileName: "scope-only.pdf", extractedText: "This RFP describes a clinical needs assessment and supervision visits. No scoring described here." }],
    });
    assert.equal(r.found, false);
    if (r.found === false) assert.match(r.reason, /No evaluation methodology/i);
  });

  it("finds a HIGH-confidence Technical/Financial 80/20 split (donor / ICB style)", () => {
    const text = `
12. Evaluation Methodology

Proposals will be evaluated in two stages:

12.1 Technical Proposal (80 marks)
   Methodology and approach: 25 marks
   Key Personnel CVs: 30 marks
   Similar Experience: 25 marks

12.2 Financial Proposal (20 marks)

The Combined score will be used to rank bidders.
`;
    const r = extractEvaluationMethodologyFromSource({
      files: [{ fileName: "rfp.pdf", extractedText: text }],
    });
    assert.equal(r.found, true);
    if (r.found) {
      assert.equal(r.confidence, "HIGH");
      assert.equal(r.sourceFile, "rfp.pdf");
      const labels = r.items.map((i) => i.label);
      assert.ok(labels.includes("Technical Proposal"));
      assert.ok(labels.includes("Financial Proposal"));
      assert.ok(r.methodologyText.startsWith("Evaluation Methodology") || r.methodologyText.includes("Evaluation Methodology"));
      assert.ok(r.sourceQuote.length > 0 && r.sourceQuote.length <= 400);
    }
  });

  it("finds a 70/30 percent split as HIGH confidence (totals ≈100%)", () => {
    const text = `
5. Evaluation Criteria

The combined score is derived as follows:
- Technical Proposal: weight = 70%
- Financial Proposal: weight = 30%

Pass/Fail prequalification applies to mandatory documents.
`;
    const r = extractEvaluationMethodologyFromSource({
      files: [{ fileName: "rfp.docx", extractedText: text }],
    });
    assert.equal(r.found, true);
    if (r.found) {
      assert.equal(r.confidence, "HIGH");
      const tech = r.items.find((i) => i.label === "Technical Proposal");
      const fin = r.items.find((i) => i.label === "Financial Proposal");
      assert.equal(tech?.weight, 70);
      assert.equal(fin?.weight, 30);
      assert.equal(tech?.weightUnit, "PERCENT");
    }
  });

  it("downgrades to MEDIUM when only a scoring header is present without 100% totals", () => {
    const text = `
8. Scoring Methodology

Bidders will be assessed on Methodology and Key Personnel quality. Weights
will be confirmed at contract negotiation stage.
`;
    const r = extractEvaluationMethodologyFromSource({
      files: [{ fileName: "rfp.docx", extractedText: text }],
    });
    assert.equal(r.found, true);
    if (r.found) {
      assert.ok(r.confidence === "MEDIUM" || r.confidence === "LOW");
      assert.ok(r.items.some((i) => i.label === "Methodology"));
    }
  });

  it("picks the higher-confidence file when several files match", () => {
    const weak = "Evaluation Stage 1: Responsiveness Check applied.";
    const strong = `
Evaluation Methodology
Technical Proposal: 70%
Financial Proposal: 30%
Methodology and Approach: 30 marks
`;
    const r = extractEvaluationMethodologyFromSource({
      files: [
        { fileName: "addendum-1.pdf", extractedText: weak },
        { fileName: "main-rfp.pdf", extractedText: strong },
      ],
    });
    assert.equal(r.found, true);
    if (r.found) assert.equal(r.sourceFile, "main-rfp.pdf");
  });

  it("does not invent content — methodologyText is sliced from source", () => {
    const text = `
2. Evaluation Criteria
Technical Proposal scoring: 60%
Financial Proposal scoring: 40%
This section ends here. Annex 1 begins below.
`;
    const r = extractEvaluationMethodologyFromSource({
      files: [{ fileName: "rfp.pdf", extractedText: text }],
    });
    assert.equal(r.found, true);
    if (r.found) {
      // Every non-trivial chunk of methodologyText (16+ chars) must be a
      // substring of the original source text (modulo whitespace collapse).
      const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
      const sourceNormalized = normalize(text);
      const methodNormalized = normalize(r.methodologyText);
      // The methodology text should be derivable from the source — check
      // that a healthy 60-char window from the middle is present in source.
      const sample = methodNormalized.slice(20, 80);
      assert.ok(sourceNormalized.includes(sample), `methodologyText must be source-grounded; missing fragment: "${sample}"`);
    }
  });

  it("respects MAX_METHODOLOGY_CHARS (≤3000 chars)", () => {
    const text = `Evaluation Methodology\n${"Technical Proposal scoring details. ".repeat(500)}`;
    const r = extractEvaluationMethodologyFromSource({
      files: [{ fileName: "rfp.pdf", extractedText: text }],
    });
    assert.equal(r.found, true);
    if (r.found) assert.ok(r.methodologyText.length <= 3000);
  });

  it("ignores files with no extracted text", () => {
    const r = extractEvaluationMethodologyFromSource({
      files: [
        { fileName: "image-only.png", extractedText: null },
        { fileName: "empty.pdf", extractedText: "" },
      ],
    });
    assert.equal(r.found, false);
  });

  it("formatExtractionForAudit produces a bounded, item-aware summary", () => {
    const found: EvaluationCriteriaExtractionFound = {
      found: true,
      methodologyText: "Evaluation Methodology Technical 70% Financial 30%",
      sourceQuote: "Evaluation Methodology Technical 70% Financial 30%",
      sourceFile: "rfp.pdf",
      confidence: "HIGH",
      items: [
        { label: "Technical Proposal", weight: 70, weightUnit: "PERCENT", isPassFail: false, fromQuote: "Technical Proposal: 70%" },
        { label: "Financial Proposal", weight: 30, weightUnit: "PERCENT", isPassFail: false, fromQuote: "Financial Proposal: 30%" },
      ],
    };
    const line = formatExtractionForAudit(found);
    assert.match(line, /HIGH confidence/);
    assert.match(line, /Technical Proposal 70%/);
    assert.match(line, /Financial Proposal 30%/);
    assert.ok(line.length <= 600);
  });
});
