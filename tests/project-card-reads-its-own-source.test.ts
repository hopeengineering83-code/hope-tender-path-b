import { test } from "node:test";
import assert from "node:assert/strict";

import { extractProjectAmounts } from "../lib/engine/project-fact-extractor";

/**
 * The delivered proposal's single portfolio card — the most important piece of
 * evidence in the whole document — read:
 *
 *   Client            Gimba City, South Wollo Zone, Amhara Region,
 *   Location & Scale  —
 *   Duration          Dates on file
 *
 * while that record's own source text states "(7,000 m²)", "2015-2018 E.C.",
 * and three separate amounts. The company authority these records came from
 * declares the gap outright — projectSectorMissing: 114,
 * projectServiceAreasEmpty: 114 — and states as policy that "structured fields
 * are an index only. rawText is the factual source".
 *
 * THE DANGEROUS PART is the money. A single record states:
 *
 *   1. Construction Cost: 550,074,678.02 ETB
 *   2. Feasibility Study, Geotechnical & New Design Cost: 1,100,000 ETB
 *   3. Contract Administration & Construction Supervision Cost: 110,000 ETB/month
 *
 * Three amounts, three different things. Presenting the first under "Contract
 * Value" on a CONSULTANCY proposal overstates the firm's contract by roughly
 * five hundred times, in a document an evaluator may check against the client's
 * own records. Each amount therefore carries the role its own label gives it.
 */

const REAL_RECORD = [
  "14 G+6 General Hospital – Dr Abdul Seid / Gimba City, South Wollo Zone, Amhara Region, Ethiopia (7,000 m²)",
  "Ref: 1591/18 Date: 19/01/2018 E.C. Author: Tariku Abebaw (Building Officer, Gimba City Admin)",
  "1. Construction Cost: 550,074,678.02 ETB",
  "2. Feasibility Study, Geotechnical & New Design Cost: 1,100,000 ETB",
  "3. Contract Administration & Construction Supervision Cost: 110,000 ETB/month",
  "2015-2018 E.C.",
].join(" ");

test("a construction cost is never mistaken for the consultancy's fee", () => {
  const amounts = extractProjectAmounts(REAL_RECORD);
  const construction = amounts.find((a) => a.role === "CONSTRUCTION");
  const fee = amounts.find((a) => a.role === "CONSULTANCY_FEE");

  assert.ok(construction, "construction cost should be recognised");
  assert.equal(construction!.value, 550074678.02);

  assert.ok(fee, "consultancy fee should be recognised");
  assert.equal(fee!.value, 1100000);

  // The distinction is the whole point.
  assert.notEqual(construction!.value, fee!.value);
});

test("a per-month amount is a rate, however it is labelled", () => {
  const amounts = extractProjectAmounts(REAL_RECORD);
  const rate = amounts.find((a) => a.perMonth);
  assert.ok(rate);
  assert.equal(rate!.role, "SUPERVISION_RATE");
  assert.equal(rate!.value, 110000);
});

test("the source's own label is carried, not invented", () => {
  const fee = extractProjectAmounts(REAL_RECORD).find((a) => a.role === "CONSULTANCY_FEE");
  assert.match(fee!.label, /Feasibility Study, Geotechnical & New Design/);
});

test("roles are read from labels, in any sector", () => {
  const cases: Array<[string, string, number]> = [
    ["Road rehabilitation. Construction Cost: 240,000,000 ETB.", "CONSTRUCTION", 240000000],
    ["Water supply scheme. Detailed Design Cost: 2,400,000 ETB.", "CONSULTANCY_FEE", 2400000],
    ["Site supervision. Supervision Cost: 90,000 ETB/month.", "SUPERVISION_RATE", 90000],
    ["Geotechnical investigation. Consultancy Fee: 780,000 ETB.", "CONSULTANCY_FEE", 780000],
    ["Master plan. Feasibility Study Cost: 1,500,000 ETB.", "CONSULTANCY_FEE", 1500000],
  ];
  for (const [text, role, value] of cases) {
    const found = extractProjectAmounts(text).find((a) => a.value === value);
    assert.ok(found, text);
    assert.equal(found!.role, role, text);
  }
});

test("an amount with no informative label is not promoted to a fee", () => {
  const amounts = extractProjectAmounts("Reference cost: 4,000,000 ETB recorded on file.");
  const found = amounts.find((a) => a.value === 4000000);
  assert.ok(found);
  assert.equal(found!.role, "UNLABELLED");
});

test("small numbers and page furniture are not amounts", () => {
  assert.deepEqual(extractProjectAmounts("Ref: 8087/2013, Date: 07/01/2013 E.C. Page 4 of 36"), []);
  assert.deepEqual(extractProjectAmounts("Cost: 250 ETB"), []);
  assert.deepEqual(extractProjectAmounts(""), []);
});

test("the portfolio card presents the fee and the works value separately", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("lib/engine/benchmark-tables.ts", "utf8");
  assert.match(source, /Consultancy Fee/);
  assert.match(source, /Construction Value of Works/);
  // The monthly supervision rate must not reach a technical-envelope document.
  assert.doesNotMatch(source, /SUPERVISION_RATE.*rows\.push/s);
  // And the largest-amount heuristic must not feed the value row.
  assert.match(source, /derived\.contractValue is deliberately NOT used/);
});
