// Extended unit tests for containsPricingLeakage, isSensitiveFinancialOrLegalDoc,
// isCvOrProfileDoc, and isFinalExportCandidateDocument.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  containsPricingLeakage,
  isCvOrProfileDoc,
  isSensitiveFinancialOrLegalDoc,
  isMixedTechnicalFinancialSentence,
} from "../lib/engine/pricing-hygiene";
import {
  isFinalExportCandidateDocument,
} from "../lib/engine/document-output-state";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function techDoc(name: string) {
  return { name, exactFileName: null, documentType: "TECHNICAL", format: "DOCX" };
}

function financialDoc(name: string) {
  return { name, exactFileName: null, documentType: "FINANCIAL", format: "DOCX" };
}

function cvDoc(name: string) {
  return { name, exactFileName: null, documentType: "CV", format: "DOCX" };
}

// ---------------------------------------------------------------------------
// containsPricingLeakage — should flag technical docs with currency amounts
// ---------------------------------------------------------------------------

describe("containsPricingLeakage — currency amounts in technical docs", () => {
  it("flags USD amount in a technical methodology document", () => {
    const text = "The project will be delivered using proven methodology. Total cost: USD 250,000.";
    assert.ok(containsPricingLeakage(text, techDoc("Technical Methodology")));
  });

  it("flags ETB amount in a technical workplan document", () => {
    const text = "Implementation approach covers all phases. Budget allocated: ETB 1,500,000.";
    assert.ok(containsPricingLeakage(text, { name: "Work Plan", exactFileName: null, documentType: "WORKPLAN", format: "DOCX" }));
  });

  it("flags dollar symbol with number in a technical approach document", () => {
    const text = "Our team will deliver the required scope. Consultancy fee is $45,000.";
    assert.ok(containsPricingLeakage(text, techDoc("Technical Approach")));
  });

  it("flags euro symbol with number", () => {
    const text = "Methodology follows standard engineering practices. Project budget is €80,000.";
    assert.ok(containsPricingLeakage(text, techDoc("Technical Methodology")));
  });

  it("flags Birr currency with number", () => {
    const text = "The implementation plan is comprehensive. Lump sum: Birr 900,000.";
    assert.ok(containsPricingLeakage(text, techDoc("Implementation Plan")));
  });
});

// ---------------------------------------------------------------------------
// containsPricingLeakage — should flag bill of quantities and BoQ
// ---------------------------------------------------------------------------

describe("containsPricingLeakage — bill of quantities in technical docs", () => {
  it("flags 'bill of quantities' standalone in a technical document", () => {
    const text = "Refer to the bill of quantities for detailed costing.";
    assert.ok(containsPricingLeakage(text, techDoc("Technical Proposal")));
  });

  it("flags 'BoQ' standalone in a technical document", () => {
    const text = "All items are listed in the BoQ attached separately.";
    assert.ok(containsPricingLeakage(text, techDoc("Technical Methodology")));
  });

  it("flags 'financial proposal' referenced in technical document body", () => {
    // This is not a safe disclaimer — it's an embedded financial reference with rates
    const text = "The financial proposal includes a daily rate of $450 per consultant day.";
    assert.ok(containsPricingLeakage(text, techDoc("Technical Approach")));
  });

  it("flags 'commercial proposal' in a technical document", () => {
    const text = "Our commercial proposal includes itemized rates.";
    assert.ok(containsPricingLeakage(text, techDoc("Technical Methodology")));
  });

  it("flags 'quotation' in a technical document", () => {
    const text = "The quotation for each work package is detailed below.";
    assert.ok(containsPricingLeakage(text, techDoc("Technical Approach")));
  });
});

// ---------------------------------------------------------------------------
// containsPricingLeakage — should NOT flag CVs or cover letters
// ---------------------------------------------------------------------------

describe("containsPricingLeakage — does NOT flag CVs or cover letters", () => {
  it("does not flag a CV that mentions project scope reference", () => {
    const text = "Managed a USD 5M road construction project for the Ministry of Transport.";
    assert.ok(!containsPricingLeakage(text, cvDoc("Senior Engineer CV")));
  });

  it("does not flag a cover letter mentioning budget experience", () => {
    const text = "Our team has managed budgets of over USD 10,000,000 on similar assignments.";
    assert.ok(!containsPricingLeakage(text, { name: "Cover Letter", exactFileName: null, documentType: null, format: "DOCX" }));
  });

  it("does not flag a curriculum vitae with fee history", () => {
    const text = "Provided consultancy services with fees of EUR 50,000 per annum.";
    const doc = { name: "Curriculum Vitae", exactFileName: null, documentType: "CV", format: "DOCX" };
    assert.ok(!containsPricingLeakage(text, doc));
  });
});

