// Fragment boundaries are pricing-detection boundaries.
//
// WHY THIS FILE EXISTS
// --------------------
// A live Vercel Preview run died in a terminal AUTO_FINALIZE_NOT_CONVERGED
// loop:
//
//   Technical Proposal.docx -> "Possible financial/pricing language appears
//   in a technical document" -> blockedByHygiene, on every attempt, with
//   CURRENT OUTPUTS staying 0.
//
// The reproduced cause is a false positive created by the detector itself.
// containsPricingLeakage splits the visible text into fragments (sentences,
// paragraphs, table cells — visibleXmlText ends every </w:p>, </w:tr> and
// </w:tc> with a newline) and then joined the surviving fragments with a
// SPACE. The proximity patterns pair a number with a priced term through
// `.{0,90}` / `.{0,40}` windows, so a fragment ENDING in a number paired
// with a priced term at the START of the next fragment — a "price" that
// exists in no sentence of the document:
//
//   "The assignment will be delivered over 18 months."          (clean alone)
//   "Consultancy fee terms are governed by the sealed companion
//    envelope required by this tender."                          (clean alone)
//
// Because every fragment was individually clean, the paragraph-level repair
// (cleanDocxHygieneIssues -> safeParagraphText judges each sentence on its
// own) found nothing to remove, returned null, and export-gap-repair
// recorded blockedByHygiene forever. The blocker is NON_RETRYABLE, so the
// tender never converged.
//
// The survivors are now joined with a newline; in JavaScript `.` does not
// match a line terminator, so the proximity windows are fragment-local and
// the false pairing is structurally impossible. This is the same
// false-positive family visibleXmlText's own comment documents ("a table is
// not a sentence"), closed at the last remaining seam.
//
// The pair below keeps both directions honest, per the fix contract:
//   SAFE — the legitimate cross-fragment shapes a real provider writes.
//   UNSAFE — genuine current-bid pricing, which must still fail closed.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { containsPricingLeakage } from "../lib/engine/pricing-hygiene";

const TECHNICAL_DOC = {
  name: "Technical Proposal",
  exactFileName: "Technical-Proposal.docx",
  documentType: "TECHNICAL_PROPOSAL",
  format: "DOCX",
} as never;

const SAFE_CASES: Array<[string, string]> = [
  [
    "a duration fragment before a consultancy-fee fragment",
    "The assignment will be delivered over 18 months through four consolidated field campaigns.\nConsultancy fee terms are governed by the sealed companion envelope required by this tender.",
  ],
  [
    "a reference-count fragment before a contract-value-omission fragment",
    "The firm has delivered more than 140 assignments for public sector clients since 2009.\nContract value disclosure is outside the scope of this technical envelope.",
  ],
  [
    "an evaluation table whose points and priced-term cells are separate rows",
    "Technical approach and methodology\n35 points\nRelevant firm experience\n25 points\nProfessional fee transparency\nAddressed via the separate financial envelope",
  ],
  [
    "an evaluation weight fragment before a non-exempt financial-proposal fragment",
    "Work plan, staffing schedule and quality assurance carry a combined weight of 15 points.\nThe financial proposal is opened by the evaluation committee after technical scoring concludes.",
  ],
  [
    "the live document shape: many clean fragments in sequence",
    "Understanding of the assignment\nThe scope covers detailed design and construction supervision.\nField assessment of candidate scheme sites is completed in the first quarter.\nTeam composition\n3 selected expert(s)\nCommercial / Financial Proposal Controls\nThe technical envelope carries no contract values, fees or rates.",
  ],
];

describe("SAFE — adjacent fragments cannot combine into a price that no sentence contains", () => {
  for (const [label, text] of SAFE_CASES) {
    it(`clears: ${label}`, () => {
      assert.equal(
        containsPricingLeakage(text, TECHNICAL_DOC),
        false,
        "adjacent fragments must not pair into a price that no sentence contains",
      );
    });
  }

  it("each fragment of every safe case is also individually clean (the repair can see the same truth)", () => {
    for (const [, text] of SAFE_CASES) {
      for (const fragment of text.split("\n")) {
        assert.equal(
          containsPricingLeakage(fragment, TECHNICAL_DOC),
          false,
          `fragment was individually clean before the fix and must remain so: "${fragment.slice(0, 80)}"`,
        );
      }
    }
  });
});

