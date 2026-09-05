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
    // Sections F and G ship under client-facing names. "Evaluation Criteria
    // Response Mirror", "Win Themes" and "Discriminators" are bid-desk
    // vocabulary and a real proposal shipped them to the procuring entity.
    assert.match(repaired, /Section F: Response to Evaluation Criteria/i);
    assert.match(repaired, /Section G: Why We Are Well Suited/i);
    assert.doesNotMatch(repaired, /response\s+mirror/i);
    assert.doesNotMatch(repaired, /win\s+themes?/i);
    assert.doesNotMatch(repaired, /\bdiscriminators?\b/i);
    // The third column of Section G used to print the engine's instruction to
    // its own bid team ("Use reviewed evidence and remove unsupported claims
    // before export.") in the cell reserved for the client's proof. Scope the
    // check to Section G: Section H is an internal self-score that the
    // internal-review stripper removes before render, and it legitimately
    // talks about pre-export controls.
    const sectionGBody = repaired.slice(repaired.search(/## Section G:/i), repaired.search(/## Section H:/i));
    assert.doesNotMatch(sectionGBody, /before\s+export/i);
    assert.match(repaired, /Section H: Proposal Self-Score/i);
    assert.match(repaired, /FULLY MET|PARTIALLY MET|NOT MET/i);
    assert.match(repaired, /\d+\/10/i);
  });

  it("returns markdown unchanged when all required sections are already present", () => {
    const complete = [
      "# Cover Letter\n\nDear Evaluation Committee,\n\nWe submit this proposal.\n\n# Executive Summary\n\nHospital project response.",
      "## Section E: Compliance Matrix\n\n| Requirement | Status |\n| --- | --- |\n| Design | FULLY MET |",
      "## Section F: Evaluation Criteria Response Mirror\n\n| Criterion | Score |\n| --- | --- |\n| Technical | 8/10 |",
      "## Section G: Win Themes & Discriminators\n\nKey win themes...",
      "## Section H: Proposal Self-Score\n\nOverall: 85/100",
    ].join("\n\n");

    const repaired = applyProposalQualityRepairAddenda(complete, input);
    assert.equal(repaired, complete);
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