// ---------------------------------------------------------------------------
// containsPricingLeakage — should NOT flag financial statement documents
// ---------------------------------------------------------------------------

describe("containsPricingLeakage — does NOT flag financial statement documents", () => {
  it("does not flag an audited financial statement document", () => {
    const text = "Audited financial statements for fiscal year 2023 showing turnover of ETB 12,000,000.";
    const doc = { name: "Audited Financial Statement", exactFileName: null, documentType: null, format: "DOCX" };
    assert.ok(!containsPricingLeakage(text, doc));
  });

  it("does not flag a bank statement document", () => {
    const text = "Bank statement showing account balance of USD 500,000 as of 31 December 2023.";
    const doc = { name: "Bank Statement", exactFileName: null, documentType: null, format: "DOCX" };
    assert.ok(!containsPricingLeakage(text, doc));
  });

  it("does not flag a tax clearance certificate", () => {
    const text = "Tax clearance certificate confirming tax payments of ETB 2,500,000.";
    const doc = { name: "Tax Clearance Certificate", exactFileName: null, documentType: null, format: "DOCX" };
    assert.ok(!containsPricingLeakage(text, doc));
  });

  it("does not flag a VAT certificate document", () => {
    const text = "VAT registration certificate with VAT number 12345678.";
    const doc = { name: "VAT Certificate", exactFileName: null, documentType: null, format: "DOCX" };
    assert.ok(!containsPricingLeakage(text, doc));
  });

  it("does not flag a bid form / tender form document", () => {
    const text = "Bid form: Total bid amount USD 1,250,000.";
    const doc = { name: "Bid Form", exactFileName: null, documentType: null, format: "DOCX" };
    assert.ok(!containsPricingLeakage(text, doc));
  });
});

// ---------------------------------------------------------------------------
// containsPricingLeakage — safe 'not-included' sentences should not trigger
// ---------------------------------------------------------------------------

describe("containsPricingLeakage — safe 'not-included' sentences", () => {
  it("does not flag 'financial proposal is submitted separately'", () => {
    const text = "The financial proposal is submitted separately in a sealed envelope per tender instructions.";
    assert.ok(!containsPricingLeakage(text, techDoc("Technical Proposal")));
  });

  it("does not flag 'commercial offer is submitted separately'", () => {
    const text = "The commercial offer is submitted separately as required.";
    assert.ok(!containsPricingLeakage(text, techDoc("Methodology Document")));
  });

  it("does not flag 'prices not included' disclaimer", () => {
    const text = "No price information is included in this technical document.";
    assert.ok(!containsPricingLeakage(text, techDoc("Technical Approach")));
  });
});

// ---------------------------------------------------------------------------
// isFinalExportCandidateDocument — should exclude SUPERSEDED, PLANNED, CONTROL, NOT_EXPORTABLE
// ---------------------------------------------------------------------------

describe("isFinalExportCandidateDocument — exclusion rules", () => {
  it("excludes SUPERSEDED generationStatus", () => {
    assert.ok(!isFinalExportCandidateDocument({ generationStatus: "SUPERSEDED", validationStatus: "PASSED", reviewStatus: "READY_FOR_EXPORT" }));
  });

  it("excludes SUPERSEDED validationStatus", () => {
    assert.ok(!isFinalExportCandidateDocument({ generationStatus: "GENERATED", validationStatus: "SUPERSEDED", reviewStatus: "READY_FOR_EXPORT" }));
  });

  it("excludes PLANNED generationStatus", () => {
    assert.ok(!isFinalExportCandidateDocument({ generationStatus: "PLANNED", validationStatus: "PENDING", reviewStatus: "PENDING" }));
  });

  it("excludes CONTROL format", () => {
    assert.ok(!isFinalExportCandidateDocument({ generationStatus: "GENERATED", validationStatus: "PASSED", reviewStatus: "READY_FOR_EXPORT", format: "CONTROL" }));
  });

  it("excludes NOT_EXPORTABLE reviewStatus", () => {
    assert.ok(!isFinalExportCandidateDocument({ generationStatus: "GENERATED", validationStatus: "PASSED", reviewStatus: "NOT_EXPORTABLE" }));
  });

  it("excludes REPLACE_WITH_ORIGINAL reviewStatus", () => {
    assert.ok(!isFinalExportCandidateDocument({ generationStatus: "GENERATED", validationStatus: "PASSED", reviewStatus: "REPLACE_WITH_ORIGINAL" }));
  });

  it("excludes SUBMISSION_CONTROL documentType", () => {
    assert.ok(!isFinalExportCandidateDocument({ generationStatus: "GENERATED", validationStatus: "PASSED", reviewStatus: "READY_FOR_EXPORT", documentType: "SUBMISSION_CONTROL" }));
  });

  it("excludes SUBMISSION_RULES documentType", () => {
    assert.ok(!isFinalExportCandidateDocument({ generationStatus: "GENERATED", validationStatus: "PASSED", reviewStatus: "READY_FOR_EXPORT", documentType: "SUBMISSION_RULES" }));
  });

  it("excludes QUICK_DRAFT internal documents", () => {
    assert.ok(!isFinalExportCandidateDocument({ generationStatus: "GENERATED", validationStatus: "PASSED", reviewStatus: "READY_FOR_EXPORT", documentType: "QUICK_DRAFT" }));
  });

  it("includes a well-formed READY_FOR_EXPORT document", () => {
    assert.ok(isFinalExportCandidateDocument({
      generationStatus: "GENERATED",
      validationStatus: "PASSED",
      reviewStatus: "READY_FOR_EXPORT",
      format: "DOCX",
      documentType: "TECHNICAL",
    }));
  });
});

