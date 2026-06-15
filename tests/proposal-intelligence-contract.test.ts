import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildProposalIntelligenceContract, renderProposalIntelligenceContract, renderProposalIntelligencePromptBlock } from "../lib/engine/generation/proposal-intelligence-contract";

const baseInput = {
  tenderTitle: "RFP for Hospital Design, Interior Design, Supervision and Contract Administration Services",
  clientName: "Health Client",
  requirements: [
    "Technical and financial proposals must be submitted separately in two envelopes.",
    "Bidders must provide similar hospital project references and completion certificates.",
    "Provide CVs for key professional staff for design, supervision and contract administration.",
    "The proposal shall include methodology, work plan, QA/QC and deliverables.",
  ],
  expertLines: ["Reviewed expert: Senior architect with hospital design and supervision CV."],
  projectLines: ["Reviewed project: Hospital and specialty clinic design, interior design, supervision and handover for healthcare client."],
  companyEvidenceLines: ["Company evidence: valid registration certificate and tax clearance."],
  projectEvidenceLines: ["Project evidence: completion certificate for hospital facility assignment."],
  complianceLines: ["Submit separate technical and financial proposal envelopes before the deadline."],
  differentiators: ["Healthcare workflow and multidisciplinary design-supervision capability."],
  selectedExpertCount: 1,
  selectedProjectCount: 1,
  reviewedExpertCount: 1,
  reviewedProjectCount: 1,
};

describe("proposal intelligence contract", () => {
  it("builds a single controlling contract from form strategy, criterion graph, blueprint and evidence", () => {
    const contract = buildProposalIntelligenceContract(baseInput);

    assert.equal(contract.schemaVersion, "PIC-3");
    assert.equal(contract.tender.primaryTenderForm, "RFP");
    assert.equal(contract.tender.isTwoEnvelope, true);
    assert.ok(contract.criterionGraph.nodes.length >= 4);
    assert.ok(contract.requirements.some((item) => item.category === "EXPERIENCE"));
    assert.ok(contract.requirements.some((item) => item.category === "PERSONNEL"));
    assert.ok(contract.sectionPlan.length >= 2);
    assert.ok(contract.exportGates.some((gate) => gate.gate === "Commercial / technical separation" && gate.status === "WARN"));
    assert.ok(contract.exportGates.some((gate) => gate.gate === "Tender source grounding control"));
    assert.ok(contract.exportGates.some((gate) => gate.gate === "Evidence graph fit control"));
    assert.ok(contract.writingRules.some((rule) => /DIRECT evidence/i.test(rule)));
  });

  it("blocks final export when mandatory evidence is missing", () => {
    const contract = buildProposalIntelligenceContract({
      ...baseInput,
      expertLines: [],
      projectLines: [],
      companyEvidenceLines: [],
      projectEvidenceLines: [],
      complianceLines: [],
      requirements: ["Bidders must submit valid audited accounts and a bank statement."],
      selectedExpertCount: 0,
      selectedProjectCount: 0,
      reviewedExpertCount: 0,
      reviewedProjectCount: 0,
    });

    const criticalGate = contract.exportGates.find((gate) => gate.gate === "Critical criterion control");
    assert.equal(criticalGate?.status, "BLOCK");
    assert.match(criticalGate?.action ?? "", /Block final export/i);
    assert.ok(contract.evidenceSummary.missingBlueprintEvidence >= 1);
  });

  it("renders proposal and prompt blocks for downstream proposal writing", () => {
    const rendered = renderProposalIntelligenceContract(baseInput);
    const prompt = renderProposalIntelligencePromptBlock(baseInput);

    assert.match(rendered, /Proposal Intelligence Contract/i);
    assert.match(rendered, /Source-Grounded Requirement Map/i);
    assert.match(rendered, /Evidence Graph Selection Model/i);
    assert.match(rendered, /Contract Section Plan/i);
    assert.match(rendered, /Contract Export Gates/i);
    assert.match(prompt, /PROPOSAL INTELLIGENCE CONTRACT/i);
    assert.match(prompt, /Source grounding/i);
    assert.match(prompt, /Evidence graph/i);
    assert.match(prompt, /Section writing plan/i);
    assert.match(prompt, /Export gates/i);
  });
});
