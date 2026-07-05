import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { enforceTechnicalPriceSeparation } from "../lib/engine/proposal-price-leakage-guard";

const baseInput = {
  tenderTitle: "RFP for Hospital Design and Supervision Services",
  clientName: "Health Client",
  requirements: ["Submit separate technical proposal and financial proposal in two envelopes."],
  expertLines: [],
  projectLines: [],
  companyEvidenceLines: [],
  projectEvidenceLines: [],
  complianceLines: ["Technical proposal and financial proposal must be submitted separately."],
  differentiators: [],
};

describe("technical price leakage guard", () => {
  it("removes commercial amounts from two-envelope technical output", () => {
    const result = enforceTechnicalPriceSeparation(`# Technical Proposal\n\nOur fee is ETB 1,250,000.\n\nThe methodology covers design and supervision.\n\nUnit rate: USD 120 per hour.`, baseInput);
    assert.doesNotMatch(result, /ETB 1,250,000|USD 120|Our fee is|Unit rate/i);
    assert.match(result, /Technical Price-Separation Guard/i);
    assert.match(result, /removed/i);
    assert.match(result, /methodology covers design and supervision/i);
  });

  it("does not remove commercial-control warning lines", () => {
    const result = enforceTechnicalPriceSeparation(`# Technical Proposal\n\nNo price shall be included in the technical proposal.\n\nBefore export, run a price-leakage review.`, baseInput);
    assert.match(result, /No price shall be included/i);
    assert.match(result, /price-leakage review/i);
  });

  it("does not enforce separation on ordinary combined submissions", () => {
    const result = enforceTechnicalPriceSeparation(`# Quotation\n\nOur fee is ETB 1,250,000.`, { ...baseInput, requirements: ["Submit combined technical and commercial quotation."], complianceLines: [] });
    assert.match(result, /ETB 1,250,000/i);
    assert.doesNotMatch(result, /Technical Price-Separation Guard/i);
  });
});
