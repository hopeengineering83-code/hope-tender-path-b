import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { containsPricingLeakage } from "../lib/engine/pricing-hygiene";

/**
 * THE DEFECT, as the delivered bytes showed it.
 * ---------------------------------------------
 * 2026-09-16. The delivered technical proposal states 26 monetary figures and
 * EVERY ONE is a past-project fact, with a named client and dates, separating
 * construction cost from consultancy fee on its own numbered line:
 *
 *   1. Construction Cost: 550,074,678.02 ETB
 *   2. Feasibility Study, Geotechnical & New Design Cost: 1,100,000 ETB
 *   3. Contract Administration & Construction Supervision Cost: 110,000 ETB/month
 *
 * It quotes no price for the current engagement anywhere. It was refused
 * PRICING_LEAKAGE regardless, because lib/extract-text.ts reconstructs table
 * columns imperfectly and emitted two rows where an amount sits beside
 * unrelated cell text:
 *
 *   "workflow | patient-flow planning operate, reducing | ETB 550,074,678"
 *   "clinical brief | freeze at 30% gate; | ... USD 18,900,000"
 *
 * Those rows carry no label, no client and no year, so they are neither a
 * labelled value nor a value-only cell and BOTH existing exemptions reject them
 * before prior context is consulted. Verified: they stay flagged with a historic
 * cue, a named client organisation AND a delivered-work label placed directly
 * above them.
 *
 * But those are the SAME amounts the document states as "1. Construction Cost:".
 * One figure is one fact. A gate that reads a number as a past project's cost on
 * one line and as this bid's price on another is contradicting itself about the
 * same number.
 *
 * WHY THIS IS NOT A RELAXATION OF A FINANCIAL CONTROL. An amount enters the
 * established set only from a fragment that both carries an explicit
 * delivered-work / past-project-cost label AND survives the current-offer veto.
 * The veto is unchanged and runs first. The adversarial cases below are the
 * point of this file: a live offer that REUSES an established past figure is
 * still refused, and an amount nothing establishes is still refused.
 */
describe("one figure is one fact across a document", () => {
  const technical = {
    name: "Technical Proposal.pdf",
    exactFileName: "Technical Proposal.pdf",
    documentType: "TECHNICAL_PROPOSAL",
    format: "PDF",
  } as never;

  // The shape the delivered PDF actually uses.
  const establishes = [
    "G+6 General Hospital - Dr Abdul Seid (Gimba City, South Wollo Zone, Amhara Region)",
    "1. Construction Cost: 550,074,678.02 ETB",
    "2. Feasibility Study, Geotechnical & New Design Cost: 1,100,000 ETB",
    "3. Contract Administration & Construction Supervision Cost: 110,000 ETB/month 2015-2018",
    "Hospital Project - City Administration of Abuja, Nigeria",
    "1. Construction Cost: 18,900,000 USD",
    "2. Feasibility Study, Geotechnical & New Design Cost: 945,000 USD",
  ].join("\n");

  // Verbatim shape of the extractor's mangled rows.
  const garbledRows = [
    "Row 3: workflow | patient-flow planning operate, reducing | ETB 550,074,678 —",
    "Row 2: clinical brief | freeze at 30% gate; | functional-programming-aligned USD 18,900,000 —",
  ].join("\n");

  it("clears a mangled row whose amount the document already established", () => {
    assert.equal(containsPricingLeakage(`${establishes}\n${garbledRows}`, technical), false);
  });

  it("still refuses the same rows when nothing establishes those amounts", () => {
    // The exemption is earned from the document, not granted by the row's shape.
    assert.equal(containsPricingLeakage(garbledRows, technical), true);
  });

  it("reads the same figure written two ways as one fact", () => {
    // "550,074,678.02 ETB" and "ETB 550,074,678" differ only in presentation.
    const restated = "Reference: the hospital scheme at ETB 550,074,678 across four phases.";
    assert.equal(containsPricingLeakage(`${establishes}\n${restated}`, technical), false);
  });

  describe("the current-offer veto still runs first", () => {
    const leaks: Array<[string, string]> = [
      ["Our professional fee is ETB 2,000,000.", "a genuine leak beside established amounts"],
      ["The total price for this proposal is ETB 550,074,678.", "a live offer REUSING an established past figure"],
      ["This bid amounts to USD 18,900,000.", "the engagement owning an established figure"],
      ["The consultancy fee for this assignment is 945,000 USD.", "a fee for this assignment at an established figure"],
    ];
    for (const [sentence, why] of leaks) {
      it(`refuses ${why}`, () => {
        assert.equal(containsPricingLeakage(`${establishes}\n${sentence}`, technical), true, sentence);
      });
    }
  });

  it("refuses an unestablished amount even in a document full of established ones", () => {
    assert.equal(
      containsPricingLeakage(`${establishes}\nConstruction supervision: ETB 2,000,000.`, technical),
      true,
    );
  });

  it("leaves the establishing lines themselves clean", () => {
    assert.equal(containsPricingLeakage(establishes, technical), false);
  });

  it("holds outside the benchmark sector and currency", () => {
    // Rail resignalling, NGN — not healthcare, not Ethiopia, not ETB.
    const rail = [
      "Port branch resignalling for the National Transport Authority, completed 2023.",
      "1. Construction Cost: 2,100,000,000 NGN",
      "2. Design Cost: 84,000,000 NGN",
      "Row 5: interlocking | staged possession works, testing | NGN 2,100,000,000 —",
    ].join("\n");
    assert.equal(containsPricingLeakage(rail, technical), false);

    const railLeak = `${rail}\nOur fee for this tender is NGN 84,000,000.`;
    assert.equal(containsPricingLeakage(railLeak, technical), true);
  });
});
