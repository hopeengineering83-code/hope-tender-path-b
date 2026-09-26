// 2026-09-23, Preview. MANDATORY requirement "PDF Submission":
//   "All documents must be submitted as a single PDF file named
//    'Technical Proposal.pdf'."
// The Build Plan still listed Technical Proposal.pdf, Cover Letter.docx and
// Company Profile.docx, so package conformance reported
// SUBMISSION_RULE_BROKEN_BY_PACKAGE and nothing automatic could satisfy it.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildSubmissionPlan } from "../lib/engine/submission-plan";
import { statedSingleSubmissionFile } from "../lib/engine/single-submission-file-rule";

const req = (id: string, title: string, description: string, requirementType: string, extra: Record<string, unknown> = {}) =>
  ({ id, title, description, requirementType, priority: "MANDATORY", ...extra });

const RULE = req("r1", "PDF Submission", "All documents must be submitted as a single PDF file named 'Technical Proposal.pdf'.", "FORMAT");

describe("a single-file submission is one planned file", () => {
  it("reads the named file from the rule", () => {
    assert.deepEqual(statedSingleSubmissionFile([RULE] as any), { fileName: "Technical Proposal.pdf", requirementIds: ["r1"] });
  });

  it("does not invent a rule from an ordinary single-PDF format clause without a name", () => {
    assert.equal(statedSingleSubmissionFile([req("x", "Format", "The technical proposal shall be a single PDF.", "FORMAT")] as any), null);
  });

  it("refuses to choose between two different named files", () => {
    const other = req("r9", "Packaging", "The entire submission must be one PDF file named \"Bid.pdf\".", "FORMAT");
    assert.equal(statedSingleSubmissionFile([RULE, other] as any), null);
  });

  it("folds bidder-produced deliverables into the named file, keeping their provenance", () => {
    const plan = buildSubmissionPlan({
      id: "t",
      exactFileNaming: JSON.stringify(["Technical Proposal.pdf"]),
      requirements: [
        RULE,
        req("r2", "Cover Letter", "Submit a signed cover letter.", "TECHNICAL"),
        req("r3", "Company Profile", "Provide a company profile.", "ELIGIBILITY"),
      ],
    } as any);
    assert.deepEqual(plan.files.map((f) => f.exactFileName), ["Technical Proposal.pdf"]);
    assert.deepEqual([...plan.files[0]!.sourceRequirementIds].sort(), ["r1", "r2", "r3"]);
  });

  it("keeps tender-issued forms and the financial envelope as their own files", () => {
    const plan = buildSubmissionPlan({
      id: "t",
      exactFileNaming: JSON.stringify(["Technical Proposal.pdf"]),
      requirements: [
        RULE,
        req("r6", "Bid Security Form", "Complete the attached Bid Security Form (Annex 2).", "FORM"),
        req("r7", "Financial Proposal", "Provide the financial proposal with the lump-sum fee.", "FINANCIAL"),
      ],
    } as any);
    const names = plan.files.map((f) => f.exactFileName);
    assert.ok(names.includes("Technical Proposal.pdf"));
    assert.ok(names.some((n) => /Bid Security Form/.test(n)), "a tender form is not produced by writing prose");
    assert.ok(names.some((n) => /Financial Proposal/.test(n)), "the financial envelope is never folded into the technical file");
  });

  it("leaves a plan without such a rule untouched", () => {
    const plan = buildSubmissionPlan({
      id: "t",
      requirements: [
        req("r2", "Cover Letter", "Submit a signed cover letter.", "TECHNICAL"),
        req("r3", "Company Profile", "Provide a company profile.", "ELIGIBILITY"),
      ],
    } as any);
    assert.equal(plan.files.length, 2);
  });
});
