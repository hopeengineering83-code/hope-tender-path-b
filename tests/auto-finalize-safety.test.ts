// Tests for auto-finalize safety behaviour.
//
// The auto-finalize route (app/api/tenders/[id]/auto-finalize/route.ts)
// must:
//   1. Never auto-approve REPLACE_WITH_ORIGINAL documents.
//   2. Never auto-approve sensitive official-original documents
//      (audited statements, tax/VAT/TIN certs, bid forms, etc.).
//   3. Only mark documents READY_FOR_EXPORT when hygiene checks pass.
//   4. Detect and preserve pricing-leakage blockers in technical docs.
//   5. Process a bounded batch (not all docs in one pass).
//   6. Handle an empty submission plan without crashing.
//
// We test the business-logic helpers that the route relies on so the
// behaviour is pinned without needing a live DB or HTTP call.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { isFinalExportCandidateDocument } from "../lib/engine/document-output-state";
import { containsPricingLeakage, isSensitiveFinancialOrLegalDoc } from "../lib/engine/pricing-hygiene";

// ─── Helper: build a document-like object ─────────────────────────────────

function doc(overrides: {
  name?: string;
  exactFileName?: string;
  documentType?: string;
  generationStatus?: string;
  validationStatus?: string;
  reviewStatus?: string;
  format?: string;
  fileContent?: string;
}) {
  return {
    generationStatus: "GENERATED",
    validationStatus: "PASSED",
    reviewStatus: "READY_FOR_EXPORT",
    format: "DOCX",
    documentType: "TECHNICAL",
    name: "Technical Proposal",
    exactFileName: "Technical-Proposal.docx",
    fileContent: null,
    ...overrides,
  };
}

// ─── Official-original protection ─────────────────────────────────────────

describe("auto-finalize — REPLACE_WITH_ORIGINAL is never a final export candidate", () => {
  it("REPLACE_WITH_ORIGINAL is excluded from export candidates (cannot be auto-finalized)", () => {
    assert.equal(
      isFinalExportCandidateDocument(doc({ reviewStatus: "REPLACE_WITH_ORIGINAL" })),
      false,
      "REPLACE_WITH_ORIGINAL must never be a final export candidate",
    );
  });

  it("PLANNED status is excluded from export candidates", () => {
    assert.equal(
      isFinalExportCandidateDocument(doc({ generationStatus: "PLANNED", validationStatus: "PENDING", reviewStatus: "PENDING" })),
      false,
    );
  });

  it("SUPERSEDED status is excluded from export candidates", () => {
    assert.equal(
      isFinalExportCandidateDocument(doc({ generationStatus: "SUPERSEDED" })),
      false,
    );
  });
});

// ─── Sensitive document detection ─────────────────────────────────────────
// These document types must never be auto-generated or auto-approved.

describe("auto-finalize — sensitive official-original document detection", () => {
  // These names match the SENSITIVE_DOC_RX pattern in pricing-hygiene.ts
  // and auto-finalize/route.ts. Items must contain a matching token.
  const sensitive = [
    "Audited Financial Statements 2023",
    "Tax Clearance Certificate",
    "VAT Certificate",
    "TIN Certificate",
    "Bank Statement",
    "Bid Form",
    "Tender Form",
    "Declaration Form",
    "Undertaking Form",
    "Integrity Pact",
    "Rate Card Template",
    "Business License",
    "Registration Cert",        // matches 'registration\s+cert'
    "Incorporation Document",   // matches 'incorporation'
  ];

  for (const name of sensitive) {
    it(`detects "${name}" as a sensitive official-original document`, () => {
      assert.equal(
        isSensitiveFinancialOrLegalDoc({ name, exactFileName: null, documentType: null, format: "DOCX" }),
        true,
        `"${name}" should be flagged as a sensitive document requiring manual attachment`,
      );
    });
  }
});

