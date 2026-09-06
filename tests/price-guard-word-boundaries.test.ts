// The price-leakage guard must delete prices, not ordinary words.
//
// THE DELIVERED DEFECT
// --------------------
// Every hosted run from 34035620990 onward lost the same sub-section between
// the Section C authority and the render: "C.7 Risk Register and Mitigation
// Strategy". Its heading disappeared, its risk tables stayed, and they were
// left reading as part of "C.6 Sector-Specific Technical Standards Applied".
//
// The cause was this guard. Its priced-term list carried no word boundaries, so
// "rate" matched inside "St(rate)gy"; a heading numbered "C.7" supplies the
// digit the pattern also wants; and the guard drops any line it matches. The
// same unanchored match reaches "corpo(rate)", "accu(rate)", "sepa(rate)",
// "gene(rate)" and "ope(rate)" — ordinary words in a methodology, beside an
// ordinary number.
//
// A silent line-level delete is the worst shape for this bug: nothing failed,
// nothing was logged, and the document simply shipped with a section missing.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { enforceTechnicalPriceSeparation } from "../lib/engine/proposal-price-leakage-guard";
import type { EvaluatorMatrixInput } from "../lib/engine/proposal-evaluator-matrix";

// A tender that states the technical and financial envelopes are separate, so
// the guard is armed.
const TWO_ENVELOPE: EvaluatorMatrixInput = {
  tenderTitle: "Architectural Consultancy Services for a Specialty Medical Center",
  clientName: "Pharo Ventures",
  requirements: ["The financial proposal shall be submitted separately from the technical proposal."],
  complianceLines: ["Financial proposal is submitted in a separate sealed envelope."],
} as unknown as EvaluatorMatrixInput;

function survives(line: string): boolean {
  return enforceTechnicalPriceSeparation(line, TWO_ENVELOPE).trim() === line.trim();
}

describe("ordinary words that merely contain a priced term are kept", () => {
  for (const line of [
    "## C.7 Risk Register and Mitigation Strategy",
    "Stage 2 60% Detailed Design: the corporate quality gate applies.",
    "Cross-check accuracy >= 98%; discrepancies flagged for resolution.",
    "3 separate design disciplines are coordinated in one model.",
    "The 30% gate generates a written design rationale memo.",
    "2 operating theatres are moderated against the IPC flow standard.",
    "Phase 4: Detailed Design / Methodology Execution — Weeks 7-11",
  ]) {
    it(`keeps ${JSON.stringify(line.slice(0, 48))}`, () => {
      assert.ok(survives(line), `deleted a line that carries no price: ${line}`);
    });
  }
});

describe("real commercial content is still removed", () => {
  for (const line of [
    "Our fee for this stage is ETB 200,000.",
    "Total price: USD 45,000 inclusive of disbursements.",
    "The unit rate is 1,200 per drawing sheet.",
    "Design fee 250,000 payable on milestone completion.",
    "We quote a lump sum for the detailed design stage.",
  ]) {
    it(`removes ${JSON.stringify(line.slice(0, 48))}`, () => {
      assert.ok(!survives(line), `commercial content survived: ${line}`);
    });
  }
});

describe("the guard leaves the whole document alone when it is not armed", () => {
  it("keeps a priced line when the tender never separates the envelopes", () => {
    const openTender = {
      tenderTitle: "Design services",
      clientName: "A client",
      requirements: ["Submit a combined technical and financial proposal."],
      complianceLines: [],
    } as unknown as EvaluatorMatrixInput;
    const line = "Our fee for this stage is ETB 200,000.";
    assert.equal(enforceTechnicalPriceSeparation(line, openTender).trim(), line);
  });
});
