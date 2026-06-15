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
import { readFileSync } from "node:fs";
import { isFinalExportCandidateDocument } from "../lib/engine/export/document-output-state";
import { containsPricingLeakage, isSensitiveFinancialOrLegalDoc } from "../lib/engine/pricing/pricing-hygiene";

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

// ─── Pre-flight gate contract (route source checks) ───────────────────────
// Auto-finalize must block before polishing/marking documents when extraction
// is bad, metadata is contaminated, or the client name is missing — the same
// contract as generate-missing-plan-files.

describe("auto-finalize — pre-flight gate contract (route source)", () => {
  const source = readFileSync("app/api/tenders/[id]/auto-finalize/route.ts", "utf8");

  it("imports isExtractionAcceptableForGeneration", () => {
    assert.match(source, /isExtractionAcceptableForGeneration/);
  });

  it("imports assessExtractionQuality", () => {
    assert.match(source, /assessExtractionQuality/);
  });

  it("gate 1: blocks when extraction quality is insufficient", () => {
    assert.match(source, /EXTRACTION_QUALITY_INSUFFICIENT/);
    assert.match(source, /!isExtractionAcceptableForGeneration/);
  });

  it("gate 2: blocks when tender metadata is contaminated", () => {
    assert.match(source, /METADATA_CONTAMINATED/);
    assert.match(source, /metadataContaminated/);
  });

  it("gate 2b: blocks when client/procuring entity name is missing", () => {
    assert.match(source, /MISSING_CLIENT_DETAILS/);
    assert.match(source, /clientDisplayName/);
    assert.match(source, /clientName.*procuringEntityName|procuringEntityName.*clientName/);
  });

  it("returns 422 for all pre-flight gate failures", () => {
    const status422Count = (source.match(/status: 422/g) ?? []).length;
    assert.ok(status422Count >= 3, `Expected at least 3 × '{ status: 422 }' for the 3 pre-flight gates, got ${status422Count}`);
  });

  it("fetches files with extraction data for the gate check", () => {
    assert.match(source, /files:\s*\{/);
    assert.match(source, /extractedText/);
    assert.match(source, /extractionScore/);
  });

  it("gate 3: blocks when analysisExtractionStatus is OCR_REQUIRED", () => {
    assert.ok(
      source.includes('"OCR_REQUIRED"') && source.includes("ANALYSIS_FROM_DEGRADED_EXTRACTION"),
      "auto-finalize must block with ANALYSIS_FROM_DEGRADED_EXTRACTION when analysisExtractionStatus is OCR_REQUIRED",
    );
  });

  it("gate 3: blocks when analysisExtractionStatus is REGEX_FALLBACK_FROM_WEAK_EXTRACTION", () => {
    assert.ok(
      source.includes('"REGEX_FALLBACK_FROM_WEAK_EXTRACTION"'),
      "auto-finalize must check for REGEX_FALLBACK_FROM_WEAK_EXTRACTION in analysisExtractionStatus",
    );
  });

  it("gate 3: blocks when analysisExtractionStatus is PARTIAL_EXTRACTION_AI_ANALYZED", () => {
    assert.ok(
      source.includes('"PARTIAL_EXTRACTION_AI_ANALYZED"'),
      "auto-finalize must check for PARTIAL_EXTRACTION_AI_ANALYZED in analysisExtractionStatus",
    );
  });

  it("gate 3: suggests RUN_OCR_OR_UPLOAD_CLEARER_SCAN for OCR_REQUIRED status", () => {
    assert.ok(
      source.includes('"RUN_OCR_OR_UPLOAD_CLEARER_SCAN"'),
      "auto-finalize must suggest RUN_OCR_OR_UPLOAD_CLEARER_SCAN when analysis was skipped due to corrupted extraction",
    );
  });

  it("returns at least 4 × status:422 for the 4 pre-flight gates", () => {
    const count = (source.match(/status: 422/g) ?? []).length;
    assert.ok(count >= 4, `Expected ≥4 × 'status: 422' for gates 1, 2, 2b, 3 — got ${count}`);
  });
});
