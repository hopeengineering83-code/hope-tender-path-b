import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { containsPricingLeakage } from "../lib/engine/pricing-hygiene";

const technicalDoc = {
  id: "doc-1",
  name: "Technical Proposal",
  exactFileName: "Technical-Proposal.docx",
  generationStatus: "GENERATED",
  validationStatus: "VALIDATED",
  reviewStatus: "READY_FOR_EXPORT",
};

const financialDoc = {
  ...technicalDoc,
  name: "Financial Proposal",
  exactFileName: "Financial-Proposal.docx",
};

describe("pricing hygiene helper", () => {
  it("does not block safe no-price-control wording", () => {
    const text = "Technical Proposal. This technical document does not include fee amounts, rates, unit prices, total price, or financial offer values.";
    assert.equal(containsPricingLeakage(text, technicalDoc), false);
  });

  it("blocks a real currency amount in a technical document", () => {
    const text = "Technical Proposal. The technical methodology includes a total price of USD 25,000 in the technical envelope.";
    assert.equal(containsPricingLeakage(text, technicalDoc), true);
  });

  it("does not scan financial documents as technical documents", () => {
    const text = "Financial Proposal. The total price is USD 25,000.";
    assert.equal(containsPricingLeakage(text, financialDoc), false);
  });
});
