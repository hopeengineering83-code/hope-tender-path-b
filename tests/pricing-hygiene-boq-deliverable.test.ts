/**
 * Preparing a Bill of Quantities is scope. It is not a price.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A real owner run produced a Technical Proposal scored 68/100 and
 * QUALITY_FAILED, with PRICING_LEAKAGE among its issue codes — on a proposal
 * that quoted no price anywhere. AUTO_FINALIZE could not converge.
 *
 * The trigger was this codebase's OWN deterministic fallback content. When the
 * technical-approach section timed out, the fallback deliverables table shipped
 * instead, and the healthcare list contains:
 *
 *   "Tender Documentation and BOQ Preparation"
 *
 * "BoQ" is in the standalone-financial-term list because a bill of quantities
 * in a technical envelope is usually a priced document belonging in the
 * financial envelope. But PREPARING one for the client is ordinary consultancy
 * scope, and the sentence carried no figure at all.
 *
 * The exemption is deliberately narrow, and these tests exist mainly to prove
 * that: the second describe block is the one that matters, because an
 * over-broad fix here would punch a hole straight through technical/financial
 * separation.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { containsPricingLeakage } from "../lib/engine/pricing-hygiene";

const TECHNICAL_DOC = {
  name: "Technical Proposal",
  exactFileName: "01-Technical-Proposal.docx",
  documentType: "TECHNICAL_PROPOSAL",
  format: "DOCX",
} as never;

describe("a BOQ named as a deliverable does not read as a price", () => {
  it("clears the exact healthcare fallback line from the failing run", () => {
    assert.equal(
      containsPricingLeakage(
        "The deliverables include Tender Documentation and BOQ Preparation for the facility works.",
        TECHNICAL_DOC,
      ),
      false,
    );
  });

  it("clears the building fallback's BOQ deliverable", () => {
    assert.equal(
      containsPricingLeakage(
        "BOQ and Cost Planning will be produced as part of the tender documentation.",
        TECHNICAL_DOC,
      ),
      false,
    );
  });

  it("clears a deliverables table row carrying a code and a due week", () => {
    // The fallback ships TABLES, not prose. A row pairs the item with its
    // code and its timing, and both carry digits — which made the row read as
    // priced content. A deliverable code and a due date are identifiers, not
    // money, so withoutIdentifiers() now strips them the way it already
    // strips reference numbers and bare years.
    assert.equal(
      containsPricingLeakage(
        "| D7 | Tender Documentation and BOQ Preparation | Week 20 |",
        TECHNICAL_DOC,
      ),
      false,
    );
  });
});

describe("the exemption does not open a hole in envelope separation", () => {
  // Each of these MUST still be caught. This is the block that keeps the fix
  // honest — the whole point of the gate is that a real price cannot ride out
  // in the technical envelope.
  const mustStillLeak: Array<[string, string]> = [
    ["a BOQ carrying an amount", "The BOQ total is ETB 4,500,000 for this engagement."],
    ["a BOQ priced as a percentage", "Bill of quantities preparation is offered at 12% of construction value."],
    ["a BOQ with no production context", "Our BoQ is attached for your review."],
    ["a rate card", "Our rate card is attached for your review."],
    ["a financial proposal total", "The financial proposal totals USD 250,000."],
    ["a daily rate", "The daily rate for the team leader is 450 USD."],
    ["a fee schedule", "The fee schedule for this engagement is enclosed."],
    ["a lump sum price", "We offer a lump sum price for the works."],
  ];

  for (const [label, text] of mustStillLeak) {
    it(`still flags ${label}`, () => {
      assert.equal(containsPricingLeakage(text, TECHNICAL_DOC), true, `"${text}" must still be refused`);
    });
  }
});

describe("ordinary technical prose is unaffected", () => {
  it("passes a methodology sentence with no financial content", () => {
    assert.equal(
      containsPricingLeakage("We will carry out infection prevention and control design.", TECHNICAL_DOC),
      false,
    );
  });

  it("does not flag a document with no BOQ mention at all", () => {
    assert.equal(
      containsPricingLeakage("Structural and fire safety design follows the national building code.", TECHNICAL_DOC),
      false,
    );
  });
});

describe("stripping identifiers does not hide real money", () => {
  // withoutIdentifiers() now removes deliverable codes and schedule markers.
  // Neither may become a way to smuggle an amount past the gate.
  it("still flags an amount sitting beside a deliverable code", () => {
    assert.equal(
      containsPricingLeakage("| D7 | BOQ Preparation | ETB 4,500,000 |", TECHNICAL_DOC),
      true,
    );
  });

  it("still flags an amount sitting beside a schedule marker", () => {
    assert.equal(
      containsPricingLeakage("Week 20 milestone payment amount is USD 30,000.", TECHNICAL_DOC),
      true,
    );
  });

  it("does not strip a figure that merely looks like a code", () => {
    // "ETB 12" is money with a small number, not an item code.
    assert.equal(containsPricingLeakage("The fee is ETB 12 million.", TECHNICAL_DOC), true);
  });
});
