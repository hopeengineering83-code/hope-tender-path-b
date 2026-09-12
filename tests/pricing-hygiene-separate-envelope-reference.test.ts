/**
 * Owner UAT: Technical-Proposal.docx showed "✓ Clean" and "Failed" at once —
 * the Document Validator found no placeholder, AI-trace or envelope issue,
 * while the persisted validationStatus was FAILED. Runtime logs named the
 * cause: export-gap-repair reported blockedByHygiene 1 with "Possible
 * financial/pricing language appears in a technical document", so
 * AUTO_FINALIZE_NOT_CONVERGED looped and CURRENT OUTPUTS stayed 0.
 *
 * containsPricingLeakage treats "financial proposal" / "commercial proposal"
 * as standalone high-signal terms. A technical proposal that correctly says
 * where pricing lives — "Pricing is presented in the Financial Proposal." —
 * therefore tripped the guard: the sentence proving proper envelope separation
 * was read as the leak.
 *
 * The exemption is narrow. Any digit, percentage or currency symbol in the
 * sentence disqualifies it, so a cross-reference carrying an actual figure is
 * still leakage.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { containsPricingLeakage } from "../lib/engine/pricing-hygiene";

const TECHNICAL_DOC = {
  name: "Technical Proposal",
  exactFileName: "Technical-Proposal.docx",
  documentType: "TECHNICAL_PROPOSAL",
  format: "DOCX",
} as never;

describe("a bare reference to the separate financial envelope is not leakage", () => {
  for (const sentence of [
    "Pricing is presented in the Financial Proposal.",
    "This Technical Proposal contains no pricing; refer to the Financial Proposal.",
    "The Financial Proposal is provided in a separate envelope.",
    "Our commercial offer is submitted separately.",
  ]) {
    it(`clears: ${sentence}`, () => {
      assert.equal(
        containsPricingLeakage(sentence, TECHNICAL_DOC),
        false,
        "naming the separate envelope, with no figure, is correct practice",
      );
    });
  }
});

describe("real pricing in a technical document still fails closed", () => {
  for (const sentence of [
    "The Financial Proposal totals USD 4,250,000.",
    "Total price: 250,000 ETB for the works.",
    "Our daily rate is 500 USD per expert.",
    "A 10% fee applies to the contract value.",
    "Fee schedule: 1,200 per day.",
    "Contract amount 3,000,000 birr.",
  ]) {
    it(`flags: ${sentence}`, () => {
      assert.equal(
        containsPricingLeakage(sentence, TECHNICAL_DOC),
        true,
        "a sentence carrying an actual figure remains leakage",
      );
    });
  }

  it("the exemption is disqualified by any digit, percent or currency symbol", () => {
    // Same cross-reference shape as the cleared cases, but with a figure.
    assert.equal(containsPricingLeakage("See the Financial Proposal: $4,250,000.", TECHNICAL_DOC), true);
    assert.equal(containsPricingLeakage("The Financial Proposal covers 100% of costs.", TECHNICAL_DOC), true);
  });

  it("naming the envelope does not license priced content in the same sentence", () => {
    // Caught by the existing suite: these name the envelope and then leak.
    assert.equal(containsPricingLeakage("Our commercial proposal includes itemized rates.", TECHNICAL_DOC), true);
    assert.equal(containsPricingLeakage("The financial proposal contains the bill of quantities.", TECHNICAL_DOC), true);
  });

  it("ordinary technical prose is untouched", () => {
    assert.equal(
      containsPricingLeakage("Methodology for water supply design and construction supervision.", TECHNICAL_DOC),
      false,
    );
  });
});
