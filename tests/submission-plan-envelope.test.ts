// Tests for SubmissionPlanFile.envelope — verifies the technical/financial/admin
// envelope assignment logic in buildSubmissionPlan / inferEnvelope.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildSubmissionPlan } from "../lib/engine/plans/submission-plan";

type Req = {
  id: string;
  title: string;
  description?: string | null;
  requirementType: string;
  priority: string;
  exactFileName?: string | null;
  exactOrder?: number | null;
  requiredQuantity?: number | null;
  pageLimit?: number | null;
  restrictions?: string | null;
  sectionReference?: string | null;
};

function req(overrides: Partial<Req> & Pick<Req, "id" | "title" | "requirementType">): Req {
  return {
    priority: "MANDATORY",
    exactFileName: null,
    exactOrder: null,
    requiredQuantity: null,
    pageLimit: null,
    restrictions: null,
    sectionReference: null,
    description: null,
    ...overrides,
  };
}

function planWith(requirements: Req[]) {
  return buildSubmissionPlan({ id: "t1", requirements });
}

describe("SubmissionPlanFile.envelope — financial envelope detection", () => {
  it("financial proposal → FINANCIAL", () => {
    const plan = planWith([req({ id: "1", title: "Financial Proposal", requirementType: "FINANCIAL" })]);
    assert.equal(plan.files[0]?.envelope, "FINANCIAL");
  });

  it("price schedule → FINANCIAL", () => {
    const plan = planWith([req({ id: "1", title: "Price Schedule", requirementType: "TECHNICAL" })]);
    assert.equal(plan.files[0]?.envelope, "FINANCIAL");
  });

  it("bill of quantities → FINANCIAL", () => {
    const plan = planWith([req({ id: "1", title: "Bill of Quantities", requirementType: "TECHNICAL" })]);
    assert.equal(plan.files[0]?.envelope, "FINANCIAL");
  });

  it("rate card → FINANCIAL", () => {
    const plan = planWith([req({ id: "1", title: "Rate Card Template", requirementType: "FORM", exactFileName: "Rate-Card.xlsx" })]);
    assert.equal(plan.files[0]?.envelope, "FINANCIAL");
  });

  it("commercial offer → FINANCIAL", () => {
    const plan = planWith([req({ id: "1", title: "Commercial Offer", requirementType: "FINANCIAL", exactFileName: "Commercial-Offer.docx" })]);
    assert.equal(plan.files[0]?.envelope, "FINANCIAL");
  });
});

describe("SubmissionPlanFile.envelope — admin envelope detection", () => {
  it("declaration form → ADMIN", () => {
    const plan = planWith([req({ id: "1", title: "Declaration Form", requirementType: "DECLARATION", exactFileName: "Declaration.docx" })]);
    assert.equal(plan.files[0]?.envelope, "ADMIN");
  });

  it("bid bond / bid security → ADMIN", () => {
    const plan = planWith([req({ id: "1", title: "Bid Bond", requirementType: "FORM", exactFileName: "Bid-Bond.pdf" })]);
    assert.equal(plan.files[0]?.envelope, "ADMIN");
  });

  it("tax clearance → ADMIN", () => {
    const plan = planWith([req({ id: "1", title: "Tax Clearance Certificate", requirementType: "ELIGIBILITY", exactFileName: "Tax-Clearance.pdf" })]);
    assert.equal(plan.files[0]?.envelope, "ADMIN");
  });

  it("audited financial statement → ADMIN", () => {
    const plan = planWith([req({ id: "1", title: "Audited Financial Statement", requirementType: "ELIGIBILITY", exactFileName: "Audited-Financials.pdf" })]);
    assert.equal(plan.files[0]?.envelope, "ADMIN");
  });
});

describe("SubmissionPlanFile.envelope — technical envelope detection", () => {
  it("technical methodology → TECHNICAL", () => {
    const plan = planWith([req({ id: "1", title: "Technical Methodology", requirementType: "TECHNICAL", exactFileName: "Technical-Methodology.docx" })]);
    assert.equal(plan.files[0]?.envelope, "TECHNICAL");
  });

  it("company profile → TECHNICAL", () => {
    const plan = planWith([req({ id: "1", title: "Company Profile", requirementType: "COMPANY_PROFILE", exactFileName: "Company-Profile.docx" })]);
    assert.equal(plan.files[0]?.envelope, "TECHNICAL");
  });

  it("work plan → TECHNICAL", () => {
    const plan = planWith([req({ id: "1", title: "Work Plan and Timeline", requirementType: "METHODOLOGY", exactFileName: "Work-Plan.docx" })]);
    assert.equal(plan.files[0]?.envelope, "TECHNICAL");
  });
});

describe("SubmissionPlanFile.envelope — each file in mixed plan", () => {
  it("plan with tech + financial + admin files assigns correct envelopes to each", () => {
    const plan = planWith([
      req({ id: "1", title: "Technical Proposal", requirementType: "TECHNICAL", exactFileName: "Technical-Proposal.docx", exactOrder: 1 }),
      req({ id: "2", title: "Financial Proposal", requirementType: "FINANCIAL", exactFileName: "Financial-Proposal.docx", exactOrder: 2 }),
      req({ id: "3", title: "Declaration Form", requirementType: "DECLARATION", exactFileName: "Declaration.docx", exactOrder: 3 }),
    ]);
    const byName = Object.fromEntries(plan.files.map((f) => [f.exactFileName, f.envelope]));
    assert.equal(byName["Technical-Proposal.docx"], "TECHNICAL");
    assert.equal(byName["Financial-Proposal.docx"], "FINANCIAL");
    assert.equal(byName["Declaration.docx"], "ADMIN");
  });
});
