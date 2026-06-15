import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferSectionRequirementIds, type RequirementForEvidenceMap } from "../lib/engine/infrastructure/section-evidence-map";

const requirements: RequirementForEvidenceMap[] = [
  {
    id: "submission-rules",
    title: "Submission method, deadline and delivery rules",
    description: "The proposal must follow the stated submission method, deadline, delivery address, email subject, and file format instructions.",
    requirementType: "SUBMISSION",
    priority: "MANDATORY",
  },
  {
    id: "solar-pumping-experts",
    title: "Electro-mechanical / solar pumping experts",
    description: "The consultant must provide qualified electro-mechanical and solar pumping experts as part of the team.",
    requirementType: "PERSONNEL",
    priority: "MANDATORY",
  },
  {
    id: "financial-capacity",
    title: "Financial capacity and audited statement evidence",
    description: "The bidder must submit audited statements and evidence of financial capacity.",
    requirementType: "ELIGIBILITY",
    priority: "MANDATORY",
  },
  {
    id: "legal-eligibility",
    title: "Legal eligibility, registration and licensing evidence",
    description: "The bidder must provide legal registration, valid license, tax registration, and eligibility documents.",
    requirementType: "ELIGIBILITY",
    priority: "MANDATORY",
  },
];

describe("section evidence map inference", () => {
  it("links submission rules to opening or closing proposal sections", () => {
    const ids = inferSectionRequirementIds({
      sectionId: "additional-and-declaration",
      sectionTitle: "Section D, Appendix Register, and Declaration",
      sectionText: "The declaration confirms the submission deadline, delivery method, portal address, and required email subject before export.",
      requirements,
    });
    assert.ok(ids.includes("submission-rules"));
  });

  it("links electro-mechanical and solar pumping expert requirements to technical sections", () => {
    const ids = inferSectionRequirementIds({
      sectionId: "technical-approach",
      sectionTitle: "Section C: Technical Approach",
      sectionText: "The methodology assigns an electro-mechanical engineer and solar pumping specialist to the pump sizing, power demand, and quality review tasks.",
      requirements,
    });
    assert.ok(ids.includes("solar-pumping-experts"));
  });

  it("links financial capacity evidence to company or declaration sections", () => {
    const ids = inferSectionRequirementIds({
      sectionId: "company-and-experience",
      sectionTitle: "Section A: Company Profile and Section B: Relevant Experience",
      sectionText: "The corporate eligibility narrative references audited financial statements, bank evidence, and the firm's financial capacity.",
      requirements,
    });
    assert.ok(ids.includes("financial-capacity"));
  });

  it("links legal eligibility and licensing evidence to company or declaration sections", () => {
    const ids = inferSectionRequirementIds({
      sectionId: "company-and-experience",
      sectionTitle: "Section A: Company Profile and Legal Registration",
      sectionText: "The corporate information table includes trade registration, TIN, VAT, professional license, and eligibility documents.",
      requirements,
    });
    assert.ok(ids.includes("legal-eligibility"));
  });
});
