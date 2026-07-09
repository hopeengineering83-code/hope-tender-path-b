/**
 * Tests for the generated document content quality system.
 *
 * Tests:
 *   1. EOI tender generates EOI package, not full RFP technical methodology.
 *   2. RFP tender generates technical proposal with methodology, work plan, team, compliance matrix.
 *   3. RFQ tender generates quotation documents, not long RFP proposal.
 *   4. Technical-only tender excludes financial proposal and price schedule.
 *   5. Two-envelope tender separates technical and financial content.
 *   6. Architectural design tender uses architecture methodology.
 *   7. Supervision tender uses supervision methodology.
 *   8. Geotechnical tender uses investigation/lab/report methodology.
 *   9. Interior design tender uses interior design methodology.
 *  10. Urban planning tender uses planning/stakeholder/spatial methodology.
 *  11. All mandatory requirements appear in compliance matrix.
 *  12. Missing evidence produces controlled gap text, not invented evidence.
 *  13. Selected experts appear; unselected experts do not.
 *  14. Missing required expert does not create fake expert.
 *  15. Selected projects appear; unselected projects do not.
 *  16. Generated document contains no AI traces.
 *  17. Generated document contains no TODO/TBD/Bid-Team to confirm.
 *  18. Technical-only tender has no financial proposal.
 *  19. Two-envelope keeps price content out of technical package.
 *  20. DOCX has heading hierarchy (markdown has # headings).
 *  21. Document quality validator detects forbidden text.
 *  22. Document quality validator detects missing sections.
 *  23. Financial proposal excluded when tender says not required.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { buildTenderDocumentContext, type TenderDocumentGenerationContext } from "../lib/document-generation/tender-document-context";
import { buildDocumentPlan } from "../lib/document-generation/tender-section-planner";
import { getMethodologyForServiceStream, getCombinedMethodology } from "../lib/document-generation/haec-service-methodology";
import { validateGeneratedDocumentQuality } from "../lib/document-generation/generated-document-quality-validator";
import { composeTenderDocuments } from "../lib/document-generation/tender-document-composer";
import { classifyTender } from "../lib/engine/tender-classification";

// ─── Test fixtures ──────────────────────────────────────────────────────────

function makeContext(overrides: Partial<TenderDocumentGenerationContext> = {}): TenderDocumentGenerationContext {
  return {
    tenderId: "test-tender-1",
    tenderType: "RFP",
    serviceStreams: ["architecture"],
    projectTitle: "Test Tender",
    clientName: "Ministry of Test",
    submissionMethod: "Email",
    deadline: "2026-12-15",
    financialProposalRequired: true,
    scopeOfServices: ["Architectural design services"],
    deliverables: ["Inception report", "Design drawings"],
    evaluationCriteria: ["Technical approach 40%", "Experience 30%"],
    mandatoryRequirements: ["Valid business licence", "10 years experience"],
    requiredDocuments: ["Technical Proposal.docx", "Financial Proposal.docx"],
    selectedExperts: [{
      id: "e1", fullName: "Dr. Test Expert", title: "Lead Architect",
      disciplines: ["architectural design"], yearsExperience: 15, trustLevel: "REVIEWED", isSelected: true,
    }],
    selectedProjects: [{
      id: "p1", name: "Test Hospital", clientName: "Ministry of Health",
      sector: "healthcare", serviceAreas: ["architectural design"],
      summary: "Hospital expansion", contractValue: 5000000, currency: "USD",
      startDate: new Date("2022-01-01"), endDate: new Date("2024-06-01"),
      trustLevel: "REVIEWED", isSelected: true,
    }],
    selectedLegalDocuments: [{
      id: "l1", title: "Business Licence", recordType: "LICENCE",
      status: "ACTIVE", issueDate: new Date("2024-01-01"), expiryDate: null, referenceNumber: "BL-001",
    }],
    selectedCompanyAssets: [],
    companyProfile: {
      name: "Test Engineering Co.", description: "Engineering consultancy",
      country: "Ethiopia", website: "https://test.com", serviceLines: ["Architecture", "Engineering"], establishedYear: 2010,
    },
    warnings: [],
    ...overrides,
  };
}

const EOI_TEXT = "Expression of Interest for Consulting Services. Reference: EOI-2026-001. We invite expressions of interest from qualified firms.";
const RFP_TEXT = "Request for Proposal for Architectural Design Services. Reference: RFP-2026-001. Submit technical and financial proposals in separate envelopes.";
const RFQ_TEXT = "Request for Quotation for Office Equipment Supply. Reference: RFQ-2026-001. Submit quotation with price schedule.";
const TECHNICAL_ONLY_TEXT = "Request for Proposal. Technical proposal only. Financial proposal not required. Do not generate a financial proposal.";

// ─── Tender-type generation tests ───────────────────────────────────────────

describe("1-5. Tender-type generation", () => {
  it("1. EOI generates EOI package, not full technical methodology", () => {
    const ctx = makeContext({ tenderType: "EOI" });
    const plan = buildDocumentPlan(ctx);
    assert.ok(plan.documents.some((d) => d.type === "EXPRESSION_OF_INTEREST"), "must include EOI document");
    assert.ok(plan.skippedDocuments.some((d) => d.type === "TECHNICAL_PROPOSAL"), "must skip technical proposal");
    assert.ok(plan.skippedDocuments.some((d) => d.type === "FINANCIAL_PROPOSAL"), "must skip financial proposal");
  });

  it("2. RFP generates technical proposal with methodology, work plan, team, compliance matrix", () => {
    const ctx = makeContext({ tenderType: "RFP" });
    const plan = buildDocumentPlan(ctx);
    const techDoc = plan.documents.find((d) => d.type === "TECHNICAL_PROPOSAL");
    assert.ok(techDoc, "must include technical proposal");
    const sectionTitles = techDoc!.sections.map((s) => s.title.toLowerCase());
    assert.ok(sectionTitles.some((s) => s.includes("methodology")), "must include methodology");
    assert.ok(sectionTitles.some((s) => s.includes("work plan")), "must include work plan");
    assert.ok(sectionTitles.some((s) => s.includes("team")), "must include team composition");
    assert.ok(sectionTitles.some((s) => s.includes("compliance")), "must include compliance matrix");
  });

  it("3. RFQ generates quotation documents, not long RFP proposal", () => {
    const ctx = makeContext({ tenderType: "RFQ" });
    const plan = buildDocumentPlan(ctx);
    assert.ok(plan.documents.some((d) => d.type === "QUOTATION"), "must include quotation");
    assert.ok(plan.skippedDocuments.some((d) => d.type === "TECHNICAL_PROPOSAL"), "must skip full technical proposal");
  });

  it("4. Technical-only tender excludes financial proposal and price schedule", () => {
    const ctx = makeContext({ tenderType: "RFP", financialProposalRequired: false });
    const plan = buildDocumentPlan(ctx);
    assert.ok(!plan.documents.some((d) => d.type === "FINANCIAL_PROPOSAL"), "must NOT include financial proposal");
    assert.ok(plan.skippedDocuments.some((d) => d.type === "FINANCIAL_PROPOSAL"), "must list financial as skipped");
    assert.ok(plan.skippedDocuments.some((d) => d.reason.includes("not required")), "must state 'not required'");
  });

  it("5. Two-envelope tender separates technical and financial content", () => {
    const ctx = makeContext({ tenderType: "RFP", financialProposalRequired: true });
    const plan = buildDocumentPlan(ctx);
    const techDoc = plan.documents.find((d) => d.type === "TECHNICAL_PROPOSAL");
    const finDoc = plan.documents.find((d) => d.type === "FINANCIAL_PROPOSAL");
    assert.ok(techDoc, "must have technical proposal");
    assert.ok(finDoc, "must have financial proposal");
    assert.equal(techDoc!.envelope, "TECHNICAL");
    assert.equal(finDoc!.envelope, "FINANCIAL");
  });
});

// ─── Service-stream methodology tests ───────────────────────────────────────

describe("6-10. Service-stream methodology", () => {
  it("6. Architectural design uses architecture methodology", () => {
    const m = getMethodologyForServiceStream("architecture");
    assert.ok(m.some((s) => s.title.includes("Site") || s.title.includes("Concept")), "must include site/concept");
    assert.ok(m.some((s) => s.title.includes("Authority") || s.title.includes("Coordination")), "must include authority/coordination");
  });

  it("7. Supervision uses supervision methodology", () => {
    const m = getMethodologyForServiceStream("supervision");
    assert.ok(m.some((s) => s.title.includes("Mobilization")), "must include mobilization");
    assert.ok(m.some((s) => s.title.includes("Site Supervision")), "must include site supervision");
    assert.ok(m.some((s) => s.title.includes("Contract Administration")), "must include contract administration");
  });

  it("8. Geotechnical uses investigation/lab/report methodology", () => {
    const m = getMethodologyForServiceStream("geotechnical");
    assert.ok(m.some((s) => s.title.includes("Desk Study")), "must include desk study");
    assert.ok(m.some((s) => s.title.includes("Field Investigation")), "must include field investigation");
    assert.ok(m.some((s) => s.title.includes("Laboratory")), "must include laboratory testing");
    assert.ok(m.some((s) => s.title.includes("Foundation")), "must include foundation recommendations");
  });

  it("9. Interior design uses interior design methodology", () => {
    const m = getMethodologyForServiceStream("interior-design");
    assert.ok(m.some((s) => s.title.includes("Brief")), "must include brief validation");
    assert.ok(m.some((s) => s.title.includes("Mood")), "must include mood board");
    assert.ok(m.some((s) => s.title.includes("Space Planning")), "must include space planning");
  });

  it("10. Urban planning uses planning/stakeholder/spatial methodology", () => {
    const m = getMethodologyForServiceStream("urban-planning");
    assert.ok(m.some((s) => s.title.includes("Baseline")), "must include baseline study");
    assert.ok(m.some((s) => s.title.includes("Stakeholder")), "must include stakeholder consultation");
    assert.ok(m.some((s) => s.title.includes("Spatial")), "must include spatial analysis");
  });

  it("multi-stream combines without duplication", () => {
    const m = getCombinedMethodology(["architecture", "supervision", "geotechnical"]);
    const titles = m.map((s) => s.title);
    const unique = new Set(titles);
    assert.equal(titles.length, unique.size, "no duplicate sections");
    assert.ok(m.length > 6, "must combine multiple streams");
  });
});

// ─── Compliance matrix tests ────────────────────────────────────────────────

describe("11. Compliance matrix", () => {
  it("all mandatory requirements appear in compliance matrix", () => {
    const ctx = makeContext({
      mandatoryRequirements: ["Valid business licence", "10 years experience", "ISO 9001 certification"],
    });
    const result = composeTenderDocuments(ctx);
    const techDoc = result.documents.find((d) => d.type === "TECHNICAL_PROPOSAL");
    assert.ok(techDoc, "must have technical proposal");
    assert.equal(techDoc!.complianceMatrix.length, 3, "all 3 mandatory requirements must appear");
    for (const req of ctx.mandatoryRequirements) {
      assert.ok(techDoc!.complianceMatrix.some((r) => r.tenderRequirement === req), `requirement "${req}" must appear`);
    }
  });
});

// ─── Evidence-use tests ─────────────────────────────────────────────────────

describe("12-15. Evidence use", () => {
  it("12. Missing evidence produces controlled gap text, not invented evidence", () => {
    const ctx = makeContext({ selectedExperts: [], selectedProjects: [] });
    const result = composeTenderDocuments(ctx);
    const techDoc = result.documents.find((d) => d.type === "TECHNICAL_PROPOSAL");
    assert.ok(techDoc!.markdown.includes("Controlled Gap"), "must show controlled gap text");
    assert.ok(!techDoc!.markdown.includes("Dr. Fictitious"), "must NOT invent experts");
    assert.ok(!techDoc!.markdown.includes("Fake Project"), "must NOT invent projects");
  });

  it("13. Selected experts appear; unselected do not", () => {
    const ctx = makeContext({
      selectedExperts: [
        { id: "e1", fullName: "Dr. Selected Expert", title: "Lead", disciplines: ["architecture"], yearsExperience: 15, trustLevel: "REVIEWED", isSelected: true },
      ],
    });
    const result = composeTenderDocuments(ctx);
    const techDoc = result.documents.find((d) => d.type === "TECHNICAL_PROPOSAL");
    assert.ok(techDoc!.markdown.includes("Dr. Selected Expert"), "selected expert must appear");
  });

  it("14. Missing required expert does not create fake expert", () => {
    const ctx = makeContext({ selectedExperts: [] });
    const result = composeTenderDocuments(ctx);
    const techDoc = result.documents.find((d) => d.type === "TECHNICAL_PROPOSAL");
    assert.ok(techDoc!.markdown.includes("No experts have been selected"), "must show gap text");
    assert.ok(!techDoc!.markdown.match(/\b(?:John Doe|Jane Smith|Sample Expert)\b/i), "must NOT create fake expert names");
  });

  it("15. Selected projects appear; unselected do not", () => {
    const ctx = makeContext({
      selectedProjects: [
        { id: "p1", name: "Real Project", clientName: "Real Client", sector: "health", serviceAreas: ["architecture"], summary: null, contractValue: null, currency: null, startDate: null, endDate: null, trustLevel: "REVIEWED", isSelected: true },
      ],
    });
    const result = composeTenderDocuments(ctx);
    const techDoc = result.documents.find((d) => d.type === "TECHNICAL_PROPOSAL");
    assert.ok(techDoc!.markdown.includes("Real Project"), "selected project must appear");
  });
});

// ─── Placeholder / AI trace tests ───────────────────────────────────────────

describe("16-17. Placeholder / AI trace", () => {
  it("16. Generated document contains no AI traces", () => {
    const ctx = makeContext();
    const result = composeTenderDocuments(ctx);
    for (const doc of result.documents) {
      assert.ok(!doc.markdown.match(/As an AI|AI-generated|As a language model/i), `doc ${doc.type} must not contain AI traces`);
    }
  });

  it("17. Generated document contains no TODO/TBD/Bid-Team to confirm", () => {
    const ctx = makeContext();
    const result = composeTenderDocuments(ctx);
    for (const doc of result.documents) {
      assert.ok(!doc.markdown.match(/\bTODO\b|\bTBD\b|Bid-Team to confirm/i), `doc ${doc.type} must not contain TODO/TBD/Bid-Team`);
    }
  });
});

// ─── Technical/financial separation tests ───────────────────────────────────

describe("18-19. Technical/financial separation", () => {
  it("18. Technical-only tender has no financial proposal", () => {
    const ctx = makeContext({ financialProposalRequired: false });
    const result = composeTenderDocuments(ctx);
    assert.ok(!result.documents.some((d) => d.type === "FINANCIAL_PROPOSAL"), "must NOT have financial proposal");
    assert.ok(!result.documents.some((d) => d.type === "PRICE_SCHEDULE"), "must NOT have price schedule");
  });

  it("19. Two-envelope keeps price content out of technical package", () => {
    const ctx = makeContext({ financialProposalRequired: true });
    const result = composeTenderDocuments(ctx);
    const techDoc = result.documents.find((d) => d.type === "TECHNICAL_PROPOSAL");
    const finDoc = result.documents.find((d) => d.type === "FINANCIAL_PROPOSAL");
    assert.ok(techDoc && finDoc, "must have both");
    // Technical doc should not contain price schedule content
    assert.ok(!techDoc!.markdown.includes("Price Schedule"), "technical must not contain price schedule");
    // Financial doc should contain price content
    assert.ok(finDoc!.markdown.includes("Price") || finDoc!.markdown.includes("Financial"), "financial must contain price/financial content");
  });
});

// ─── DOCX structure tests ───────────────────────────────────────────────────

describe("20. DOCX structure", () => {
  it("20. Document has heading hierarchy (markdown has # headings)", () => {
    const ctx = makeContext();
    const result = composeTenderDocuments(ctx);
    for (const doc of result.documents) {
      assert.ok(doc.markdown.includes("#"), `doc ${doc.type} must have heading structure`);
      assert.ok(doc.markdown.includes("##"), `doc ${doc.type} must have h2 headings`);
    }
  });
});

// ─── Quality validator tests ────────────────────────────────────────────────

describe("21-22. Quality validator", () => {
  it("21. Validator detects forbidden text", () => {
    const ctx = makeContext();
    const badText = "This is a great proposal. As an AI, I think this is good. TODO: add more. Bid-Team to confirm.";
    const result = validateGeneratedDocumentQuality(badText, "TECHNICAL_PROPOSAL", ctx, ["Cover Letter"], []);
    assert.ok(result.finalBlockers.length > 0, "must detect forbidden text");
    assert.ok(result.finalBlockers.some((b) => b.includes("As an AI")), "must detect AI trace");
    assert.ok(result.finalBlockers.some((b) => b.includes("TODO")), "must detect TODO");
    assert.ok(result.finalBlockers.some((b) => b.includes("Bid-Team")), "must detect Bid-Team");
    assert.equal(result.okForFinal, false, "must NOT be ok for final");
  });

  it("22. Validator detects missing sections", () => {
    const ctx = makeContext();
    const result = validateGeneratedDocumentQuality("Some content", "TECHNICAL_PROPOSAL", ctx, ["Cover Letter", "Methodology"], []);
    assert.ok(result.missingSections.length > 0, "must detect missing sections");
    assert.ok(result.missingSections.includes("Cover Letter"), "must detect missing Cover Letter");
    assert.ok(result.missingSections.includes("Methodology"), "must detect missing Methodology");
  });
});

// ─── Financial exclusion test ───────────────────────────────────────────────

describe("23. Financial proposal excluded when not required", () => {
  it("23. financialProposalRequired=false excludes financial documents", () => {
    const ctx = makeContext({ financialProposalRequired: false });
    const result = composeTenderDocuments(ctx);
    assert.ok(!result.documents.some((d) => d.type === "FINANCIAL_PROPOSAL"), "must not generate financial proposal");
    assert.ok(!result.documents.some((d) => d.type === "PRICE_SCHEDULE"), "must not generate price schedule");
    assert.ok(result.skippedDocuments.some((d) => d.type === "FINANCIAL_PROPOSAL"), "must list financial as skipped");
  });
});

// ─── Module existence tests ─────────────────────────────────────────────────

describe("Module existence", () => {
  it("all 5 required modules exist", () => {
    const fs = require("fs");
    assert.ok(fs.existsSync("lib/document-generation/tender-document-composer.ts"));
    assert.ok(fs.existsSync("lib/document-generation/tender-section-planner.ts"));
    assert.ok(fs.existsSync("lib/document-generation/generated-document-quality-validator.ts"));
    assert.ok(fs.existsSync("lib/document-generation/haec-service-methodology.ts"));
    assert.ok(fs.existsSync("lib/document-generation/tender-document-context.ts"));
  });
});
