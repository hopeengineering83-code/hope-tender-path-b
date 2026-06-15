import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildTenderCriterionGraph, renderTenderCriterionGraph } from "../lib/engine/evaluation/tender-criterion-graph";

const baseInput = {
  tenderTitle: "RFP for Hospital Design and Supervision Services",
  clientName: "Health Client",
  expertLines: ["Reviewed expert: Senior architect with hospital supervision CV."],
  projectLines: ["Reviewed project: Hospital design, supervision and handover for healthcare client."],
  companyEvidenceLines: ["Company evidence: valid registration certificate and tax clearance."],
  projectEvidenceLines: [],
  complianceLines: ["Submit separate technical and financial proposals in sealed envelopes."],
  differentiators: [],
};

describe("tender criterion graph", () => {
  it("classifies eligibility, personnel, experience, commercial, submission and disqualification criteria", () => {
    const graph = buildTenderCriterionGraph({
      ...baseInput,
      requirements: [
        "Bidders must submit a valid business registration certificate and tax clearance certificate.",
        "Provide CVs for key professional staff with at least 10 years of experience.",
        "Provide similar hospital project references and completion certificates.",
        "Financial proposal must include priced BOQ, currency, tax and validity.",
        "Technical and financial proposals must be submitted in separate sealed envelopes before the deadline.",
        "Failure to submit signed forms shall result in rejection of the proposal.",
      ],
    });

    const categories = graph.nodes.map((node) => node.category);
    assert.ok(categories.includes("ELIGIBILITY"));
    assert.ok(categories.includes("PERSONNEL"));
    assert.ok(categories.includes("EXPERIENCE"));
    assert.ok(categories.includes("COMMERCIAL"));
    assert.ok(categories.includes("SUBMISSION"));
    assert.ok(categories.includes("DISQUALIFICATION"));
    assert.ok(graph.summary.mandatoryCount >= 3);
    assert.ok(graph.summary.criticalCount >= 1);
  });

  it("marks mandatory missing evidence as critical and export-blocking", () => {
    const graph = buildTenderCriterionGraph({
      ...baseInput,
      expertLines: [],
      projectLines: [],
      companyEvidenceLines: [],
      complianceLines: [],
      requirements: ["Bidders must submit valid audited accounts and a bank statement."],
    });

    assert.equal(graph.nodes[0].category, "ELIGIBILITY");
    assert.equal(graph.nodes[0].mandatory, true);
    assert.equal(graph.nodes[0].riskLevel, "CRITICAL");
    assert.match(graph.nodes[0].validationAction, /Block final export/i);
  });

  it("renders a proposal-ready criterion graph section", () => {
    const rendered = renderTenderCriterionGraph({
      ...baseInput,
      requirements: ["Provide hospital design methodology and reviewed similar project references."],
    });

    assert.match(rendered, /Tender Criterion Graph/i);
    assert.match(rendered, /Criterion graph summary/i);
    assert.match(rendered, /TCG-1/i);
    assert.match(rendered, /Proposal section/i);
  });
});
