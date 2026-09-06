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
import { buildWorkPlanTable } from "../lib/engine/work-plan-timeline";

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

// ── Technical content must not be written in commercial words ────────────────
//
// Run 34045764622 delivered a phase narrative whose own opening says "delivered
// across 6 phases" and then lists Phases 1, 2, 3, 5 and 6, and an innovation
// section that introduces "the following" hooks and lists one of three. Each
// missing block had a body the price guard correctly deleted, because the
// producer had written a priced term into a technical-only proposal:
//
//   Phase 4      "… specifications, BOQ, design report, 60% gate sign-off pack"
//   Innovation 3 "… one 60-minute call per month at no fee …"
//
// The guard was right and the producers were wrong. Weakening the guard would
// have let a real fee through; these are technical deliverables and belong in
// technical words.
//
// The third gap had a different cause and is covered in
// tests/innovation-hook-numbering.test.ts: the hooks wrote their own numbers
// into their titles, and hook 2 is conditional, so a proposal listed
// "Innovation 1" and then "Innovation 3".
describe("phase and innovation content survives a price-separated tender", () => {
  for (const line of [
    "Detailed design drawings (architectural / structural / MEP / civil as applicable), specifications, quantity schedules, design report, 60% gate sign-off pack",
    "Concept design at the 30% gate carries an explicit brand-alignment review item. Revision rounds for brand-driven adjustments are planned into the engagement programme.",
    "The bidder retains a 6-month post-handover advisory window, one 60-minute call per month, so the client has continuity support through early implementation.",
  ]) {
    it(`keeps ${JSON.stringify(line.slice(0, 44))}`, () => {
      assert.ok(survives(line), `a technical deliverable was deleted as commercial: ${line}`);
    });
  }

  it("still deletes the commercial phrasing these replaced", () => {
    assert.ok(!survives("… specifications, BOQ, design report, 60% gate sign-off pack"));
    assert.ok(!survives("The bidder retains one 60-minute call per month at no fee."));
  });
});

// ── No sector's work plan may lose a phase to the guard ──────────────────────
//
// The healthcare timeline's fourth phase was titled "Phase 4: Working Drawings
// + BOQ" and listed "BOQ" among its deliverables, so on a tender that separates
// the envelopes the guard deleted the row and the delivered work-plan table
// read Phase 1, 2, 3, 5, 6. Twelve rows across nine sector timelines had the
// same shape.
//
// "BOQ" was simply the wrong word: the deliverable is a quantity schedule, and
// the rest of the app already calls it that. This walks every sector's own
// timeline rather than a fixture, so a phase added later cannot reintroduce the
// defect unnoticed.
describe("every sector's work plan survives a price-separated tender", () => {
  const SECTORS = [
    "Healthcare / Medical Facility Design",
    "Water and Sanitation",
    "Roads and Bridges",
    "Environmental / ESIA",
    "ICT and Digital Systems",
    "Education Facilities",
    "Power Systems",
    "Mining",
    "Irrigation",
    "Ports and Marine",
    "Contract Administration",
    "Interior Design",
    "Heritage Conservation",
    "Industrial Facilities",
    "High-Rise Buildings",
    "Hospitality and Tourism",
    "Urban Planning",
  ];

  for (const sector of SECTORS) {
    it(`keeps every phase row for ${sector}`, () => {
      const table = buildWorkPlanTable({ primarySector: sector });
      const rows = table.split("\n").filter((line) => /^\|\s*Phase\s*\d/.test(line));
      assert.ok(rows.length > 0, `no phase rows built for ${sector}`);
      for (const row of rows) {
        assert.ok(survives(row), `a work-plan phase was deleted as commercial content:\n${row}`);
      }
    });
  }
});
