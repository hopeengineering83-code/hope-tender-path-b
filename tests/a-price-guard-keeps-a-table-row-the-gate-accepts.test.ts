// 2026-09-27, Preview, accept run 36336299603: the package passed every gate
// at score 100, and the delivered PDF still carried three tables with rows
// missing. "A.4 Team-to-Project Experience Mapping" and "B.1 Client
// References" were headers with no rows, and the QA checklist ran 1, 2, 3,
// 5, 6, 7.
//
// enforceTechnicalPriceSeparation read each table row as one flat line. A past
// project's labelled construction value, a reference's contract value, and a
// row number beside "BOQ" all looked like this bid's price, so the rows were
// deleted, while the export gate reading the same rows accepted them. The guard
// now judges a table row the way the gate reads it. The "BOQ" wording is
// rewritten before the guard runs.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { enforceTechnicalPriceSeparation } from "../lib/engine/proposal-price-leakage-guard";
import { buildClientReferencesTable, buildTeamToProjectMappingTable } from "../lib/engine/benchmark-tables";
import type { EvaluatorMatrixInput } from "../lib/engine/proposal-evaluator-matrix";

const technicalOnly = {
  tenderTitle: "Consultancy Services",
  clientName: "Client",
  requirements: ["Submit a technical proposal only. No financial offer or pricing shall be included."],
  complianceLines: [],
} as unknown as EvaluatorMatrixInput;

const projects = [
  { id: "p1", name: "Referral Clinic", clientName: "Regional Health Bureau", country: "Kenya", contractValue: 18_900_000, currency: "USD", sector: "Healthcare", serviceAreas: ["Architectural design"], summary: "Design and supervision of a referral clinic." },
] as never[];
const experts = [
  { id: "e1", fullName: "Test Expert", title: "Lead Architect", disciplines: ["Architecture"], profile: "Projects: Referral Clinic" },
] as never[];

const dataRows = (markdown: string) => markdown.split("\n").filter((line) => /^\|/.test(line) && !/^\|[\s:|-]+\|$/.test(line)).slice(1);

describe("the price guard keeps a table row the export gate accepts", () => {
  it("keeps the team-to-project mapping row that names a past project's value", () => {
    const table = buildTeamToProjectMappingTable(experts, projects);
    assert.equal(dataRows(table).length, 1, "fixture yields one mapping row");
    assert.equal(dataRows(enforceTechnicalPriceSeparation(table, technicalOnly)).length, 1);
  });

  it("keeps the client-reference row with its contract value", () => {
    const table = buildClientReferencesTable(projects);
    assert.equal(dataRows(enforceTechnicalPriceSeparation(table, technicalOnly)).length, 1);
  });

  it("still removes a row offering this bid's price", () => {
    const table = "| Item | Value |\n|---|---|\n| Our fee for this assignment | USD 250,000 |";
    assert.equal(dataRows(enforceTechnicalPriceSeparation(table, technicalOnly)).length, 0);
    assert.doesNotMatch(enforceTechnicalPriceSeparation("| 1 | Our fee is USD 20,000 |", technicalOnly), /20,000/);
  });

  it("still removes prose stating an amount", () => {
    assert.equal(enforceTechnicalPriceSeparation("The total amount is ETB 1,200,000.", technicalOnly), "");
  });

  it("rewrites BOQ wording before the guard reads the line", () => {
    const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
    const rewrite = source.indexOf('.replace(/\\b(?:bill of quantities|boq)\\b/gi, "quantity schedules")');
    const guard = source.indexOf("enforceTechnicalPriceSeparation(workingMarkdown, evaluatorMatrixInput)");
    assert.ok(rewrite > 0 && guard > 0, "both passes present");
    assert.ok(rewrite < guard, "the BOQ rewrite precedes the first final-markdown guard pass");
  });
});
