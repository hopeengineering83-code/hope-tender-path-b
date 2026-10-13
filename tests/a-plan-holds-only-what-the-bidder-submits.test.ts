// The Build Plan holds the files the bidder submits — nothing the tender says
// about how it evaluates, how it pays, or which copies the owner attaches.
//
// 2026-10-06, a feasibility-study ToR ("should submit: Technical Proposal …
// Financial Proposal …", "Only those which scored 40% and above for the
// technical proposal … will be considered", "Scanned copy of Supplier
// declaration form … trade license … VAT registration certificate"). Its plan
// was Technical Proposal.docx, "Submission Documents.docx" and "Technical
// Pass Gate.docx" — and no financial proposal, because the model labelled
// that row SCORED. The rows below are the analysis rows of that tender, with
// generic wording.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildSubmissionPlan, plannedSubmissionTargetFiles } from "../lib/engine/submission-plan";
import { classifySubmissionPlanItem } from "../lib/engine/submission-plan-classifier";
import { tenderAnnexPolicy } from "../lib/engine/annex-policy";

const row = (id: string, title: string, requirementType: string, priority: string, description: string) => ({
  id, title, requirementType, priority, description,
  exactFileName: null, exactOrder: null, requiredQuantity: null, pageLimit: null, restrictions: null, sectionReference: null,
});

const ROWS = [
  row("r1", "Team Leader Qualifications", "EXPERT", "MANDATORY", "The Team Leader must have a Master's degree or higher and a minimum of 7 years of relevant professional experience."),
  row("r3", "Technical Proposal Content", "METHODOLOGY", "SCORED", "Submit a technical proposal including understanding of the assignment, proposed methodology, work plan, team composition, CVs, and references."),
  row("r4", "Financial Proposal Content", "FINANCIAL", "SCORED", "Submit a financial proposal broken down into expertise fees, material and tool preparation, logistic costs, reporting costs, and others."),
  row("r6", "Payment Schedule", "SCHEDULE", "MANDATORY", "Payment will be made upon satisfactory completion and approval of deliverables: 20% for inception report, 30% for draft report, 50% for final report."),
  row("r7", "Submission Documents", "SUBMISSION_RULE", "MANDATORY", "Submit scanned copies of Supplier declaration form, Renewed trade license, and VAT registration certificate before the tender closing."),
  row("r8", "Technical Evaluation Weight", "TECHNICAL", "SCORED", "Technical proposals will be evaluated on a 60% weight."),
  row("r10", "Technical Pass Gate", "ELIGIBILITY", "MANDATORY", "Proposals must score 40% or above on the technical proposal to be considered for financial evaluation."),
];

describe("the plan holds only what the bidder submits", () => {
  const files = plannedSubmissionTargetFiles(buildSubmissionPlan({ id: "t", title: "Consultancy Service for a Feasibility Study", exactFileNaming: null, exactFileOrder: null, requirements: ROWS } as never));

  it("a technical and a financial proposal, nothing else", () => {
    assert.deepEqual(files.map((f) => f.exactFileName).sort(), ["Financial Proposal.docx", "Technical Proposal.docx"]);
    assert.equal(files.find((f) => f.exactFileName === "Financial Proposal.docx")!.envelope, "FINANCIAL");
  });

  it("evaluation weights and pass marks are not files", () => {
    for (const r of [ROWS[5]!, ROWS[6]!]) assert.equal(classifySubmissionPlanItem(r).shouldBePlannedFile, false, r.title);
  });

  it("the client's payment terms are not a schedule to complete", () => {
    assert.equal(classifySubmissionPlanItem(ROWS[3]!).shouldBePlannedFile, false);
    assert.equal(classifySubmissionPlanItem(row("p", "Payment Schedule", "SCHEDULE", "MANDATORY", "Provide a proposed payment schedule linked to deliverables.")).shouldBePlannedFile, true);
  });

  it("copies of documents the bidder holds are owner attachments, listed in the Annex Schedule", () => {
    assert.equal(classifySubmissionPlanItem(ROWS[4]!).category, "ORIGINAL_EVIDENCE_ATTACHMENT");
    const policy = tenderAnnexPolicy([`${ROWS[4]!.title} ${ROWS[4]!.description}`]);
    assert.equal(policy.required, true);
    assert.match(policy.items.join(" | "), /declaration form/i);
    assert.match(policy.items.join(" | "), /licence/i);
  });

  it("a row titled as a deliverable stays one, whatever it says about evaluation", () => {
    assert.equal(classifySubmissionPlanItem(row("x", "Technical Proposal", "TECHNICAL", "MANDATORY", "The proposal is subject to the evaluation criteria in Annex 2.")).shouldBePlannedFile, true);
  });

  it("a financial proposal the tender says not to submit is still not planned", () => {
    const plan = plannedSubmissionTargetFiles(buildSubmissionPlan({ id: "t", title: "T", exactFileNaming: null, exactFileOrder: null,
      requirements: [ROWS[1]!, row("n", "Financial Proposal", "FINANCIAL", "SCORED", "No financial proposal is required at this stage.")] } as never));
    assert.equal(plan.some((f) => /financial/i.test(f.exactFileName)), false);
  });
});
