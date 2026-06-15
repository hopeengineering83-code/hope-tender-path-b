import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildSourceGroundedRequirementMap, renderSourceGroundedRequirementMap } from "../lib/engine/compliance/source-grounded-requirement-map";
import { buildProposalIntelligenceContract } from "../lib/engine/generation/proposal-intelligence-contract";

const tenderText = `
[page 4]
3.1 Eligibility Requirements
Bidders must submit valid audited accounts and a bank statement for the last three years. Failure to submit these documents may result in rejection.

[page 7]
4.2 Technical Proposal
The consultant shall provide a methodology, work plan, QA/QC process and deliverables for hospital design and supervision services.
`;

describe("source-grounded requirement map", () => {
  it("maps requirements to source quote, page, heading and confidence", () => {
    const map = buildSourceGroundedRequirementMap({
      requirements: [
        "Bidders must submit valid audited accounts and a bank statement.",
        "The consultant shall provide a methodology, work plan, QA/QC process and deliverables.",
      ],
      tenderSources: [{ id: "file-1", name: "Tender.pdf", text: tenderText }],
      minConfidence: 0.2,
    });

    assert.equal(map.length, 2);
    assert.equal(map[0].sourceTenderFileId, "file-1");
    assert.equal(map[0].sourceTenderFileName, "Tender.pdf");
    assert.equal(map[0].sourcePageNumber, 4);
    assert.match(map[0].sourceExactQuote ?? "", /audited accounts/i);
    assert.ok(map[0].sourceConfidence > 0);
    assert.equal(map[0].grounded, true);
    assert.match(map[0].validationAction, /Source-grounded|Confirm source quote/i);
  });

  it("marks untraced mandatory requirements as export blockers", () => {
    const map = buildSourceGroundedRequirementMap({
      requirements: ["Bidders must submit a manufacturer authorization letter."],
      tenderSources: [{ id: "file-1", name: "Tender.pdf", text: tenderText }],
      minConfidence: 0.5,
    });

    assert.equal(map[0].grounded, false);
    assert.match(map[0].validationAction, /Block final export/i);
  });

  it("renders source map for proposal controls", () => {
    const map = buildSourceGroundedRequirementMap({
      requirements: ["Bidders must submit valid audited accounts and a bank statement."],
      tenderSources: [{ id: "file-1", name: "Tender.pdf", text: tenderText }],
      minConfidence: 0.2,
    });
    const rendered = renderSourceGroundedRequirementMap({ sourceMap: map });

    assert.match(rendered, /Source-Grounded Requirement Map/i);
    assert.match(rendered, /Tender\.pdf/i);
    assert.match(rendered, /SRC-REQ-1/i);
  });

  it("adds source grounding to the proposal intelligence contract and export gates", () => {
    const contract = buildProposalIntelligenceContract({
      tenderTitle: "RFP for Hospital Design Services",
      clientName: "Health Client",
      requirements: [
        "Bidders must submit valid audited accounts and a bank statement.",
        "The consultant shall provide a methodology, work plan, QA/QC process and deliverables.",
      ],
      tenderSources: [{ id: "file-1", name: "Tender.pdf", text: tenderText }],
      expertLines: [],
      projectLines: [],
      companyEvidenceLines: [],
      projectEvidenceLines: [],
      complianceLines: [],
      differentiators: [],
    });

    assert.equal(contract.schemaVersion, "PIC-3");
    assert.ok(contract.sourceGrounding.length >= 2);
    assert.ok(contract.requirements.every((req) => req.sourceGrounding));
    assert.ok(contract.exportGates.some((gate) => gate.gate === "Tender source grounding control"));
    assert.ok(contract.exportGates.some((gate) => gate.gate === "Evidence graph fit control"));
  });
});
