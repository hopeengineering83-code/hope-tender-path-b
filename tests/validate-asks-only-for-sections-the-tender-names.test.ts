/**
 * The recovery Validate check reads a generic section table (Cover Letter …
 * Submission Checklist). On the real WHH feasibility-study ToR (inspect run
 * 37641861622) it failed the Technical Proposal for "Missing required
 * sections: Technical Approach and Methodology, Submission Checklist" while
 * every export gate counted the same document export-ready. The ToR asks for
 * a "proposed methodology" and no checklist. A heading the tender never names
 * is not a requirement; one it does name still is.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import type { TenderDocumentGenerationContext } from "../lib/document-generation/tender-document-context";
import { checkDocumentQualityGate, tenderNamesSection, DEFAULT_REQUIRED_SECTIONS_BY_TYPE } from "../lib/engine/export-readiness";

function ctx(overrides: Partial<TenderDocumentGenerationContext> = {}): TenderDocumentGenerationContext {
  return {
    tenderId: "t", tenderType: "RFP", serviceStreams: [], projectTitle: "Feasibility study", clientName: "Client",
    submissionMethod: "Portal", deadline: null, financialProposalRequired: true,
    scopeOfServices: ["Assess WASH service delivery"],
    deliverables: ["Inception report", "Final feasibility study"],
    evaluationCriteria: ["Understanding of the assignment", "Proposed methodology"],
    mandatoryRequirements: ["Team Leader with a Master's degree"],
    requiredDocuments: ["Technical Proposal", "Financial Proposal"],
    selectedExperts: [], selectedProjects: [], selectedLegalDocuments: [], selectedCompanyAssets: [],
    companyProfile: { name: "Firm", description: null, country: null, website: null, serviceLines: [], establishedYear: null },
    warnings: [],
    ...overrides,
  } as TenderDocumentGenerationContext;
}

const proposal = (text: string) => [{
  id: "doc1", name: "Technical Proposal", exactFileName: "Technical Proposal.docx", exactOrder: 1,
  documentType: "TECHNICAL_PROPOSAL", format: "DOCX", generationStatus: "GENERATED", validationStatus: "PASSED",
  reviewStatus: "READY_FOR_EXPORT", fileContent: text, storagePath: null,
}];

const WITHOUT_CHECKLIST = [
  "Cover Letter", "Understanding of the Assignment", "Proposed Methodology", "Work Plan", "Team Composition", "Compliance Matrix",
  "", "We are pleased to submit our proposal for the feasibility study. Our team has delivered comparable WASH assessments.",
].join("\n");

describe("Validate asks only for the sections the tender names", () => {
  it("a heading the tender never names is not required", async () => {
    const failures = await checkDocumentQualityGate(proposal(WITHOUT_CHECKLIST), ctx(), DEFAULT_REQUIRED_SECTIONS_BY_TYPE, []);
    assert.deepEqual(failures.flatMap((f) => f.reasons).filter((r) => /Missing required sections/.test(r)), []);
  });

  it("a heading the tender names is still required", async () => {
    const asks = ctx({ requiredDocuments: ["Technical Proposal", "Submission Checklist"] });
    const failures = await checkDocumentQualityGate(proposal(WITHOUT_CHECKLIST), asks, DEFAULT_REQUIRED_SECTIONS_BY_TYPE, []);
    const reasons = failures.flatMap((f) => f.reasons).join(" ");
    assert.match(reasons, /Missing required sections: [^;]*Submission Checklist/);
  });

  it("matches whole words, ignoring case and '&'", () => {
    const c = ctx({ evaluationCriteria: ["Technical approach & methodology (40%)"] });
    assert.equal(tenderNamesSection("Technical Approach and Methodology", c), true);
    assert.equal(tenderNamesSection("Work Plan", ctx({ deliverables: ["Workplanning"] })), false);
  });
});
