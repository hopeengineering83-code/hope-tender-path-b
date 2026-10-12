import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { containsPricingLeakage } from "../lib/engine/pricing-hygiene";

const technicalDoc = {
  name: "Technical Proposal",
  exactFileName: "Technical-Proposal.docx",
  documentType: "TECHNICAL_PROPOSAL",
  format: "DOCX",
};

describe("technical proposal pricing hygiene — reference project values", () => {
  it("allows clearly historical comparable-project contract values", () => {
    const text = "Relevant experience: St. Paul's Hospital expansion, completed 2023 for the client. Contract value: ETB 312,000,000.";
    assert.equal(containsPricingLeakage(text, technicalDoc), false);
  });

  it("allows a dated portfolio row carrying a prior project value", () => {
    const text = "Portfolio: Dessie Specialized Hospital | Client: Dessie City Administration | ETB 235,000,000 | 2022 | design and supervision.";
    assert.equal(containsPricingLeakage(text, technicalDoc), false);
  });

  it("still blocks the current proposal price", () => {
    const text = "This proposal total price is ETB 5,000,000.";
    assert.equal(containsPricingLeakage(text, technicalDoc), true);
  });

  it("still blocks a current consultancy fee", () => {
    const text = "Our consultancy fee is USD 50,000 for this assignment.";
    assert.equal(containsPricingLeakage(text, technicalDoc), true);
  });

  it("still blocks a bare current budget allocation with currency", () => {
    const text = "Implementation approach covers all phases. Budget allocated: ETB 1,500,000.";
    assert.equal(containsPricingLeakage(text, technicalDoc), true);
  });

  it("still allows naming the separate financial envelope without any amount", () => {
    const text = "Pricing is presented in the Financial Proposal, which is submitted separately.";
    assert.equal(containsPricingLeakage(text, technicalDoc), false);
  });
});
