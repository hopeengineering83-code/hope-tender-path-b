// Regression tests for the submission-plan classifier.
//
// Production screenshots showed the planner inventing fake files from
// rule titles:
//   • "Email Recipients: Both Contacts Mandatory.docx"           ← submission rule
//   • "Financial Proposal Exclusion: Technical Only at This Stage.docx"  ← commercial-separation rule
//   • "No Financial Proposal.docx"                              ← negative rule, NOT a file
//   • "Submission Format and Document Control.pdf"               ← internal control row
//
// These tests pin the classifier to NEVER produce a planned file from
// those titles. Real deliverables remain planned files.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  classifySubmissionPlanItem,
  shouldRowBecomePlannedFile,
} from "../lib/engine/submission-plan-classifier";

describe("submission-plan-classifier — rules must not become files", () => {
  it("'Email Recipients: Both Contacts Mandatory' is a submission rule", () => {
    const r = classifySubmissionPlanItem({ title: "Email Recipients: Both Contacts Mandatory" });
    assert.equal(r.category, "SUBMISSION_RULE");
    assert.equal(r.shouldBePlannedFile, false);
  });

  it("'Financial Proposal Exclusion: Technical Only at This Stage' is commercial separation", () => {
    const r = classifySubmissionPlanItem({ title: "Financial Proposal Exclusion: Technical Only at This Stage" });
    assert.equal(r.category, "COMMERCIAL_SEPARATION_RULE");
    assert.equal(r.shouldBePlannedFile, false);
  });

  it("negative financial instructions never become synthetic deliverables, even with a .docx filename", () => {
    const examples = [
      { title: "No Financial Proposal", exactFileName: "No Financial Proposal.docx" },
      { title: "Financial Proposal: Not required at this stage", exactFileName: "Financial-Proposal.docx" },
      { title: "Do not generate a financial proposal" },
      { title: "Technical submission without financial proposal" },
    ];
    for (const input of examples) {
      const r = classifySubmissionPlanItem(input);
      assert.equal(r.category, "COMMERCIAL_SEPARATION_RULE", JSON.stringify(input));
      assert.equal(r.shouldBePlannedFile, false, JSON.stringify(input));
    }
  });

  it("'Submission Format and Document Control' is an internal control", () => {
    const r = classifySubmissionPlanItem({ title: "Submission Format and Document Control" });
    assert.equal(r.category, "INTERNAL_COMPLIANCE_CONTROL");
    assert.equal(r.shouldBePlannedFile, false);
  });

  it("submission deadline phrases are rules, not files", () => {
    assert.equal(shouldRowBecomePlannedFile({ title: "Must be submitted by 12:00 noon" }), false);
    assert.equal(shouldRowBecomePlannedFile({ title: "Deadline is 31 December 2026" }), false);
  });

  it("two-envelope / sealed-envelope rules are commercial separation", () => {
    const r1 = classifySubmissionPlanItem({ title: "Two-envelope system: technical and financial must be separate" });
    assert.equal(r1.category, "COMMERCIAL_SEPARATION_RULE");
    const r2 = classifySubmissionPlanItem({ title: "Sealed envelope for financial proposal" });
    assert.equal(r2.category, "COMMERCIAL_SEPARATION_RULE");
  });
});

describe("submission-plan-classifier — evidence must be uploaded, not generated", () => {
  it("Valid Business License is an evidence attachment", () => {
    const r = classifySubmissionPlanItem({ title: "Valid Business License and Ethiopian Registration" });
    assert.equal(r.category, "ORIGINAL_EVIDENCE_ATTACHMENT");
    assert.equal(r.shouldBePlannedFile, false);
  });

  it("audited financial statements are evidence", () => {
    const r = classifySubmissionPlanItem({ title: "Audited Financial Statements (last 3 years)" });
    assert.equal(r.category, "ORIGINAL_EVIDENCE_ATTACHMENT");
  });

  it("registration / incorporation / tax certificates are evidence", () => {
    assert.equal(classifySubmissionPlanItem({ title: "Certificate of Registration" }).category, "ORIGINAL_EVIDENCE_ATTACHMENT");
    assert.equal(classifySubmissionPlanItem({ title: "Certificate of Incorporation" }).category, "ORIGINAL_EVIDENCE_ATTACHMENT");
    assert.equal(classifySubmissionPlanItem({ title: "Tax Clearance Certificate" }).category, "ORIGINAL_EVIDENCE_ATTACHMENT");
    assert.equal(classifySubmissionPlanItem({ title: "TIN Certificate" }).category, "ORIGINAL_EVIDENCE_ATTACHMENT");
  });
});

describe("submission-plan-classifier — real deliverables ARE planned files", () => {
  it("Technical Proposal is a required output file", () => {
    const r = classifySubmissionPlanItem({ title: "Technical Proposal (PDF) containing Company Profile, Relevant Experience, Technical Approach" });
    assert.equal(r.category, "REQUIRED_OUTPUT_FILE");
    assert.equal(r.shouldBePlannedFile, true);
  });

  it("Cover Letter is a required output file", () => {
    assert.equal(classifySubmissionPlanItem({ title: "Cover Letter" }).shouldBePlannedFile, true);
  });

  it("Bid Bond Confirmation Letter is a required output file", () => {
    const r = classifySubmissionPlanItem({ title: "Bid Bond Confirmation Letter" });
    assert.equal(r.category, "REQUIRED_OUTPUT_FILE");
    assert.equal(r.shouldBePlannedFile, true);
  });

  it("a generic bidder-assembled supporting-document annex is an output, not an invented official form", () => {
    const r = classifySubmissionPlanItem({
      title: "Annexes for Supporting Documents",
      exactFileName: "Annexes for Supporting Documents.docx",
    });
    assert.equal(r.category, "REQUIRED_OUTPUT_FILE");
    assert.equal(r.shouldBePlannedFile, true);
  });

  it("an explicitly tender-issued annex remains a form/template and fail-closed", () => {
    const r = classifySubmissionPlanItem({
      title: "Annex 3",
      description: "Submit the attached prescribed Annex 3 without modification.",
      exactFileName: "Annex-3.docx",
    });
    assert.equal(r.category, "FORM_TEMPLATE_TO_COMPLETE");
    assert.equal(r.shouldBePlannedFile, true);
  });

  it("form templates / numbered annexes / schedules are planned files (to be completed)", () => {
    assert.equal(classifySubmissionPlanItem({ title: "Form 1: Bidder Information Form" }).category, "FORM_TEMPLATE_TO_COMPLETE");
    assert.equal(classifySubmissionPlanItem({ title: "Schedule 2: Price Schedule" }).category, "FORM_TEMPLATE_TO_COMPLETE");
    assert.equal(classifySubmissionPlanItem({ title: "Annex 3: Technical Schedule" }).category, "FORM_TEMPLATE_TO_COMPLETE");
    assert.equal(classifySubmissionPlanItem({ title: "CV Template" }).shouldBePlannedFile, true);
  });

  it("Empty input defaults to internal control (never a file)", () => {
    const r = classifySubmissionPlanItem({});
    assert.equal(r.category, "INTERNAL_COMPLIANCE_CONTROL");
    assert.equal(r.shouldBePlannedFile, false);
  });

  it("exactFileName forces planned-file when no rule pattern matches", () => {
    const r = classifySubmissionPlanItem({ title: "Site Visit Confirmation", exactFileName: "site-visit.pdf" });
    assert.equal(r.shouldBePlannedFile, true);
  });
});
