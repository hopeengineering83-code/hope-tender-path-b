import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { containsPricingLeakage } from "../lib/engine/pricing-hygiene";

/**
 * The detector only judges a TECHNICAL envelope — `containsPricingLeakage`
 * returns false outright for any other document, so a test that omits this
 * argument passes no matter what the detector does. Every case below names the
 * real document the acceptance run failed on.
 */
const TECHNICAL_PROPOSAL = {
  name: "Technical Proposal",
  exactFileName: "Technical Proposal.pdf",
  documentType: "TECHNICAL_PROPOSAL",
  format: "PDF",
} as Parameters<typeof containsPricingLeakage>[1];

/** Guards the guard: if this ever returns false, every case here is vacuous. */
const detectorIsLive = containsPricingLeakage("The bid price is USD 400,000", TECHNICAL_PROPOSAL);

/**
 * THE DEFECT, found by a failing acceptance run rather than by reasoning.
 * ---------------------------------------------------------------------
 * Project cards began carrying the value their record states, and the very next
 * hosted run failed:
 *
 *   Technical Proposal.pdf  qualityScore=75  recommended=QUALITY_FAILED
 *   ISSUE PRICING_LEAKAGE [HIGH] Possible financial/pricing language appears
 *   in a technical document
 *
 * The document quoted no price. "Construction Value of Works" is the label this
 * codebase gives the cost of the ASSET a past project built — never this firm's
 * fee, never this bid's price — and both card builders emit it under that role
 * precisely so a construction cost is not mistaken for a consultancy contract.
 * The historical-value vocabulary knew "project value" and "contract value" and
 * not the label the cards actually print, so a past project's construction cost
 * was read as this bid's price and AUTO_FINALIZE could not converge.
 *
 * WHAT IS PINNED
 * --------------
 * That a delivered-work value is recognised as historical, and — the part that
 * matters far more — that every way of stating THIS bid's price is still caught.
 * The exemption is reached only after the current-offer veto has run, so no
 * label can carry an offer past it.
 */

describe("the detector under test is actually reachable", () => {
  it("flags a plain bid price in a technical proposal", () => {
    // Without this, an exemption bug and a disabled detector look identical.
    assert.equal(detectorIsLive, true, "the pricing detector must be live for these cases to mean anything");
  });
});

describe("a delivered-work value is track record, not a price offer", () => {
  it("accepts the value rows a project card actually prints", () => {
    for (const line of [
      "Construction Value of Works ETB 550.1M",
      "Construction Value of Works NGN 1200.0M",
      "Value of the Works USD 12,500,000",
      "Aggregate Value of Projects Delivered ETB 56.78 billion",
    ]) {
      assert.equal(containsPricingLeakage(line, TECHNICAL_PROPOSAL), false, line);
    }
  });

  it("still accepts the labels it always accepted", () => {
    for (const line of [
      "Contract Value ETB 550.1M for a project completed in 2018 for the client",
      "Project value: KES 890,000,000 — reference project delivered 2021",
    ]) {
      assert.equal(containsPricingLeakage(line, TECHNICAL_PROPOSAL), false, line);
    }
  });
});

describe("this bid's price is still leakage, however it is labelled", () => {
  it("refuses current-offer phrasing that borrows a historical label", () => {
    for (const line of [
      "Construction Value of Works for this proposal is ETB 550,000,000",
      "Our fee for the construction value of works is ETB 2,400,000",
      "The bid price is USD 400,000",
      "Total price: ETB 1,250,000",
      "Our professional fee is ETB 980,000 payable monthly",
      "Lump sum of ETB 3,000,000 for the assignment",
      "Unit price ETB 12,000 per drawing",
      "Price schedule: ETB 45,000 per month",
    ]) {
      assert.equal(containsPricingLeakage(line, TECHNICAL_PROPOSAL), true, line);
    }
  });

  it("refuses a bare amount with no historical framing at all", () => {
    assert.equal(containsPricingLeakage("Construction supervision: ETB 2,000,000", TECHNICAL_PROPOSAL), true);
  });
});