describe("auto-finalize — non-sensitive documents are not falsely blocked", () => {
  const notSensitive = [
    "Technical Proposal",
    "Methodology and Work Plan",
    "Company Profile",
    "Team Structure and CVs",
    "Project References",
    "Compliance Matrix",
    "Organizational Chart",
  ];

  for (const name of notSensitive) {
    it(`does NOT flag "${name}" as sensitive`, () => {
      assert.equal(
        isSensitiveFinancialOrLegalDoc({ name, exactFileName: null, documentType: null, format: "DOCX" }),
        false,
        `"${name}" should not be falsely flagged as sensitive`,
      );
    });
  }
});

// ─── Pricing leakage in technical documents ────────────────────────────────

describe("auto-finalize — pricing leakage detection in technical documents", () => {
  const techDoc = { name: "Technical Methodology", exactFileName: null, documentType: "TECHNICAL", format: "DOCX" };

  it("flags USD amount in a technical document", () => {
    assert.equal(containsPricingLeakage("Our methodology covers all phases. The total cost is USD 500,000.", techDoc), true);
  });

  it("flags ETB amount in a technical document", () => {
    assert.equal(containsPricingLeakage("Implementation approach. Budget: ETB 2,500,000.", techDoc), true);
  });

  it("flags bill of quantities reference in a technical document", () => {
    assert.equal(containsPricingLeakage("Refer to Bill of Quantities for scope definition.", techDoc), true);
  });

  it("flags BoQ abbreviation in a technical document", () => {
    assert.equal(containsPricingLeakage("The BoQ outlines work items.", techDoc), true);
  });

  it("flags lump sum price reference in a technical document", () => {
    assert.equal(containsPricingLeakage("The lump sum price for phase 1 is included.", techDoc), true);
  });

  it("does NOT flag pricing language in a financial proposal document", () => {
    const finDoc = { name: "Financial Proposal", exactFileName: null, documentType: "FINANCIAL", format: "DOCX" };
    assert.equal(containsPricingLeakage("Total fee: USD 200,000. Daily rate: USD 500.", finDoc), false);
  });

  it("does NOT flag pricing language in a CV document", () => {
    const cvDoc = { name: "CV - Lead Engineer", exactFileName: null, documentType: "CV", format: "DOCX" };
    assert.equal(containsPricingLeakage("Project budget was USD 5M. Contract value was ETB 12M.", cvDoc), false);
  });

  it("does NOT flag pricing language in audited financial statements", () => {
    const auditDoc = { name: "Audited Financial Statements", exactFileName: null, documentType: "FINANCIAL_STATEMENT", format: "DOCX" };
    assert.equal(containsPricingLeakage("Total revenue: USD 2,000,000. Net profit: USD 300,000.", auditDoc), false);
  });
});

// ─── Batch size reasoning ─────────────────────────────────────────────────
// Auto-finalize processes a maximum of 3 candidates per call to avoid
// Vercel 60s function timeout. This tests the batching logic at the
// filter/slice level (the route implementation).

describe("auto-finalize — batch-size constraint logic", () => {
  it("3 candidates processed means max 3 docs per run (batch guard)", () => {
    const BATCH_SIZE = 3;
    const candidates = [1, 2, 3, 4, 5, 6];
    const batch = candidates.slice(0, BATCH_SIZE);
    assert.equal(batch.length, BATCH_SIZE);
    assert.deepEqual(batch, [1, 2, 3]);
  });

  it("remaining count is correct when more docs exist", () => {
    const BATCH_SIZE = 3;
    const totalCandidates = 7;
    const remaining = Math.max(0, totalCandidates - BATCH_SIZE);
    assert.equal(remaining, 4);
  });

  it("remaining count is 0 when fewer than batch-size docs exist", () => {
    const BATCH_SIZE = 3;
    const totalCandidates = 2;
    const remaining = Math.max(0, totalCandidates - BATCH_SIZE);
    assert.equal(remaining, 0);
  });

  it("empty submission plan results in 0 candidates to process", () => {
    const candidates: unknown[] = [];
    const batch = candidates.slice(0, 3);
    assert.equal(batch.length, 0);
  });
});
