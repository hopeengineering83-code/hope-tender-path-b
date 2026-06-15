import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { applyProposalEvaluatorLoop, evaluateProposalAgainstContract } from "../lib/engine/evaluation/proposal-evaluator-loop";

const contractInput = {
  tenderTitle: "RFP for Hospital Design and Supervision Services",
  clientName: "Health Client",
  requirements: [
    "[page 4] Bidders must submit separate technical and financial proposals.",
    "[page 8] Bidders must provide similar hospital project references and completion certificates.",
    "[page 11] Provide CVs for key professional staff for design and supervision.",
  ],
  expertLines: ["Reviewed expert: Senior architect with hospital design and supervision CV."],
  projectLines: ["Reviewed project: Hospital and specialty clinic design, supervision and handover for healthcare client."],
  companyEvidenceLines: ["Company evidence: valid registration certificate and tax clearance."],
  projectEvidenceLines: ["Project evidence: completion certificate for hospital facility assignment."],
  complianceLines: ["Submit separate technical and financial proposal envelopes before the deadline."],
  differentiators: ["Healthcare workflow and multidisciplinary design-supervision capability."],
  selectedExpertCount: 1,
  selectedProjectCount: 1,
  reviewedExpertCount: 1,
  reviewedProjectCount: 1,
  tenderSources: [
    {
      id: "source-1",
      name: "hospital-rfp.pdf",
      text: [
        "[page 4] Bidders must submit separate technical and financial proposals.",
        "[page 8] Bidders must provide similar hospital project references and completion certificates.",
        "[page 11] Provide CVs for key professional staff for design and supervision.",
      ].join("\n\n"),
    },
  ],
};

describe("proposal evaluator loop", () => {
  it("warns or blocks weak drafts before finalization", () => {
    const result = evaluateProposalAgainstContract({
      markdown: "# Cover Letter\nWe submit a generic proposal. TODO: add project references.",
      contractInput,
    });

    assert.notEqual(result.status, "PASS");
    assert.ok(result.score < 75);
    assert.ok(result.issues.some((item) => item.axis === "Final prose safety" && item.severity === "BLOCK"));
    assert.match(result.repairAddendum, /Proposal Evaluator Loop/);
    assert.match(result.repairAddendum, /Repair Pass/);
  });

  it("appends a contract evaluator report to proposal markdown", () => {
    const output = applyProposalEvaluatorLoop(
      [
        "# Cover Letter",
        "This hospital design and supervision proposal responds to the requirement to submit separate technical and financial proposals.",
        "# Technical Approach",
        "We provide similar hospital project references, completion certificates, and CVs for key professional staff for design and supervision.",
      ].join("\n\n"),
      contractInput,
    );

    assert.match(output, /Proposal Evaluator Loop/);
    assert.match(output, /Source-grounded requirement response coverage/);
    assert.match(output, /Evidence graph fit/);
    assert.match(output, /Tender form and envelope control/);
  });
});
