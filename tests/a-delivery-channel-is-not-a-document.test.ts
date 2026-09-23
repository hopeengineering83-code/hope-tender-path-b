// 2026-09-23, Preview: the confirmed Build Plan required a file named
// "Email Submission.docx". It says HOW the package is sent, not WHAT is in it,
// so no automatic step could ever produce it and AUTO_FINALIZE could never
// converge (UNGENERATED_PLANNED_DOCUMENTS / SUBMISSION_PLAN_DOCUMENTS_MISSING).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { classifySubmissionPlanItem } from "../lib/engine/submission-plan-classifier";
import { buildSubmissionPlan } from "../lib/engine/submission-plan";
import { findNonDeliverablePlanItems } from "../lib/engine/build-plan";

const cls = (name: string) => classifySubmissionPlanItem({ title: name, exactFileName: name });

describe("a delivery channel is not a document", () => {
  for (const name of ["Email Submission", "Email Submission.docx", "E-mail Submission", "Online Portal Submission", "Hard Copy Submission", "Courier Submission", "Submission via email"]) {
    it(`"${name}" is a submission rule`, () => {
      const r = cls(name);
      assert.equal(r.category, "SUBMISSION_RULE");
      assert.equal(r.shouldBePlannedFile, false);
    });
  }

  for (const name of ["Email Submission Form", "Online Submission Cover Letter", "Bid Submission Form.docx", "Cover Letter", "Technical Proposal.pdf", "Company Profile"]) {
    it(`"${name}" still names a document`, () => {
      assert.equal(cls(name).shouldBePlannedFile, true);
    });
  }

  it("a tender-stated file list does not turn a channel into a required file", () => {
    const plan = buildSubmissionPlan({
      id: "t",
      exactFileNaming: JSON.stringify(["Technical Proposal.pdf", "Email Submission"]),
      requirements: [],
    } as any);
    assert.deepEqual(plan.files.map((f) => f.exactFileName), ["Technical Proposal.pdf"]);
  });

  it("a confirmed plan that still requires one is reported as stale", () => {
    const phantom = findNonDeliverablePlanItems([
      { exactFileName: "Technical Proposal.pdf", documentType: "TECHNICAL_PROPOSAL" } as any,
      { exactFileName: "Email Submission.docx", documentType: "SUBMISSION_RULES" } as any,
    ]);
    assert.deepEqual(phantom.map((p) => p.exactFileName), ["Email Submission.docx"]);
  });
});

describe("a freshly built plan is never stale by construction", () => {
  // The live requirement was typed SUBMISSION_RULE and its description mentioned
  // the proposal, so the builder kept "Email Submission.docx" while the stale-plan
  // detector rejected it: every Run Engine confirmed a plan the next read called
  // stale, and generation never started.
  const req = (id: string, title: string, description: string, requirementType: string) =>
    ({ id, title, description, requirementType, priority: "MANDATORY" });

  const shapes = [
    [req("e1", "Email Submission", "Submit the technical proposal via email to procurement@example.org.", "SUBMISSION_RULE")],
    [req("e2", "Email Submission", "Proposals must be emailed as one PDF attachment.", "SUBMISSION_RULE")],
    [req("e3", "Online Portal Submission", "Upload the proposal on the e-procurement portal.", "SUBMISSION_RULE")],
    [req("e4", "Submission Deadline", "Proposals must reach the client before 25 August 2026.", "SUBMISSION_RULE")],
  ];

  for (const requirements of shapes) {
    it(`"${requirements[0]!.title}" (${requirements[0]!.description}) is not planned as a file`, () => {
      const plan = buildSubmissionPlan({
        id: "t",
        exactFileNaming: JSON.stringify(["Technical Proposal.pdf"]),
        requirements: [...requirements, req("c1", "Cover Letter", "Submit a signed cover letter.", "TECHNICAL")],
      } as any);
      assert.deepEqual(findNonDeliverablePlanItems(plan.files as any), [], "the builder produced a plan its own detector rejects");
      assert.ok(!plan.files.some((f) => /submission|deadline/i.test(f.exactFileName)), plan.files.map((f) => f.exactFileName).join(", "));
    });
  }
});
