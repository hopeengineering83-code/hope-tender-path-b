// A reference number is not a price, and a table is not a sentence.
//
// WHY THIS FILE EXISTS
// --------------------
// A real end-to-end run was refused at export with
//
//   DOCUMENT_HYGIENE_FAILURE — Document "Client-Ready Benchmark Technical
//   Proposal": Possible financial/pricing language appears in a technical
//   document
//
// on a technical proposal that quoted no price anywhere. Three separate faults
// combined, and each one is pinned below.
//
//  1. DOCX text extraction replaced every tag with a space and then collapsed
//     all whitespace, so an entire document — tables included — arrived as one
//     run-on line. Consumers split on sentence punctuation and newlines, and
//     there were no newlines, so a table's cells fused. A compliance-matrix row
//     with "Financial Proposal Controls" in one cell and "3 selected expert(s)"
//     in another read as a single sentence containing a financial term next to
//     a number.
//
//  2. The exemption for a sentence that merely NAMES the financial envelope was
//     defeated by any digit, and a two-envelope tender supplies its own: the
//     proposal must quote the required subject line,
//     "MOWE/CS/RWS/2026/0117 - Technical and Financial Proposal". A procurement
//     reference is an identifier, not an amount.
//
//  3. The historical-value context window read the array that a previous filter
//     had already thinned, so exempting a comparable-projects row deleted the
//     client name that the value cell in that same row needed to be recognised
//     as historical — and a past project's value was read as this bid's price.
//
// The tests below keep both directions honest: quoting the tender's own
// submission instructions must never block export, and an actual price in a
// technical envelope must still block it.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { containsPricingLeakage } from "../lib/engine/pricing-hygiene";

const TECHNICAL = {
  name: "Technical Proposal",
  exactFileName: "01-Technical-Proposal.docx",
  documentType: "TECHNICAL_PROPOSAL",
  format: "DOCX",
} as never;

describe("compliant technical-envelope text is not mistaken for pricing", () => {
  it("accepts the required email subject line, reference number and all", () => {
    // The exact string the generated proposal has to reproduce.
    assert.equal(
      containsPricingLeakage(
        'The email subject line must read exactly "MOWE/CS/RWS/2026/0117 - Technical and Financial Proposal".',
        TECHNICAL,
      ),
      false,
      "a procurement reference number is an identifier, not an amount",
    );
  });

  it("accepts a proposal naming the separate financial envelope", () => {
    assert.equal(
      containsPricingLeakage(
        "The Technical Proposal and the Financial Proposal must be submitted in separate sealed envelopes.",
        TECHNICAL,
      ),
      false,
      "a two-envelope tender requires the technical proposal to reference the financial one",
    );
  });

  it("accepts the document's own no-price assurance", () => {
    assert.equal(
      containsPricingLeakage(
        "Pricing, rates, BOQ, and commercial terms must not appear in a technical-envelope document.",
        TECHNICAL,
      ),
      false,
    );
  });

  it("accepts a comparable-projects row whose value sits in its own cell", () => {
    // Cell boundaries are newlines once extraction preserves them, so the
    // amount arrives with no wording of its own and only its neighbours can
    // say what it is. The named client is what identifies the row.
    const row = [
      "Adama Town Water Supply Distribution Network — Detailed Design",
      "Oromia Water Works Design and Supervision Enterprise",
      "Ethiopia",
      "Water and sanitation",
      "ETB 18.4M",
    ].join("\n");
    assert.equal(
      containsPricingLeakage(row, TECHNICAL),
      false,
      "a past project's contract value is evidence of experience, not this bid's price",
    );
  });

  it("does not let an exempted neighbour erase the context a value depends on", () => {
    // Faults 2 and 3 interacting: the row that names the client is itself
    // exempt, and when the context window read only surviving fragments the
    // client disappeared and the value flagged.
    const doc = [
      'Commercial / Financial Proposal Controls; Adama Town Water Supply — Oromia Water Works Design and Supervision Enterprise',
      "Ethiopia",
      "Water and sanitation",
      "ETB 18.4M",
      "62 km distribution network and four reservoirs",
    ].join("\n");
    assert.equal(containsPricingLeakage(doc, TECHNICAL), false);
  });
});

describe("actual pricing in a technical envelope is still refused", () => {
  const leaks: Array<[string, string]> = [
    ["an explicit total", "Total price: $50,000 for the full scope of work."],
    ["our own fee", "Our consultancy fee for this assignment is ETB 1,200,000."],
    ["a priced service line", "Construction supervision: ETB 2,000,000."],
    ["a staff rate", "The daily rate for the Team Leader is 4,500 ETB."],
    ["a percentage fee", "Our fee is 12% of the contract value."],
    ["a bill of quantities", "A full bill of quantities is attached to this technical submission."],
    ["a price schedule", "See the attached price schedule for unit rates."],
  ];
  for (const [label, text] of leaks) {
    it(`refuses ${label}`, () => {
      assert.equal(containsPricingLeakage(text, TECHNICAL), true);
    });
  }

  it("refuses a bare amount with no context to excuse it", () => {
    assert.equal(
      containsPricingLeakage("ETB 18.4M", TECHNICAL),
      true,
      "context is what excuses a value; absent context it is a price",
    );
  });

  it("refuses a value whose context is this bid, not a past project", () => {
    const doc = ["Our financial offer for this assignment", "summary", "details", "ETB 18.4M"].join("\n");
    assert.equal(
      containsPricingLeakage(doc, TECHNICAL),
      true,
      "the current-offer veto must outrank the reference-value exemption",
    );
  });
});