const UNSAFE_CASES: Array<[string, string]> = [
  ["current total price with currency", "Our total price for the assignment is 12,400,000 ETB including all reimbursable costs."],
  ["financial proposal totals an amount", "The Financial Proposal totals USD 4,250,000 for the full scope of services."],
  ["a fee schedule with a number in the same sentence", "Fee schedule: 1,200 per day for each key expert."],
  ["a percentage fee on the contract value", "A 10% fee applies to the contract value."],
  ["daily rate with currency", "Our daily rate is 500 USD per expert."],
  ["a priced BoQ row", "Price schedule: Lot 1 — 500 ETB; Lot 2 — 800 ETB; Lot 3 — 1,200 ETB."],
  ["unit price and amount in one sentence", "Unit price is 250 birr per cubic metre, for a contract amount of 3,000,000 birr."],
  ["a quotation", "Our quotation for the works is 250,000 ETB."],
  ["a rate card", "The applicable rate card is: senior engineer 90 USD/hour, drafter 25 USD/hour."],
  ["a commercial offer with an amount", "Our commercial offer for this tender is 1.8M ETB."],
  ["lump sum with amount", "The work will be delivered for a lump sum of USD 2,400,000."],
];

describe("UNSAFE — genuine current-bid pricing still fails closed", () => {
  for (const [label, text] of UNSAFE_CASES) {
    it(`flags: ${label}`, () => {
      assert.equal(
        containsPricingLeakage(text, TECHNICAL_DOC),
        true,
        "a sentence carrying a real current-bid price must remain leakage",
      );
    });
  }

  it("currency pairing survives a fragment break (\\s* matches the newline join)", () => {
    // The amount and its currency code arrive as separate table cells.
    // The currency patterns glue them with \s*, which matches newlines, so
    // this is still one amount — not a fragment-boundary false negative.
    assert.equal(containsPricingLeakage("12,400,000\nETB", TECHNICAL_DOC), true);
    assert.equal(containsPricingLeakage("Total\nUSD 4,250,000", TECHNICAL_DOC), true);
  });

  it("a genuine leak among clean fragments is still caught (one bad fragment condemns the document)", () => {
    const text = [
      "The methodology proceeds from evidence to design.",
      "Our total price for the assignment is 12,400,000 ETB.",
      "Quality assurance follows a four-stage review procedure.",
    ].join("\n");
    assert.equal(containsPricingLeakage(text, TECHNICAL_DOC), true);
  });
});

describe("the repairability invariant: full-text trips must be visible per-fragment", () => {
  // AUTO_FINALIZE converges only when the paragraph-level repair can act on
  // whatever the full-text detector flagged. If the full text trips while
  // every fragment is individually clean, the repair has nothing to remove,
  // blockedByHygiene persists, and the tender dies in the NON_RETRYABLE
  // NOT_CONVERGED loop this file exists to prevent.
  const DOCUMENTS: Array<[string, string]> = [
    ...SAFE_CASES,
    ...UNSAFE_CASES,
    ["clean multi-fragment document", "Detailed design of boreholes and pumping mains.\n62 km of distribution network.\nNo financial information is contained in the technical proposal."],
    ["historical reference value", "Adama Town Water Supply Distribution Network for Oromia Water Works Design and Supervision Enterprise, completed 2025.\nETB 18.4M"],
    ["priced schedule rows", "Item A\n500 ETB\nItem B\n800 ETB"],
  ];

  for (const [label, text] of DOCUMENTS) {
    it(`holds for: ${label}`, () => {
      const fragments = text.split("\n").filter(Boolean);
      const fullTrip = containsPricingLeakage(text, TECHNICAL_DOC);
      const fragmentTrip = fragments.some((f) => containsPricingLeakage(f, TECHNICAL_DOC));
      assert.ok(
        !fullTrip || fragmentTrip,
        "full-text trip without any tripping fragment is the unrepairable loop",
      );
    });
  }
});
