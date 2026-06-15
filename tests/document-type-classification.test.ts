// tests/document-type-classification.test.ts
//
// Tests for document-type-aware quality gating and normalization.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectDocumentGatingCategory, assessGeneratedDocumentQuality } from "../lib/engine/quality/document-quality-gate";
import { normalizeDocumentType, requiresOfficialOriginal, isControlDocument } from "../lib/engine/documents/document-type-normalizer";

describe("detectDocumentGatingCategory", () => {
  it("classifies financial evidence docs as FINANCIAL_OFFICIAL", () => {
    assert.strictEqual(detectDocumentGatingCategory("financial capacity and audited statement evidence 0"), "FINANCIAL_OFFICIAL");
    assert.strictEqual(detectDocumentGatingCategory("audited financial statements 2023"), "FINANCIAL_OFFICIAL");
    assert.strictEqual(detectDocumentGatingCategory("bank statement evidence"), "FINANCIAL_OFFICIAL");
  });

  it("classifies submission rules as SUBMISSION_CONTROL", () => {
    assert.strictEqual(detectDocumentGatingCategory("submission formatting, file and packaging rules"), "SUBMISSION_CONTROL");
    assert.strictEqual(detectDocumentGatingCategory("submission method and deadline rules"), "SUBMISSION_CONTROL");
    assert.strictEqual(detectDocumentGatingCategory("delivery instruction document"), "SUBMISSION_CONTROL");
  });

  it("classifies bid forms as BID_FORM", () => {
    assert.strictEqual(detectDocumentGatingCategory("bid form completed"), "BID_FORM");
    assert.strictEqual(detectDocumentGatingCategory("declaration of eligibility"), "BID_FORM");
    assert.strictEqual(detectDocumentGatingCategory("integrity pact"), "BID_FORM");
  });

  it("classifies technical proposals as NARRATIVE", () => {
    assert.strictEqual(detectDocumentGatingCategory("technical proposal"), "NARRATIVE");
    assert.strictEqual(detectDocumentGatingCategory("methodology and work plan"), "NARRATIVE");
    assert.strictEqual(detectDocumentGatingCategory("company profile and experience"), "NARRATIVE");
  });

  it("respects documentType field over label matching", () => {
    assert.strictEqual(detectDocumentGatingCategory("technical proposal", "FINANCIAL_EVIDENCE"), "FINANCIAL_OFFICIAL");
    assert.strictEqual(detectDocumentGatingCategory("big document", "SUBMISSION_RULES"), "SUBMISSION_CONTROL");
  });
});

describe("assessGeneratedDocumentQuality — non-narrative docs", () => {
  it("returns PASSED for submission control docs without gating", () => {
    const result = assessGeneratedDocumentQuality({
      doc: { name: "Submission formatting, file and packaging rules", documentType: "SUBMISSION_RULES" },
      visibleText: "Submit via portal by 5pm. Max 50MB per file.",
    });
    assert.strictEqual(result.recommendedStatus, "PASSED");
    assert.strictEqual(result.issues.length, 0);
    assert.ok(result.notes.some((n) => /control record/i.test(n)));
  });

  it("does NOT apply narrative quality gate to financial evidence", () => {
    const result = assessGeneratedDocumentQuality({
      doc: { name: "Financial capacity and audited statement evidence 0", documentType: "TECHNICAL_PROPOSAL" },
      visibleText: "Placeholder for tender-issued original",
    });
    // Should NOT return QUALITY_FAILED with full narrative reasons
    assert.strictEqual(result.notes.some((n) => /non-narrative/i.test(n)), true);
  });

  it("still detects AI traces in financial evidence placeholders", () => {
    const result = assessGeneratedDocumentQuality({
      doc: { name: "Audited financial statement 2023", documentType: "FINANCIAL_EVIDENCE" },
      visibleText: "As an AI, I cannot provide actual audited financial statements.",
    });
    assert.ok(result.issues.some((i) => i.code === "AI_TRACE"));
  });

  it("applies full narrative gate to technical proposals", () => {
    const result = assessGeneratedDocumentQuality({
      doc: { name: "Technical Proposal", documentType: "TECHNICAL_PROPOSAL" },
      visibleText: "Our approach is holistic. We will leverage synergies. TODO: fill in methodology.",
    });
    assert.ok(result.issues.some((i) => i.code === "BID_TEAM_TO_CONFIRM" || i.code === "PLACEHOLDER" || i.code === "GENERIC_FILLER"));
  });
});

describe("normalizeDocumentType", () => {
  it("reclassifies TECHNICAL_PROPOSAL financial evidence docs", () => {
    assert.strictEqual(normalizeDocumentType("Financial capacity and audited statement evidence 0", "evidence_0.docx", "TECHNICAL_PROPOSAL"), "FINANCIAL_EVIDENCE");
    assert.strictEqual(normalizeDocumentType("Audited financial statements", null, "TECHNICAL_PROPOSAL"), "FINANCIAL_EVIDENCE");
  });

  it("reclassifies TECHNICAL_PROPOSAL submission rules docs", () => {
    assert.strictEqual(normalizeDocumentType("Submission formatting, file and packaging rules", null, "TECHNICAL_PROPOSAL"), "SUBMISSION_RULES");
  });

  it("does NOT reclassify correctly-typed docs", () => {
    assert.strictEqual(normalizeDocumentType("Technical Proposal Volume 1", null, "TECHNICAL_PROPOSAL"), "TECHNICAL_PROPOSAL");
    assert.strictEqual(normalizeDocumentType("Methodology Section", null, "METHODOLOGY"), "METHODOLOGY");
  });

  it("does NOT reclassify null/undefined types as wrong type", () => {
    // Financial evidence with no existing type → classify correctly
    assert.strictEqual(normalizeDocumentType("Audited financial statements", null, null), "FINANCIAL_EVIDENCE");
  });
});

describe("requiresOfficialOriginal + isControlDocument", () => {
  it("flags official original types", () => {
    assert.strictEqual(requiresOfficialOriginal("FINANCIAL_EVIDENCE"), true);
    assert.strictEqual(requiresOfficialOriginal("LEGAL_EVIDENCE"), true);
    assert.strictEqual(requiresOfficialOriginal("BID_FORM"), true);
    assert.strictEqual(requiresOfficialOriginal("TECHNICAL_PROPOSAL"), false);
  });

  it("flags control types", () => {
    assert.strictEqual(isControlDocument("SUBMISSION_RULES"), true);
    assert.strictEqual(isControlDocument("TECHNICAL_PROPOSAL"), false);
  });
});