// ---------------------------------------------------------------------------
// isSensitiveFinancialOrLegalDoc — correctly identifies sensitive docs
// ---------------------------------------------------------------------------

describe("isSensitiveFinancialOrLegalDoc — bid forms, tax certs, audited statements", () => {
  it("identifies 'bid form' as sensitive", () => {
    assert.ok(isSensitiveFinancialOrLegalDoc({ name: "Bid Form", exactFileName: null, documentType: null, format: null }));
  });

  it("identifies 'tender form' as sensitive", () => {
    assert.ok(isSensitiveFinancialOrLegalDoc({ name: "Tender Form", exactFileName: null, documentType: null, format: null }));
  });

  it("identifies 'tax clearance' as sensitive", () => {
    assert.ok(isSensitiveFinancialOrLegalDoc({ name: "Tax Clearance Certificate", exactFileName: null, documentType: null, format: null }));
  });

  it("identifies 'audited financial statements' as sensitive", () => {
    assert.ok(isSensitiveFinancialOrLegalDoc({ name: "Audited Financial Statement 2023", exactFileName: null, documentType: null, format: null }));
  });

  it("identifies 'bank statement' as sensitive", () => {
    assert.ok(isSensitiveFinancialOrLegalDoc({ name: "Bank Statement", exactFileName: null, documentType: null, format: null }));
  });

  it("identifies 'integrity pact' as sensitive", () => {
    assert.ok(isSensitiveFinancialOrLegalDoc({ name: "Integrity Pact", exactFileName: null, documentType: null, format: null }));
  });

  it("identifies 'declaration form' as sensitive", () => {
    assert.ok(isSensitiveFinancialOrLegalDoc({ name: "Declaration Form", exactFileName: null, documentType: null, format: null }));
  });

  it("identifies 'undertaking form' as sensitive", () => {
    assert.ok(isSensitiveFinancialOrLegalDoc({ name: "Undertaking Form", exactFileName: null, documentType: null, format: null }));
  });

  it("identifies 'rate card' as sensitive", () => {
    assert.ok(isSensitiveFinancialOrLegalDoc({ name: "Rate Card Template", exactFileName: null, documentType: null, format: null }));
  });

  it("identifies 'business license' as sensitive", () => {
    assert.ok(isSensitiveFinancialOrLegalDoc({ name: "Business License", exactFileName: null, documentType: null, format: null }));
  });

  it("does NOT flag a regular technical proposal as sensitive", () => {
    assert.ok(!isSensitiveFinancialOrLegalDoc({ name: "Technical Proposal", exactFileName: null, documentType: null, format: null }));
  });

  it("does NOT flag a methodology document as sensitive", () => {
    assert.ok(!isSensitiveFinancialOrLegalDoc({ name: "Methodology and Work Plan", exactFileName: null, documentType: null, format: null }));
  });
});

// ---------------------------------------------------------------------------
// isMixedTechnicalFinancialSentence — detects mixed sentences for rewrite
// ---------------------------------------------------------------------------

describe("isMixedTechnicalFinancialSentence — detects mixed tech/financial phrases", () => {
  it("detects 'cost control methodology' as mixed", () => {
    assert.ok(isMixedTechnicalFinancialSentence("We employ a cost control methodology throughout execution."));
  });

  it("detects 'budget-friendly approach' as mixed", () => {
    assert.ok(isMixedTechnicalFinancialSentence("A budget-friendly approach will be adopted for implementation."));
  });

  it("detects 'value for money' as mixed", () => {
    assert.ok(isMixedTechnicalFinancialSentence("This plan ensures value for money delivery."));
  });

  it("does NOT flag a purely financial sentence as mixed (no technical context)", () => {
    assert.ok(!isMixedTechnicalFinancialSentence("Total fee: USD 10,000."));
  });
});
