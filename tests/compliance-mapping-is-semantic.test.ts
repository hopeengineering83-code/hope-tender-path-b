import { test } from "node:test";
import assert from "node:assert/strict";

import { buildBidComplianceMapping } from "../lib/engine/bid-compliance-mapping";

/**
 * E.1 maps each tender requirement to the proposal section that answers it, and
 * an evaluator navigates the proposal with it. The delivered table sent
 *
 *   SCORED | Project Experience | Proven Healthcare Facility Design Experience
 *
 * to "Section A.5 Proposed Project Team ... A.4.1 Principal Qualifications" —
 * the CV section — while the proposal's own Section B Project Portfolio went
 * uncited. The requirement was typed PROJECT_EXPERIENCE; the type was merely
 * one alternative inside each keyword test, so the expert branch, tested first,
 * won on the word "qualifications" in the description.
 *
 * The declared type now decides. Keywords remain a fallback for requirements
 * the analyser could not type.
 */

function locationFor(req: {
  title: string;
  description?: string;
  requirementType?: string;
}): string {
  const table = buildBidComplianceMapping({ requirements: [{ priority: "HIGH", ...req }] });
  assert.ok(table, "mapping table should be produced");
  const row = table!.split("\n").find((line) => line.includes(req.title));
  assert.ok(row, `no row for ${req.title}`);
  return row!;
}

test("a typed requirement goes where its type says, not where a keyword points", () => {
  const row = locationFor({
    title: "Proven Healthcare Facility Design Experience",
    description: "Bidder shall demonstrate similar completed projects. Team qualifications will also be reviewed.",
    requirementType: "PROJECT_EXPERIENCE",
  });
  assert.match(row, /Project Portfolio/);
  assert.doesNotMatch(row, /Principal Qualifications/);
});

test("the same rule holds in the other direction", () => {
  const row = locationFor({
    title: "Key Personnel Qualifications",
    description: "CVs of the proposed team, including their project experience on similar assignments.",
    requirementType: "EXPERT",
  });
  assert.match(row, /Proposed Project Team/);
  assert.doesNotMatch(row, /Project Portfolio/);
});

test("typed routing is sector-neutral", () => {
  const cases: Array<[string, string, RegExp]> = [
    ["Comparable Road Rehabilitation Contracts", "PROJECT_EXPERIENCE", /Project Portfolio/],
    ["Water Supply Network Design Methodology", "METHODOLOGY", /Technical Methodology/],
    ["Geotechnical Team Composition", "EXPERT", /Proposed Project Team/],
    ["Implementation Programme and Milestones", "SCHEDULE", /Work Plan and Schedule/],
    ["Audited Financial Statements", "FINANCIAL", /Audited Financial Statements/],
    ["Trade Licence and Registration", "COMPANY_PROFILE", /Company Background/],
  ];
  for (const [title, requirementType, expected] of cases) {
    assert.match(locationFor({ title, requirementType }), expected, `${title} (${requirementType})`);
  }
});

test("an untyped requirement still falls back to keywords, most specific first", () => {
  // TECHNICAL is the analyser's default for "could not classify", so it must
  // not short-circuit the keyword pass.
  const projectRow = locationFor({
    title: "Similar Project Experience in the last five years",
    requirementType: "TECHNICAL",
  });
  assert.match(projectRow, /Project Portfolio/);

  const riskRow = locationFor({ title: "Risk Management and Mitigation Plan", requirementType: "TECHNICAL" });
  assert.match(riskRow, /Risk Register/);

  const untyped = locationFor({ title: "Quality assurance and peer review arrangements" });
  assert.match(untyped, /Quality Review/);
});

test("a requirement nothing matches lands in the annex, not in an arbitrary section", () => {
  const row = locationFor({ title: "Bidder shall attend the site visit on the stated date" });
  assert.match(row, /Compliance Matrix annex/);
});
