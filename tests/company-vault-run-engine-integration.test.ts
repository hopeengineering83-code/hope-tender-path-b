import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { planAutomaticCompanyVaultReview } from "../lib/company-knowledge-import-safe";
import { parseEngineRequestOptions } from "../lib/engine/engine-request-options";
import { buildCompliance, findRequirementSupportDocument, findSupportDocument } from "../lib/engine/compliance";
import type { CompanyKnowledgeSnapshot, MatchingResult, RequirementDraft } from "../lib/engine/types";

const noMatches: MatchingResult = { expertMatches: [], projectMatches: [] };

function vault(documents: CompanyKnowledgeSnapshot["documents"]): CompanyKnowledgeSnapshot {
  return {
    companyId: "company-1",
    documents,
    experts: [],
    projects: [],
    legalRecords: [],
    financialRecords: [],
    complianceRecords: [],
  };
}

function requirement(requirementType: string, title: string): RequirementDraft {
  return { title, description: title, requirementType, priority: "MANDATORY" };
}

describe("Company Vault and Run Engine integration", () => {
  it("honors the background and Safe Mode parameters sent by the real Run Engine UI", () => {
    assert.deepEqual(
      parseEngineRequestOptions("https://app.test/api/tenders/t1/engine?async=true&safe=true&skipAiRematch=true&maxChars=75000"),
      { async: true, safe: true, skipAiRematch: true, maxChars: 75_000 },
    );
  });

  it("bounds unsafe maxChars values and defaults to synchronous full mode", () => {
    assert.deepEqual(parseEngineRequestOptions("https://app.test/api/tenders/t1/engine?maxChars=9999999"), {
      async: false,
      safe: false,
      skipAiRematch: false,
      maxChars: 200_000,
    });
    assert.equal(parseEngineRequestOptions("https://app.test/api/tenders/t1/engine?maxChars=10").maxChars, undefined);
  });

  it("separates direct support review from structured CV/project importing", () => {
    const plan = planAutomaticCompanyVaultReview([
      { id: "legal", category: "LEGAL_REGISTRATION", extractedText: "x".repeat(120), aiExtractionStatus: "PENDING" },
      { id: "cv", category: "EXPERT_CV", extractedText: "y".repeat(120), aiExtractionStatus: "PENDING" },
      { id: "done", category: "PROJECT_REFERENCE", extractedText: "z".repeat(120), aiExtractionStatus: "EXTRACTED" },
      { id: "scan", category: "FINANCIAL_STATEMENT", extractedText: "[Scanned PDF — OCR required]", aiExtractionStatus: "PENDING" },
    ]);

    assert.deepEqual(plan.awaiting.map((document) => document.id), ["legal", "cv"]);
    assert.deepEqual(plan.supportDocumentIds, ["legal"]);
    assert.equal(plan.requiresStructuredImport, true);
  });

  it("automatically selects the relevant usable Vault document instead of the first unrelated file", () => {
    const knowledge = vault([
      { id: "profile", category: "COMPANY_PROFILE", originalFileName: "company-profile.pdf", extractedText: "Our consultancy provides engineering and design services across the region." },
      { id: "tax", category: "LEGAL_REGISTRATION", originalFileName: "tax-registration.pdf", extractedText: "Official company tax registration and VAT certificate number 123456789." },
    ]);

    const result = buildCompliance(
      [{ id: "req-1", requirement: requirement("LEGAL", "Valid tax registration certificate") }],
      knowledge,
      noMatches,
    );

    assert.equal(result.matrices[0].supportStatus, "SUPPORTED");
    assert.equal(result.matrices[0].evidenceReference, "tax-registration.pdf");
    assert.doesNotMatch(result.matrices[0].evidenceSummary, /manual review|attach original|source reference not found/i);
  });

  it("never claims an unrelated or unextracted Vault document as supporting evidence", () => {
    const knowledge = vault([
      { id: "profile", category: "COMPANY_PROFILE", originalFileName: "company-profile.pdf", extractedText: "Our consultancy provides engineering and design services across the region." },
      { id: "scan", category: "FINANCIAL_STATEMENT", originalFileName: "accounts-scan.pdf", extractedText: "[Scanned PDF — OCR required]" },
    ]);

    const result = buildCompliance(
      [{ id: "req-1", requirement: requirement("FINANCIAL", "Audited financial statements") }],
      knowledge,
      noMatches,
    );

    assert.equal(result.matrices[0].supportStatus, "UNSUPPORTED");
    assert.equal(result.matrices[0].evidenceReference, undefined);
    assert.match(result.matrices[0].evidenceSummary, /No relevant financial evidence/i);
  });

  it("requires extracted content before a Vault filename can become an evidence reference", () => {
    const knowledge = vault([
      { id: "empty", category: "CERTIFICATION", originalFileName: "iso-9001.pdf", extractedText: null },
    ]);

    assert.equal(findSupportDocument(knowledge, [/iso|certificate/i]), undefined);
  });

  it("does not match an unrelated document from a single generic requirement word", () => {
    const knowledge = vault([
      { id: "unrelated", category: "MANUAL", originalFileName: "quality-manual.pdf", extractedText: "Internal quality procedures for document control and staff training." },
    ]);
    const req = requirement("TECHNICAL", "Technical quality assurance methodology");

    assert.equal(findRequirementSupportDocument(knowledge, req), undefined);
  });
});
