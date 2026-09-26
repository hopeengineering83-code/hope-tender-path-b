// A requirement that says which declared file it belongs to is a section of
// that file, not a file beside it.
//
// AI Analyze returned "Cover Letter" and "Company Profile" as MANDATORY rows
// with no file name and sectionReference "Technical Proposal - Required
// Sections", on a tender whose declared file is "Technical Proposal.pdf". The
// planner made each its own .docx; the confirmed Build Plan required three
// files and the delivered ZIP carried Technical Proposal.pdf, Cover
// Letter.docx and Company Profile.docx for a tender that asks for one PDF.
// Fixture rows are generic.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { buildSubmissionPlan, plannedSubmissionTargetFiles } from "../lib/engine/submission-plan";

const CONTAINER = "Technical Proposal - Required Sections";

function row(id: string, title: string, requirementType: string, priority: string, sectionReference: string | null) {
  return { id, title, requirementType, priority, sectionReference, description: `${title} for the assignment.` };
}

function plan(requirements: ReturnType<typeof row>[], exactFileNaming = ["Technical Proposal.pdf"]) {
  return buildSubmissionPlan({ id: "t", title: "Clinic Design", exactFileNaming: JSON.stringify(exactFileNaming), requirements } as never);
}

describe("a section of the named file is not a second file", () => {
  it("folds rows whose section reference names the declared file into it", () => {
    const p = plan([
      row("c", "Cover Letter", "COMPANY_PROFILE", "MANDATORY", CONTAINER),
      row("d", "Company Profile", "COMPANY_PROFILE", "MANDATORY", CONTAINER),
      row("m", "Technical Approach and Methodology", "METHODOLOGY", "SCORED", `[methodology:advisory] ${CONTAINER}`),
    ]);
    assert.deepEqual(plannedSubmissionTargetFiles(p).map((f) => f.exactFileName), ["Technical Proposal.pdf"]);
    assert.deepEqual(p.files.map((f) => f.exactFileName), ["Technical Proposal.pdf"]);
    assert.deepEqual([...p.files[0].sourceRequirementIds].sort(), ["c", "d", "m"], "provenance moves to the container");
  });

  it("keeps a row that does not name a declared file as its container", () => {
    const p = plan([row("c", "Cover Letter", "COMPANY_PROFILE", "MANDATORY", "Page 3")]);
    assert.deepEqual(plannedSubmissionTargetFiles(p).map((f) => f.exactFileName), ["Technical Proposal.pdf", "Cover Letter.docx"]);
  });

  it("keeps separate files when the tender declares no file to fold into", () => {
    const p = plan([row("c", "Cover Letter", "COMPANY_PROFILE", "MANDATORY", CONTAINER)], []);
    assert.deepEqual(plannedSubmissionTargetFiles(p).map((f) => f.exactFileName), ["Cover Letter.docx"]);
  });
});
