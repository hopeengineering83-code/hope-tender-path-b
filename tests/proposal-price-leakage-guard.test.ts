import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { enforceTechnicalPriceSeparation } from "../lib/engine/proposal-price-leakage-guard";
import { documentHygieneIssues } from "../lib/engine/export-readiness";

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

const technicalDoc = {
  name: "Technical Proposal",
  exactFileName: "Technical-Proposal.docx",
  documentType: "TECHNICAL_PROPOSAL",
  format: "DOCX",
};

describe("technical price leakage guard", () => {
  it("removes commercial amounts without injecting internal QA prose into the client proposal", () => {
    const result = enforceTechnicalPriceSeparation(`# Technical Proposal\n\nOur fee is ETB 1,250,000.\n\nThe methodology covers design and supervision.\n\nUnit rate: USD 120 per hour.`, baseInput);

    assert.doesNotMatch(result, /ETB 1,250,000|USD 120|Our fee is|Unit rate/i);
    assert.match(result, /methodology covers design and supervision/i);
    assert.doesNotMatch(result, /Technical Price-Separation Guard/i);
    assert.doesNotMatch(result, /commercial\/pricing line\(s\) were removed|priced BOQ|fee quotations|quotation form/i);
    assert.deepEqual(
      documentHygieneIssues(result, technicalDoc),
      [],
      "the price sanitizer must not re-contaminate the exact client-facing text checked by canonical export hygiene",
    );
  });

  it("preserves safe no-price / separate-envelope control wording", () => {
    const result = enforceTechnicalPriceSeparation(`# Technical Proposal\n\nNo price shall be included in the technical proposal.\n\nThe financial offer is submitted separately in the designated commercial envelope.`, baseInput);

    assert.match(result, /No price shall be included/i);
    assert.match(result, /financial offer is submitted separately/i);
    assert.deepEqual(documentHygieneIssues(result, technicalDoc), []);
  });

  it("is idempotent when generation calls the sanitizer more than once", () => {
    const original = `# Technical Proposal\n\nThe methodology covers design and supervision.\n\nOur fee is ETB 1,250,000.`;
    const once = enforceTechnicalPriceSeparation(original, baseInput);
    const twice = enforceTechnicalPriceSeparation(once, baseInput);

    assert.equal(twice, once);
    assert.doesNotMatch(twice, /Technical Price-Separation Guard|ETB 1,250,000/i);
    assert.deepEqual(documentHygieneIssues(twice, technicalDoc), []);
  });

  it("does not enforce separation on ordinary combined submissions", () => {
    const result = enforceTechnicalPriceSeparation(`# Quotation\n\nOur fee is ETB 1,250,000.`, { ...baseInput, requirements: ["Submit combined technical and commercial quotation."], complianceLines: [] });
    assert.match(result, /ETB 1,250,000/i);
    assert.doesNotMatch(result, /Technical Price-Separation Guard/i);
  });
});
