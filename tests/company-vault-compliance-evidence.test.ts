import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildCompliance, findCategorizedSupportDocument, findRequirementSupportDocument, findSupportDocument } from "../lib/engine/compliance";
import type { CompanyKnowledgeSnapshot, MatchingResult, RequirementDraft } from "../lib/engine/types";

const noMatches: MatchingResult = { expertMatches: [], projectMatches: [] };

function vault(documents: CompanyKnowledgeSnapshot["documents"]): CompanyKnowledgeSnapshot {
  return { companyId: "company-1", documents, experts: [], projects: [], legalRecords: [], financialRecords: [], complianceRecords: [] };
}

function requirement(requirementType: string, title: string): RequirementDraft {
  return { title, description: title, requirementType, priority: "MANDATORY" };
}

describe("Company Vault compliance evidence selection", () => {
  it("selects relevant extracted legal evidence instead of the first unrelated Vault file", () => {
    const result = buildCompliance([{ id: "r1", requirement: requirement("LEGAL", "Valid tax registration certificate") }], vault([
      { id: "profile", category: "COMPANY_PROFILE", originalFileName: "company-profile.pdf", extractedText: "Our consultancy provides engineering and design services throughout the region." },
      { id: "tax", category: "LEGAL_REGISTRATION", originalFileName: "tax-registration.pdf", extractedText: "Official company tax registration and VAT certificate reference 123456789." },
    ]), noMatches);

    assert.equal(result.matrices[0].supportStatus, "SUPPORTED");
    assert.equal(result.matrices[0].evidenceReference, "tax-registration.pdf");
  });

  it("does not claim scanned, empty, or unrelated files as financial evidence", () => {
    const result = buildCompliance([{ id: "r1", requirement: requirement("FINANCIAL", "Audited financial statements") }], vault([
      { id: "profile", category: "COMPANY_PROFILE", originalFileName: "company-profile.pdf", extractedText: "Our consultancy provides engineering and design services throughout the region." },
      { id: "scan", category: "FINANCIAL_STATEMENT", originalFileName: "accounts.pdf", extractedText: "[Scanned PDF — OCR required]" },
    ]), noMatches);

    assert.equal(result.matrices[0].supportStatus, "UNSUPPORTED");
    assert.equal(result.matrices[0].evidenceType, "UNMAPPED");
    assert.equal(result.matrices[0].evidenceReference, undefined);
  });

  it("requires extracted content before a filename can become evidence", () => {
    assert.equal(findSupportDocument(vault([{ id: "d1", category: "CERTIFICATION", originalFileName: "iso.pdf", extractedText: null }]), [/iso|certificate/i]), undefined);
  });

  it("does not match an unrelated document from one generic requirement word", () => {
    const knowledge = vault([{ id: "d1", category: "MANUAL", originalFileName: "quality-manual.pdf", extractedText: "Internal quality procedures for document control and staff training." }]);
    assert.equal(findRequirementSupportDocument(knowledge, requirement("TECHNICAL", "Technical quality assurance methodology")), undefined);
  });

  it("does not treat a general certification as legal registration evidence", () => {
    const knowledge = vault([{ id: "d1", category: "CERTIFICATION", originalFileName: "quality-certificate.pdf", extractedText: "ISO quality management system certification issued to the consultancy." }]);
    const result = buildCompliance([{ id: "r1", requirement: requirement("LEGAL", "Business registration certificate") }], knowledge, noMatches);

    assert.equal(result.matrices[0].supportStatus, "UNSUPPORTED");
    assert.equal(result.matrices[0].evidenceReference, undefined);
    assert.equal(findCategorizedSupportDocument(knowledge, ["LEGAL_REGISTRATION"], [/certificate/i]), undefined);
  });

  it("matches whole normalized terms rather than substrings", () => {
    const knowledge = vault([{ id: "d1", category: "OTHER", originalFileName: "venue.pdf", extractedText: "The auditorium is available for conferences and public meetings." }]);
    assert.equal(findRequirementSupportDocument(knowledge, requirement("OTHER", "Audit")), undefined);
  });
});
