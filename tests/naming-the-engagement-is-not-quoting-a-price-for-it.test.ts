import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { containsPricingLeakage } from "../lib/engine/pricing-hygiene";

/**
 * THE DEFECT, as the running system reported it.
 * ----------------------------------------------
 * 2026-09-16, run 35136711233. The first model-backed package this app has
 * produced was refused, and once the blocker carried the verdict's own reasons
 * it named the rule for the first time:
 *
 *   blockers: [{"code": "PDF_REQUIRED_NOT_READY", "message": "The document
 *     failed a quality check ...: [PRICING_LEAKAGE] Possible financial/pricing
 *     language appears in a technical document: currency amount in "Hope Urban
 *     Planning ... presents 3 project reference(s) directly relevant to this
 *     assignment: G+6 General Hospital ..."}]
 *
 * The document quotes no price. It lists PAST PROJECTS and their
 * "Construction Value of Works" — the cost of a delivered asset, a label
 * DELIVERED_WORK_VALUE_LABEL already exempts by name.
 *
 * ROOT CAUSE, and it is generic. Both current-offer vetoes in pricing-hygiene
 * listed `this (proposal|bid|assignment|tender)` alongside "our fee", "bid
 * price", "total price", "lump sum" and "price schedule". Every other
 * alternative names a PRICE; that one names only the ENGAGEMENT. So any
 * evidence sentence explaining that its references are relevant *to this
 * assignment* was vetoed out of the comparable-projects exemption written for
 * exactly that shape. Deleting the three words "relevant to this assignment"
 * flipped the identical sentence to clean — which is how this was identified
 * rather than guessed.
 *
 * WHY THE FIX CANNOT OPEN A HOLE. The veto only gates an EXEMPTION, and the
 * exemption still demands positive historical evidence: a strong historic cue,
 * a dated reference, a labelled contract or delivered-work value, or a named
 * client organisation. A bare current-offer price sentence has none of those
 * and is caught whether or not the veto fires. The cases below assert that in
 * both directions.
 */
describe("naming the engagement is not quoting a price for it", () => {
  const technical = {
    name: "Technical Proposal.pdf",
    exactFileName: "Technical Proposal.pdf",
    documentType: "TECHNICAL_PROPOSAL",
    format: "pdf",
  } as never;

  describe("evidence about past work stays exportable", () => {
    // The sentence the running system actually refused.
    const reported =
      "Hope Urban Planning Architectural and Engineering Consultancy PLC presents 3 project "
      + "reference(s) directly relevant to this assignment: G+6 General Hospital - Dr Abdul Seid "
      + "- Gimba City, South Wollo Zone, Amhara Region, Construction Value of Works ETB 550.1M.";

    it("clears the sentence the export gate refused", () => {
      assert.equal(containsPricingLeakage(reported, technical), false);
    });

    it("is not a property of those particular words — deleting the engagement phrase must not change the verdict", () => {
      // Before the fix these two disagreed, and that disagreement WAS the bug:
      // three words of relevance framing decided whether a package shipped.
      const withoutEngagement = reported.replace(" directly relevant to this assignment", "");
      assert.equal(
        containsPricingLeakage(reported, technical),
        containsPricingLeakage(withoutEngagement, technical),
        "naming the engagement must not flip a past-project sentence into pricing leakage",
      );
    });

    it("holds outside the benchmark sector and currency", () => {
      // Deliberately not healthcare, not Ethiopia, not ETB.
      const water =
        "Our team has completed 4 comparable projects relevant to this tender, including the "
        + "Adama Water Supply Distribution Network for Oromia Water Works Enterprise, "
        + "Construction Value of Works KES 18,400,000.";
      assert.equal(containsPricingLeakage(water, technical), false);

      const rail =
        "These reference projects are directly relevant to this assignment: resignalling of the "
        + "port branch for the National Transport Authority, completed 2023, contract value "
        + "NGN 2,100,000,000.";
      assert.equal(containsPricingLeakage(rail, technical), false);
    });
  });

  describe("a real price for the current engagement is still caught", () => {
    const leaks: Array<[string, string]> = [
      ["The total price for this proposal is ETB 4,500,000.", "total price"],
      ["This bid amounts to USD 3,200,000 inclusive of all taxes.", "engagement + amounts to"],
      ["The fee for this assignment is NGN 12,000,000.", "fee + engagement"],
      ["This proposal is priced at EUR 750,000.", "engagement + priced"],
      ["The daily rate for this assignment is GBP 1,200.", "rate + engagement"],
      ["Our professional fee is ETB 2,000,000.", "our fee — an alternative this change did not touch"],
      ["Construction supervision: ETB 2,000,000.", "bare prose: no client, no history, no label"],
      // The hazard a first version of this fix reintroduced, caught by
      // tests/a-past-projects-construction-cost-is-not-this-bids-price. Here
      // the engagement is what the amount BELONGS TO, not a relevance target,
      // so a historical LABEL must not launder it into an exemption.
      ["Construction Value of Works for this proposal is ETB 550,000,000", "current-offer price wearing a delivered-work label"],
      ["The value of the works under this assignment is ETB 90,000,000.", "engagement owns the value"],
      // Naming a relevance target must not immunise the rest of the sentence.
      [
        "These references are relevant to this assignment. The price for this proposal is ETB 4,500,000.",
        "does both — the second occurrence survives and still refuses",
      ],
    ];
    for (const [sentence, why] of leaks) {
      it(`refuses: ${why}`, () => {
        assert.equal(containsPricingLeakage(sentence, technical), true, sentence);
      });
    }
  });

  it("still exempts a document's own no-pricing assurance", () => {
    // Guards the opposite failure recorded in this module's history: the
    // compliance sentence that STATES pricing is absent was once read as
    // pricing, leaving a tender unable to reach a final package.
    assert.equal(
      containsPricingLeakage(
        "No financial or pricing information appears in this technical proposal; the financial "
        + "offer is submitted separately.",
        technical,
      ),
      false,
    );
  });
});
