// A requirement that describes a deliverable is not a second deliverable.
//
// WHY THIS FILE EXISTS
// --------------------
// The Pharo tender names exactly one file — exactFileNaming
// ["Technical Proposal.pdf"] — and separately carries a MANDATORY FORMAT
// requirement titled "Technical Proposal Structure", which says how that
// proposal must be structured. The planner turned the second into its own
// required deliverable, "Technical Proposal Structure.docx". Generation then
// wrote the entire 11,590-word technical proposal into THAT file and
// superseded the correctly named one, so a single release snapshot reported
// both EXTRA_FILES and "MISSING_REQUIRED_FILES: technical proposal.pdf" — the
// deliverable existed, under a name the tender never asked for, and the
// package could not converge.
//
// The tender's own list of file names is the authority on what the
// deliverables ARE; a requirement title is a description of one. Folding is by
// name containment and applies only to rows carrying no exactFileName of their
// own, so a row that names its own file still gets one and a genuinely
// different deliverable is untouched.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildSubmissionPlan } from "../lib/engine/submission-plan";

function tenderWith(requirements: Array<Record<string, unknown>>, exactFileNaming: string) {
  return {
    id: "t1",
    title: "Architectural Consultancy Services",
    exactFileNaming,
    exactFileOrder: null,
    submissionMethod: "Email",
    requirements: requirements.map((r, index) => ({
      id: `r${index + 1}`,
      description: null,
      exactFileName: null,
      exactOrder: null,
      restrictions: null,
      pageLimit: null,
      sectionReference: null,
      ...r,
    })),
  } as never;
}

describe("one named deliverable stays one file", () => {
  it("folds a FORMAT row that elaborates the named file instead of adding a second one", () => {
    const plan = buildSubmissionPlan(tenderWith(
      [
        { title: "Technical Proposal Document Submission", requirementType: "SUBMISSION_RULE", priority: "MANDATORY", exactFileName: "Technical Proposal.pdf" },
        { title: "Technical Proposal Structure", requirementType: "FORMAT", priority: "MANDATORY" },
      ],
      JSON.stringify(["Technical Proposal.pdf"]),
    ));

    const names = plan.files.map((file) => file.exactFileName);
    assert.ok(names.includes("Technical Proposal.pdf"), `expected the named deliverable, got ${names.join(", ")}`);
    assert.equal(
      names.some((name) => /technical proposal structure/i.test(name)),
      false,
      `the format rule must not become its own file: ${names.join(", ")}`,
    );
  });

  it("moves the folded row's provenance onto the file it describes", () => {
    const plan = buildSubmissionPlan(tenderWith(
      [{ title: "Technical Proposal Structure", requirementType: "FORMAT", priority: "MANDATORY" }],
      JSON.stringify(["Technical Proposal.pdf"]),
    ));
    const proposal = plan.files.find((file) => file.exactFileName === "Technical Proposal.pdf");
    assert.ok(proposal, "the declared deliverable must be planned");
    assert.deepEqual(proposal.sourceRequirementIds, ["r1"], "the requirement it describes must remain traceable");
  });

  it("still plans a genuinely different deliverable", () => {
    const plan = buildSubmissionPlan(tenderWith(
      [
        { title: "Technical Proposal Structure", requirementType: "FORMAT", priority: "MANDATORY" },
        { title: "Annexes for Supporting Documents", requirementType: "ANNEX", priority: "MANDATORY" },
      ],
      JSON.stringify(["Technical Proposal.pdf"]),
    ));
    const names = plan.files.map((file) => file.exactFileName);
    assert.ok(names.includes("Technical Proposal.pdf"));
    assert.ok(
      names.some((name) => /annexes for supporting documents/i.test(name)),
      `an unrelated deliverable must survive: ${names.join(", ")}`,
    );
  });

  it("still plans a row that names its own file", () => {
    const plan = buildSubmissionPlan(tenderWith(
      [{ title: "Technical Proposal Summary Sheet", requirementType: "FORMAT", priority: "MANDATORY", exactFileName: "Technical Proposal Summary Sheet.docx" }],
      JSON.stringify(["Technical Proposal.pdf"]),
    ));
    const names = plan.files.map((file) => file.exactFileName);
    assert.ok(
      names.includes("Technical Proposal Summary Sheet.docx"),
      `a row with its own exactFileName is a deliverable the tender named: ${names.join(", ")}`,
    );
  });
});
