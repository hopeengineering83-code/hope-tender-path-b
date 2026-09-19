/**
 * Tests for the document-content-quality ENFORCER (okForFinal as export blocker).
 *
 * Verifies that:
 *   1. checkFullExportReadinessWithQualityGate exists and is callable.
 *   2. checkDocumentQualityGate blocks export when okForFinal is false.
 *   3. checkDocumentQualityGate does NOT block when okForFinal is true.
 *   4. The 7 new conceptual service-stream methodologies exist (consultancy,
 *      contract-administration, construction-management, building-consultancy,
 *      engineering-design, soil-investigation, infrastructure-consultancy).
 *   5. getMethodologyForConceptualStream returns non-default methodology for
 *      each conceptual stream.
 *   6. generate-elite.ts imports classifyTender and buildServiceStreamMethodologyBlock.
 *   7. validate route imports checkFullExportReadinessWithQualityGate.
 *   8. EOI tenders are blocked from generating technical proposals.
 *   9. Financial proposals are blocked when not required.
 *  10. AI traces and TODO/TBD/Bid-Team placeholders are blocked.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import {
  getMethodologyForConceptualStream,
  getCombinedConceptualMethodology,
  type ConceptualServiceStream,
} from "../lib/document-generation/haec-service-methodology";
import { validateGeneratedDocumentQuality } from "../lib/document-generation/generated-document-quality-validator";
import { buildTenderDocumentContext, type TenderDocumentGenerationContext } from "../lib/document-generation/tender-document-context";
import {
  checkDocumentQualityGate,
  checkFullExportReadinessWithQualityGate,
} from "../lib/engine/export-readiness";
import { PDFDocument, StandardFonts } from "pdf-lib";

async function makePdfBase64(text: string): Promise<string> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText(text, { x: 48, y: 730, size: 10, font, maxWidth: 520, lineHeight: 14 });
  return Buffer.from(await pdf.save()).toString("base64");
}

const read = (p: string) => readFileSync(p, "utf8");

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
    selectedExperts: [],
    selectedProjects: [],
    selectedLegalDocuments: [],
    selectedCompanyAssets: [],
    companyProfile: {
      name: "Test Engineering Co.", description: "Engineering consultancy",
      country: "Ethiopia", website: "https://test.com", serviceLines: ["Architecture", "Engineering"], establishedYear: 2010,
    },
    warnings: [],
    ...overrides,
  };
}

// ─── 1-3. Quality-gate enforcer tests ───────────────────────────────────────

describe("1-3. Quality-gate enforcer", () => {
  it("1. checkFullExportReadinessWithQualityGate is exported and callable", () => {
    assert.equal(typeof checkFullExportReadinessWithQualityGate, "function");
    assert.equal(typeof checkDocumentQualityGate, "function");
  });

  it("2. checkDocumentQualityGate blocks export when okForFinal is false (AI trace)", async () => {
    const ctx = makeContext();
    const docs = [{
      id: "doc1",
      name: "Technical Proposal",
      exactFileName: "Technical-Proposal.docx",
      exactOrder: 1,
      documentType: "TECHNICAL_PROPOSAL",
      format: "DOCX",
      generationStatus: "GENERATED",
      validationStatus: "PASSED",
      reviewStatus: "READY_FOR_EXPORT",
      fileContent: "Cover Letter\nUnderstanding of the Assignment\nTechnical Approach and Methodology\nWork Plan\nTeam Composition\nCompliance Matrix\nSubmission Checklist\n\nAs an AI, I think this proposal is good. TODO: add more details. Bid-Team to confirm the price.",
      storagePath: null,
    }];
    const failures = await checkDocumentQualityGate(docs, ctx, {
      TECHNICAL_PROPOSAL: ["Cover Letter", "Understanding of the Assignment", "Technical Approach and Methodology", "Work Plan", "Team Composition", "Compliance Matrix", "Submission Checklist"],
    }, ctx.mandatoryRequirements);
    assert.ok(failures.length > 0, "must block when AI trace + TODO + Bid-Team present");
    assert.ok(failures.some((f) => f.reasons.some((r) => r.includes("As an AI"))), "must surface AI trace blocker");
  });

  it("3. checkDocumentQualityGate does NOT block when okForFinal is true (clean content)", async () => {
    const ctx = makeContext();
    const cleanContent = "Cover Letter\nUnderstanding of the Assignment\nTechnical Approach and Methodology\nWork Plan\nTeam Composition\nCompliance Matrix\nSubmission Checklist\n\nWe are pleased to submit our proposal. Our team has 15 years of experience delivering similar projects.";
    const docs = [{
      id: "doc1",
      name: "Technical Proposal",
      exactFileName: "Technical-Proposal.docx",
      exactOrder: 1,
      documentType: "TECHNICAL_PROPOSAL",
      format: "DOCX",
      generationStatus: "GENERATED",
      validationStatus: "PASSED",
      reviewStatus: "READY_FOR_EXPORT",
      fileContent: cleanContent,
      storagePath: null,
    }];
    const failures = await checkDocumentQualityGate(docs, ctx, {
      TECHNICAL_PROPOSAL: ["Cover Letter", "Understanding of the Assignment", "Technical Approach and Methodology", "Work Plan", "Team Composition", "Compliance Matrix", "Submission Checklist"],
    }, []);
    assert.equal(failures.length, 0, "must NOT block clean content");
  });

  it("4. reopens finalized PDF bytes and blocks client-visible AI traces", async () => {
    const ctx = makeContext();
    const docs = [{
      id: "pdf1",
      name: "Technical Proposal",
      exactFileName: "Technical Proposal.pdf",
      documentType: "TECHNICAL_PROPOSAL",
      format: "PDF",
      generationStatus: "GENERATED",
      validationStatus: "PASSED",
      reviewStatus: "READY_FOR_EXPORT",
      fileContent: await makePdfBase64("Technical Proposal. As an AI, TODO: Bid-Team to confirm this submission."),
      storagePath: null,
      contentMimeType: "application/pdf",
    }];
    const failures = await checkDocumentQualityGate(docs, ctx, {}, []);
    assert.ok(failures.length > 0, "visible blockers inside real PDF bytes must fail the canonical quality gate");
    assert.ok(failures.some((failure) => failure.reasons.some((reason) => /As an AI|AI-generated/i.test(reason))));
  });
});

// ─── 4-5. Conceptual service-stream methodologies ───────────────────────────

describe("4-5. Conceptual service-stream methodologies", () => {
  it("4. all 7 conceptual streams have non-default methodology", () => {
    const streams: ConceptualServiceStream[] = [
      "consultancy", "contract-administration", "construction-management",
      "building-consultancy", "engineering-design", "soil-investigation",
      "infrastructure-consultancy",
    ];
    for (const stream of streams) {
      const m = getMethodologyForConceptualStream(stream);
      assert.ok(m.length >= 4, `${stream} must have at least 4 methodology sections`);
      assert.ok(!m.some((s) => s.title === "Project Understanding and Approach"), `${stream} must NOT use default methodology`);
    }
  });

  it("5. getCombinedConceptualMethodology combines without duplication", () => {
    const m = getCombinedConceptualMethodology(["consultancy", "contract-administration", "construction-management"]);
    const titles = m.map((s) => s.title);
    const unique = new Set(titles);
    assert.equal(titles.length, unique.size, "no duplicate sections");
    assert.ok(m.length >= 10, "must combine multiple streams");
  });

  it("5b. each conceptual methodology has tender-specific content (not generic)", () => {
    const consultancy = getMethodologyForConceptualStream("consultancy");
    assert.ok(consultancy.some((s) => s.title.includes("Scoping") || s.title.includes("Diagnosis")), "consultancy must have scoping/diagnosis");
    assert.ok(consultancy.some((s) => s.title.includes("Recommendations")), "consultancy must have recommendations");

    const contract = getMethodologyForConceptualStream("contract-administration");
    assert.ok(contract.some((s) => s.title.includes("Payment")), "contract-admin must have payment certification");
    assert.ok(contract.some((s) => s.title.includes("Variation")), "contract-admin must have variation management");

    const construction = getMethodologyForConceptualStream("construction-management");
    assert.ok(construction.some((s) => s.title.includes("Schedule") || s.title.includes("Cost")), "construction-mgmt must have schedule/cost control");
    assert.ok(construction.some((s) => s.title.includes("Safety")), "construction-mgmt must have safety management");

    const building = getMethodologyForConceptualStream("building-consultancy");
    assert.ok(building.some((s) => s.title.includes("Condition")), "building-consultancy must have condition assessment");
    assert.ok(building.some((s) => s.title.includes("Compliance") || s.title.includes("Code")), "building-consultancy must have compliance review");

    const engineering = getMethodologyForConceptualStream("engineering-design");
    assert.ok(engineering.some((s) => s.title.includes("Design Basis")), "engineering-design must have design basis");
    assert.ok(engineering.some((s) => s.title.includes("Detailed Design")), "engineering-design must have detailed design");

    const soil = getMethodologyForConceptualStream("soil-investigation");
    assert.ok(soil.some((s) => s.title.includes("Field")), "soil-investigation must have field investigation");
    assert.ok(soil.some((s) => s.title.includes("Laboratory")), "soil-investigation must have laboratory testing");

    const infra = getMethodologyForConceptualStream("infrastructure-consultancy");
    assert.ok(infra.some((s) => s.title.includes("Needs")), "infrastructure-consultancy must have needs assessment");
    assert.ok(infra.some((s) => s.title.includes("Feasibility")), "infrastructure-consultancy must have feasibility");
  });
});

// ─── 6-7. Wiring tests ──────────────────────────────────────────────────────

describe("6-7. Wiring tests", () => {
  it("6. generate-elite.ts imports classifyTender and buildServiceStreamMethodologyBlock", () => {
    const src = read("lib/engine/generate-elite.ts");
    assert.ok(src.includes('from "./tender-classification"'), "must import classifyTender");
    assert.ok(src.includes("classifyTender("), "must call classifyTender");
    assert.ok(src.includes("buildServiceStreamMethodologyBlock"), "must import buildServiceStreamMethodologyBlock");
    assert.ok(src.includes("serviceStreams: detectedServiceStreams"), "must pass serviceStreams to fallbackProposalMarkdown");
    assert.ok(src.includes("buildServiceStreamMethodologyBlock(params.serviceStreams)"), "must inject methodology block in Section C");
  });

  it("7. validate route imports checkFullExportReadinessWithQualityGate and buildTenderDocumentContext", () => {
    const src = read("app/api/tenders/[id]/validate/route.ts");
    assert.ok(src.includes("checkFullExportReadinessWithQualityGate"), "must import quality-gate function");
    assert.ok(src.includes("buildTenderDocumentContext"), "must import buildTenderDocumentContext");
    assert.ok(src.includes("checkFullExportReadinessWithQualityGate({"), "must call quality-gate function");
  });
});

// ─── 8-10. Tender-type-aware blocking tests ─────────────────────────────────

describe("8. EOI tender blocked from generating technical proposal", () => {
  it("8. EOI tender with TECHNICAL_PROPOSAL document is blocked", () => {
    const ctx = makeContext({ tenderType: "EOI" });
    const result = validateGeneratedDocumentQuality(
      "Some content for the technical proposal.",
      "TECHNICAL_PROPOSAL",
      ctx,
      [],
      [],
    );
    assert.ok(result.finalBlockers.some((b) => b.includes("EOI")), "must block EOI generating technical proposal");
    assert.equal(result.okForFinal, false);
  });
});

describe("9. Financial proposal blocked when not required", () => {
  it("9. tender with financialProposalRequired=false + FINANCIAL_PROPOSAL doc is blocked", () => {
    const ctx = makeContext({ financialProposalRequired: false });
    const result = validateGeneratedDocumentQuality(
      "Financial proposal content.",
      "FINANCIAL_PROPOSAL",
      ctx,
      [],
      [],
    );
    assert.ok(result.finalBlockers.some((b) => b.includes("not required")), "must block financial proposal when not required");
    assert.equal(result.okForFinal, false);
  });

  it("9b. tender with financialProposalRequired=false + PRICE_SCHEDULE doc is blocked", () => {
    const ctx = makeContext({ financialProposalRequired: false });
    const result = validateGeneratedDocumentQuality(
      "Price schedule content.",
      "PRICE_SCHEDULE",
      ctx,
      [],
      [],
    );
    assert.ok(result.finalBlockers.some((b) => b.includes("not required")), "must block price schedule when not required");
    assert.equal(result.okForFinal, false);
  });
});

describe("10. AI traces and placeholders blocked", () => {
  it("10. AI trace content is blocked from final", () => {
    const ctx = makeContext();
    const result = validateGeneratedDocumentQuality(
      "As an AI, I generated this proposal. AI-generated content here.",
      "TECHNICAL_PROPOSAL",
      ctx,
      [],
      [],
    );
    assert.ok(result.finalBlockers.some((b) => b.includes("As an AI")), "must block AI trace");
    assert.equal(result.okForFinal, false);
  });

  it("10b. TODO/TBD/Bid-Team placeholders are blocked from final", () => {
    const ctx = makeContext();
    const result = validateGeneratedDocumentQuality(
      "This proposal has TODO items. TBD: confirm details. Bid-Team to confirm the price.",
      "TECHNICAL_PROPOSAL",
      ctx,
      [],
      [],
    );
    assert.ok(result.finalBlockers.some((b) => b.includes("TODO")), "must block TODO");
    assert.ok(result.finalBlockers.some((b) => b.includes("TBD")), "must block TBD");
    assert.ok(result.finalBlockers.some((b) => b.includes("Bid-Team")), "must block Bid-Team");
    assert.equal(result.okForFinal, false);
  });

  it("10c. financial content in technical proposal is blocked (envelope contamination)", () => {
    const ctx = makeContext({ tenderType: "RFP" });
    const techDocWithPricing = "Cover Letter\nUnderstanding\nMethodology\nWork Plan\nTeam\nCompliance Matrix\nSubmission Checklist\n\nThe price is ETB 5000 per unit. Total fee ETB 100000. Lump sum ETB 200000. Unit price ETB 500. Rate ETB 100/hr. Quotation ETB 5000.";
    const result = validateGeneratedDocumentQuality(
      techDocWithPricing,
      "TECHNICAL_PROPOSAL",
      ctx,
      ["Cover Letter", "Understanding", "Methodology", "Work Plan", "Team", "Compliance Matrix", "Submission Checklist"],
      [],
    );
    assert.ok(result.finalBlockers.some((b) => b.includes("envelope contamination")), "must block financial content in technical proposal");
    assert.equal(result.okForFinal, false);
  });
});
