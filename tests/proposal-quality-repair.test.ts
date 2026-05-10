import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { applyProposalQualityRepairAddenda } from "../lib/engine/proposal-quality-repair";
import { scoreProposalQuality } from "../lib/engine/proposal-quality-scorer";

const input = {
  tenderTitle: "Hospital Design and Supervision RFP",
  clientName: "Health Client",
  requirements: [
    "Provide hospital design and interior design methodology.",
    "Provide reviewed similar healthcare facility project experience.",
    "Provide qualified experts and CVs for supervision and contract administration.",
  ],
  expertLines: ["Reviewed expert: Senior architect with hospital planning and supervision experience."],
  projectLines: ["Reviewed project: Hospital and specialty clinic design, interior design, supervision and handover for healthcare client."],
  companyEvidenceLines: ["Company evidence: reviewed registration, engineering consultancy licence and company profile."],
  projectEvidenceLines: [],
  complianceLines: ["Submission must include signed technical proposal in PDF format."],
  differentiators: ["Healthcare workflow and multidisciplinary design-supervision capability."],
};

describe("applyProposalQualityRepairAddenda", () => {
  it("adds evaluator-critical Section E/F/G/H controls when missing", () => {
    const repaired = applyProposalQualityRepairAddenda("# Cover Letter\n\nWe submit this proposal.\n\n# Executive Summary\n\nHospital project response.", input);

    assert.match(repaired, /Section E: Compliance Matrix/i);
    assert.match(repaired, /Section F: Evaluation Criteria Response Mirror/i);
    assert.match(repaired, /Section G: Win Themes & Discriminators/i);
    assert.match(repaired, /Section H: Proposal Self-Score/i);
    assert.match(repaired, /FULLY MET|PARTIALLY MET|NOT MET/i);
    assert.match(repaired, /\d+\/10/i);
  });

  it("improves deterministic quality scoring axes for sparse drafts", () => {
    const sparse = "# Cover Letter\n\nWe submit this proposal.\n\n# Executive Summary\n\nHospital project response.";
    const before = scoreProposalQuality({ markdown: sparse, primarySector: "Healthcare / Medical Facility Design", topProjects: [] });
    const repaired = applyProposalQualityRepairAddenda(sparse, input);
    const after = scoreProposalQuality({ markdown: repaired, primarySector: "Healthcare / Medical Facility Design", topProjects: [] });

    assert.ok(after.axes.complianceMatrixCoverage >= before.axes.complianceMatrixCoverage);
    assert.ok(after.axes.evaluatorMirrorCoverage >= before.axes.evaluatorMirrorCoverage);
    assert.ok(after.axes.winThemesPresence >= before.axes.winThemesPresence);
    assert.ok(after.axes.selfScorePresence >= before.axes.selfScorePresence);
  });
});
