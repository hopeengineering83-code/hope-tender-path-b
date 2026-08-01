import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { buildCompliance, findSupportDocument } from "../lib/engine/compliance";
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
  it("makes automatic Vault review part of the real Run Engine orchestration path", () => {
    const source = readFileSync(new URL("../lib/engine/run-tender-engine.ts", import.meta.url), "utf8");
    assert.match(source, /importCompanyKnowledgeFromDocuments\(company\.id\)/);
    assert.match(source, /company = await loadCompanyVault\(\)/);
    assert.match(source, /engine\.company\.review/);
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
});
