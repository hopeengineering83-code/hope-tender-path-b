// A deliverable the tender names stays in the Build Plan whatever its
// restrictions mention.
//
// A freshly analysed tender carried one file requirement: exactFileName
// "Technical Proposal.pdf", restrictions "PDF electronic submission only.
// Financial proposal is excluded." The Build Plan draft loaded requirements
// without `restrictions` and planned the file; the automatic confirmation
// re-derived the plan from full rows, where the restrictions became the
// file's notes, and plannedFileIsARule read "Financial proposal is excluded"
// as a no-financial rule and dropped the file. Run Engine failed
// BUILD_PLAN_AUTOMATION_BLOCKED ("item count does not match ...";
// "Technical Proposal.pdf ... is not in current tender-controlled scope").
// The row classifier had the same flaw one level earlier: a description
// saying "Do not submit a financial proposal" made the row itself a rule.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { plannedFileIsARule } from "../lib/engine/submission-plan-classifier";
import { buildSubmissionPlan, plannedSubmissionTargetFiles } from "../lib/engine/submission-plan";

const FULL_ROW = {
  id: "req-1",
  title: "Technical Proposal Document Submission",
  requirementType: "FORMAT",
  priority: "MANDATORY",
  exactFileName: "Technical Proposal.pdf",
  exactOrder: null,
  requiredQuantity: null,
  pageLimit: null,
  restrictions: "PDF electronic submission only. Financial proposal is excluded.",
  sectionReference: "Page 3",
  description: "Submit a single PDF containing the technical proposal. Do not submit a financial proposal at this stage.",
};

function planned(requirement: Record<string, unknown>) {
  return plannedSubmissionTargetFiles(buildSubmissionPlan({ id: "t", title: "Clinic Design", requirements: [requirement] } as never))
    .map((f) => `${f.exactOrder}:${f.exactFileName}:${f.documentType}`);
}

describe("a named deliverable is not a rule because of its restrictions", () => {
  it("keeps Technical Proposal.pdf when its notes exclude the financial proposal", () => {
    assert.equal(plannedFileIsARule({ exactFileName: "Technical Proposal.pdf", notes: FULL_ROW.restrictions, documentType: "FORMAT" }).rule, false);
  });

  it("plans the same file from full rows and from rows without restrictions", () => {
    const { restrictions: _r, requiredQuantity: _q, pageLimit: _p, sectionReference: _s, ...slim } = FULL_ROW;
    assert.deepEqual(planned(FULL_ROW), ["1:Technical Proposal.pdf:FORMAT"]);
    assert.deepEqual(planned(slim), planned(FULL_ROW));
  });

  it("still treats rule-named files as rules", () => {
    assert.equal(plannedFileIsARule({ exactFileName: "No Financial Proposal.docx", notes: null, documentType: null }).rule, true);
    assert.equal(plannedFileIsARule({ exactFileName: "Email Submission.docx", notes: null, documentType: null }).rule, true);
    assert.equal(plannedFileIsARule({ exactFileName: "Technical Proposal Only.docx", notes: null, documentType: null }).rule, true);
    // A name that is a deliverable only by the classifier's fallback is still judged with its notes.
    assert.equal(plannedFileIsARule({ exactFileName: "Submission.docx", notes: "No financial proposal may be included", documentType: null }).rule, true);
  });

  it("the draft loads every requirement field the planner reads", () => {
    const src = readFileSync("lib/engine/build-plan.ts", "utf8");
    const preflight = src.slice(src.indexOf("export async function assertTenderReadyToDraftBuildPlan"), src.indexOf("// 2. At least one ACTIVE TenderFile"));
    for (const field of ["restrictions", "requiredQuantity", "pageLimit", "sectionReference"]) {
      assert.match(preflight, new RegExp(`${field}: true`), field);
    }
  });
});
