import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildTenderFormStrategy, renderTenderFormStrategy } from "../lib/engine/tender-form-strategy";

describe("tender form strategy", () => {
  it("treats EOI as shortlist and capability evidence, not full RFP methodology", () => {
    const strategy = buildTenderFormStrategy({
      tenderTitle: "Expression of Interest for Consultancy Services",
      requirements: ["Submit company profile, similar assignments and key expert summaries for shortlisting."],
    });

    assert.equal(strategy.primaryForm, "EOI");
    assert.match(strategy.proposalObjective, /shortlist/i);
    assert.ok(strategy.requiredEmphasis.some((item) => /eligibility|shortlist|capability/i.test(item)));
    assert.ok(strategy.requiredOutputs.some((item) => /similar assignment|expert summary|capability/i.test(item)));
  });

  it("treats prequalification as pass-fail eligibility control", () => {
    const strategy = buildTenderFormStrategy({
      tenderTitle: "Prequalification of Consultants for Framework Services",
      requirements: ["Provide registration certificate, tax clearance, audited accounts and similar project experience."],
    });

    assert.equal(strategy.primaryForm, "PREQUALIFICATION");
    assert.match(strategy.proposalObjective, /eligibility|prequalification/i);
    assert.ok(strategy.evaluatorRisks.some((item) => /pass\/fail|expired|mandatory/i.test(item)));
  });

  it("treats RFQ as quotation completeness and commercial control", () => {
    const strategy = buildTenderFormStrategy({
      tenderTitle: "Request for Quotation for Interior Design Services",
      requirements: ["Submit price schedule, delivery timeline, assumptions, validity and VAT treatment."],
    });

    assert.equal(strategy.primaryForm, "RFQ");
    assert.match(strategy.proposalObjective, /quotation/i);
    assert.ok(strategy.requiredEmphasis.some((item) => /validity|tax|quotation|assumptions/i.test(item)));
    assert.ok(strategy.commercialControls.some((item) => /totals|tax|currency|validity|commercial/i.test(item)));
  });

  it("detects two-envelope RFP and enforces technical price separation", () => {
    const strategy = buildTenderFormStrategy({
      tenderTitle: "RFP for Hospital Design and Supervision Services",
      requirements: ["Submit separate technical proposal and financial proposal in two envelopes."],
    });
    const rendered = renderTenderFormStrategy(strategy);

    assert.equal(strategy.primaryForm, "RFP");
    assert.equal(strategy.isTwoEnvelope, true);
    assert.match(rendered, /two-envelope/i);
    assert.ok(strategy.commercialControls.some((item) => /no price|technical proposal|financial/i.test(item)));
  });
});
