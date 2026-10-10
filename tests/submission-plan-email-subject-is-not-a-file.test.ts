/**
 * Owner UAT: "Source-verified Build Plan completeness" listed
 *
 *   1  Required Email Subject.docx   TECHNICAL   MISSING
 *      "Automatic post-Engine generation must produce the required file
 *       (Required Email Subject.docx)."
 *
 * That file is not a deliverable. The tender line behind it —
 * "Required Email Subject: Technical Proposal for Pharo Ventures" — tells the
 * bidder how to address the submission email. Turning it into a mandatory
 * Word document made the package impossible to converge: generation can never
 * produce it, so the plan reported a required document permanently missing and
 * the owner was asked to resolve something that should never have existed.
 *
 * Identical failure shape to the "No Financial Proposal.docx" rule the
 * classifier already guards: an instruction ABOUT the submission read as a
 * thing TO submit.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { classifySubmissionPlanItem } from "../lib/engine/submission-plan-classifier";

function classify(title: string, description: string) {
  return classifySubmissionPlanItem({
    title,
    description,
    requirementType: "FORMAT",
    exactFileName: null,
  });
}

describe("email submission instructions never become planned files", () => {
  for (const [title, description] of [
    ["Required Email Subject", "Required Email Subject: Technical Proposal for Pharo Ventures"],
    ["Email Submission Details", "Submit to procurement@example.org with the subject line: Technical Proposal"],
    ["Subject Line", "Subject: Consultancy Services for Water Supply"],
    ["Email instructions", "Mark the email with the reference number in the subject."],
    ["Covering email", "A covering email must accompany the submission."],
  ] as const) {
    it(`rejects: ${title}`, () => {
      const result = classify(title, description);
      assert.equal(
        result.shouldBePlannedFile,
        false,
        "a submission instruction must never become a required deliverable",
      );
    });
  }
});

describe("genuine deliverables are still planned", () => {
  it("a required technical proposal remains a file", () => {
    assert.equal(
      classify("Technical Proposal Document", "Required Documents: Technical Proposal.pdf").shouldBePlannedFile,
      true,
    );
  });

  it("a company profile remains a file", () => {
    assert.equal(
      classify("Company Profile", "Submit the company profile document").shouldBePlannedFile,
      true,
    );
  });

  it("the word 'subject' inside a real deliverable does not disqualify it", () => {
    // "subject to" is ordinary contract prose, not an email-subject rule.
    assert.equal(
      classify("Technical Proposal", "The proposal is subject to the evaluation criteria in Annex 2.").shouldBePlannedFile,
      true,
    );
  });
});
