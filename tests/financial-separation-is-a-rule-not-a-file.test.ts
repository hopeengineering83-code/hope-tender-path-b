import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Regression pin for the live-tender defect: the confirmed Build Plan required
// a file called "Financial Proposal Omission.docx".
//
// No such document exists in the tender. The tender says the financial proposal
// must be OMITTED. The classifier saw the words "financial proposal", read the
// requirement title as a deliverable, and invented a file from a prohibition —
// which automatic generation can never legitimately produce, so the package
// could never converge.
//
// A requirement that states the financial proposal is omitted, excluded,
// separated or sent in its own envelope is a SUBMISSION / ENVELOPE CONSTRAINT.
// It is proven by the shape of the package, not by a file restating it.

import { statesFinancialSeparation } from "../lib/engine/financial-separation-rule";
import { classifySubmissionPlanItem } from "../lib/engine/submission-plan-classifier";
import { enforceTechnicalPriceSeparation } from "../lib/engine/proposal-price-leakage-guard";

/** Phrasings that MUST resolve to a rule, never to a planned file. */
const SEPARATION_RULES = [
  "Financial Proposal Omission",
  "Omission of the financial proposal",
  "The financial proposal must be omitted from the technical envelope",
  "Financial proposal is excluded from this submission",
  "Financial proposal: not required at this stage",
  "Financial proposal is not applicable",
  "No Financial Proposal",
  "No financial offer is to be submitted",
  "Financial proposal is separated from the technical proposal",
  "Submit the financial proposal separately",
  "Technical proposal only",
  "Only the technical proposal is to be submitted at this stage",
  "Two-envelope submission",
  "Technical and financial offers in separate envelopes",
  "Do not include price information in the technical proposal",
  "The technical proposal shall be submitted without prices",
];

/** Real deliverables that MUST stay planned files despite financial wording. */
const REAL_DELIVERABLES = [
  "Financial Proposal Form",
  "Price Schedule Annex",
  "Bill of Quantities",
  "BOQ Template",
  "Schedule of Rates",
  "Financial Proposal Format",
];

describe("statesFinancialSeparation — the predicate", () => {
  for (const text of SEPARATION_RULES) {
    it(`treats "${text}" as a separation rule`, () => {
      assert.equal(statesFinancialSeparation(text), true);
    });
  }

  for (const text of REAL_DELIVERABLES) {
    it(`does NOT treat "${text}" as a rule — it is a real deliverable`, () => {
      assert.equal(statesFinancialSeparation(text), false);
    });
  }

  it("ignores empty and blank input", () => {
    assert.equal(statesFinancialSeparation(null), false);
    assert.equal(statesFinancialSeparation(undefined), false);
    assert.equal(statesFinancialSeparation("   "), false);
  });

  it("does not fire on an ordinary technical requirement", () => {
    assert.equal(statesFinancialSeparation("Detailed methodology and work plan"), false);
    assert.equal(statesFinancialSeparation("Expert CVs for key personnel"), false);
  });
});

describe("A separation rule never becomes a planned deliverable", () => {
  for (const text of SEPARATION_RULES) {
    it(`plans no file for "${text}"`, () => {
      const result = classifySubmissionPlanItem({ title: text, description: "" });
      assert.equal(result.shouldBePlannedFile, false,
        `"${text}" must not be planned as a file, got ${result.category}`);
      assert.equal(result.category, "COMMERCIAL_SEPARATION_RULE");
    });
  }

  it("does not invent a file even when the requirement carries a .docx name", () => {
    // The exact live-tender shape: the phantom already had a filename attached.
    const result = classifySubmissionPlanItem({
      title: "Financial Proposal Omission",
      exactFileName: "Financial Proposal Omission.docx",
      requirementType: "SUBMISSION",
    });
    assert.equal(result.shouldBePlannedFile, false,
      "a filename on a prohibition does not make it a deliverable");
  });

  for (const text of REAL_DELIVERABLES) {
    it(`still plans a file for "${text}"`, () => {
      const result = classifySubmissionPlanItem({ title: text, exactFileName: `${text}.xlsx` });
      assert.equal(result.shouldBePlannedFile, true,
        `"${text}" is a document the tender issues and the bidder completes`);
    });
  }
});

describe("The rule is enforced, not dropped", () => {
  // Moving the rule out of the plan must not lose it: the guard that strips
  // pricing from the technical narrative has to arm on the same phrasings.
  const priced = "Our methodology is proven.\nOur fee is USD 45,000 for the assignment.\nWe mobilise within two weeks.";

  for (const text of SEPARATION_RULES) {
    it(`arms the technical/price separation guard for "${text}"`, () => {
      const cleaned = enforceTechnicalPriceSeparation(priced, {
        tenderTitle: "Consultancy services",
        clientName: "",
        requirements: [text],
        complianceLines: [],
      } as never);
      assert.ok(!cleaned.includes("USD 45,000"),
        `"${text}" must arm the guard so priced content is stripped from the technical envelope`);
      assert.ok(cleaned.includes("Our methodology is proven."),
        "the guard must keep genuine technical content");
    });
  }

  it("classifier and guard cannot disagree about what states the rule", () => {
    // One predicate, two consumers. Before this, a phrasing could stop a
    // phantom file being planned while leaving the enforcement guard unarmed —
    // the app would drop the constraint while believing it had handled it.
    for (const text of [...SEPARATION_RULES, ...REAL_DELIVERABLES]) {
      const isRule = statesFinancialSeparation(text);
      const classified = classifySubmissionPlanItem({ title: text, description: "" });
      if (isRule) {
        assert.equal(classified.category, "COMMERCIAL_SEPARATION_RULE",
          `predicate says "${text}" is a rule but the classifier disagreed`);
      }
    }
  });
});
