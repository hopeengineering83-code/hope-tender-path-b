import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isLocationNotAClient,
  recordFactsFor,
  repairPortfolioCards,
} from "../lib/engine/portfolio-card-repair";

/**
 * Three consecutive delivered PDFs carried this card, unchanged byte for byte
 * across two fixes aimed at the builders that were assumed to produce it:
 *
 *   Client             Gimba City, South Wollo Zone, Amhara Region,
 *   Location & Scale   Ethiopia — —
 *   Duration           2015-2018
 *   Services Provided  —
 *
 * Every one of those cells is answered by the record's own verified source
 * text. These tests use non-healthcare records first, because the defect was
 * generic and only the benchmark that exposed it was healthcare.
 */

const ROAD_RECORD = {
  name: "Woldia–Dessie Road Upgrading",
  clientName: "Ethiopian Roads Authority",
  country: "Ethiopia",
  summary:
    "Woldia–Dessie Road Upgrading, 42.5 km, Amhara Region. 1. Construction Cost: 240,000,000 ETB " +
    "2. Design and Tender Document Cost: 4,500,000 ETB 3. Construction Supervision Cost: 95,000 ETB/month. " +
    "2016-2019 E.C. Topographic survey, Geotechnical investigation, Pavement design, Drainage design, " +
    "Tender document preparation, Construction supervision.",
};

const WATER_RECORD = {
  name: "Bishoftu Town Water Supply Scheme",
  clientName: "Bishoftu Town Water Utility",
  country: "Ethiopia",
  summary:
    "Bishoftu Town Water Supply Scheme (35 l/s). Feasibility study, Hydraulic design, Borehole siting, " +
    "Construction supervision. Design Cost: 2,200,000 ETB. 2018-2020 E.C.",
};

function card(name: string, rows: Array<[string, string]>): string {
  return [
    `### ${name}`,
    "",
    "| Field | Detail |",
    "|---|---|",
    ...rows.map(([label, value]) => `| ${label} | ${value} |`),
    "",
  ].join("\n");
}

function cellsOf(markdown: string): Map<string, string> {
  const cells = new Map<string, string>();
  for (const line of markdown.split("\n")) {
    const match = /^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/.exec(line);
    if (!match || /^-+$/.test(match[1].replace(/[:\s]/g, "")) || match[1] === "Field") continue;
    cells.set(match[1], match[2]);
  }
  return cells;
}

test("an em-dash cell is filled from the record's own words", () => {
  const markdown = card(ROAD_RECORD.name, [
    ["Client", "Ethiopian Roads Authority"],
    ["Location & Scale", "Ethiopia — —"],
    ["Duration", "—"],
    ["Services Provided", "—"],
  ]);

  const repaired = repairPortfolioCards(markdown, [ROAD_RECORD]);
  const cells = cellsOf(repaired.markdown);

  assert.equal(cells.get("Client"), "Ethiopian Roads Authority", "a real client name must survive untouched");
  assert.match(cells.get("Location & Scale") ?? "", /42\.5 km/, "the scale the record states must appear");
  assert.equal(cells.get("Duration"), "2016–2019");
  assert.match(cells.get("Services Provided") ?? "", /Pavement design/);
  assert.match(cells.get("Services Provided") ?? "", /Topographic survey/);
});

test("no delivered card cell ever asserts nothing", () => {
  for (const record of [ROAD_RECORD, WATER_RECORD]) {
    const markdown = card(record.name, [
      ["Client", record.clientName],
      ["Location & Scale", "—"],
      ["Duration", "—"],
      ["Contract Value", "—"],
      ["Testimony Reference", "—"],
      ["Services Provided", "—"],
      ["Relevance to This Assignment", "—"],
    ]);

    const repaired = repairPortfolioCards(markdown, [record]);
    for (const [label, value] of cellsOf(repaired.markdown)) {
      assert.ok(
        value.trim().length > 0 && !/^[-–—\s]*$/.test(value) && !/^n\/?a$/i.test(value),
        `${record.name}: "${label}" still asserts nothing ("${value}")`,
      );
    }
    // The rows the record cannot answer are gone, not dashed.
    assert.ok(!repaired.markdown.includes("Testimony Reference"));
    assert.ok(!repaired.markdown.includes("Relevance to This Assignment"));
  }
});

test("a consultancy fee is never printed as a bare contract value", () => {
  const markdown = card(ROAD_RECORD.name, [["Contract Value", "—"]]);
  const repaired = repairPortfolioCards(markdown, [ROAD_RECORD]);
  const cells = cellsOf(repaired.markdown);

  // The record states a 240,000,000 ETB CONSTRUCTION cost and a 4,500,000 ETB
  // design fee. Printing the former as this firm's contract value overstates
  // its contract by about fifty times.
  assert.equal(cells.has("Contract Value"), false, "the misleading bare label must be replaced");
  assert.equal(cells.get("Consultancy Fee"), "ETB 4.5M");
  assert.equal(cells.get("Construction Value of Works"), "ETB 240.0M");
  // A monthly supervision rate is a price signal, not a track-record fact.
  assert.ok(!repaired.markdown.includes("95"), "the monthly supervision rate must not be printed");
});

test("a value the writer already stated is never overwritten", () => {
  const markdown = card(ROAD_RECORD.name, [
    ["Client", "Ethiopian Roads Authority"],
    ["Location & Scale", "Amhara Region — 42.5 km of trunk road"],
    ["Duration", "Three years, completed"],
  ]);
  const repaired = repairPortfolioCards(markdown, [ROAD_RECORD]);
  const cells = cellsOf(repaired.markdown);

  assert.equal(cells.get("Location & Scale"), "Amhara Region — 42.5 km of trunk road");
  assert.equal(cells.get("Duration"), "Three years, completed");
});

test("a card whose heading matches no supplied record is left alone", () => {
  const markdown = card("Some Other Assignment Entirely", [
    ["Client", "—"],
    ["Duration", "—"],
  ]);
  const repaired = repairPortfolioCards(markdown, [ROAD_RECORD, WATER_RECORD]);
  assert.equal(repaired.markdown, markdown);
  assert.deepEqual([...repaired.filled, ...repaired.removed], []);
});

test("a place is not a client", () => {
  // The exact value the delivered card asserted.
  assert.equal(isLocationNotAClient("Gimba City, South Wollo Zone, Amhara Region,"), true);
  assert.equal(isLocationNotAClient("Bishoftu Town, Oromia Region"), true);

  // Real clients, all of which must pass through untouched.
  assert.equal(isLocationNotAClient("Gimba City Administration"), false);
  assert.equal(isLocationNotAClient("Haik town administration"), false);
  assert.equal(isLocationNotAClient("Tenta City Admin"), false);
  assert.equal(isLocationNotAClient("Ethiopian Roads Authority"), false);
  assert.equal(isLocationNotAClient("Dr Abdul Seid"), false);
  assert.equal(isLocationNotAClient("Addis Ababa University"), false);
  assert.equal(isLocationNotAClient(""), false);
});

test("a location asserted as a client moves to the location row", () => {
  const record = {
    name: "G+6 General Hospital – Dr Abdul Seid",
    clientName: "Gimba City, South Wollo Zone, Amhara Region,",
    country: "Ethiopia",
    summary:
      "G+6 General Hospital – Dr Abdul Seid / Gimba City, South Wollo Zone, Amhara Region, Ethiopia (7,000 m²). " +
      "1. Construction Cost: 550,074,678.02 ETB 2. Feasibility Study, Geotechnical & New Design Cost: 1,100,000 ETB " +
      "3. Contract Administration & Construction Supervision Cost: 110,000 ETB/month. 2015-2018 E.C. " +
      "Feasibility study, Soil investigation, Laboratory testing, New Architectural design, New Structural design, " +
      "Complete MEP Design, Material specification, Bill of Quantity preparation, Tender document preparation, " +
      "Construction supervision.",
  };

  const markdown = card(record.name, [
    ["Client", record.clientName],
    ["Location & Scale", "Ethiopia — —"],
    ["Services Provided", "—"],
  ]);
  const repaired = repairPortfolioCards(markdown, [record]);
  const cells = cellsOf(repaired.markdown);

  assert.equal(cells.has("Client"), false, "a bare address must not be asserted as the client");
  assert.match(cells.get("Location & Scale") ?? "", /Gimba City/);
  assert.match(cells.get("Location & Scale") ?? "", /7,000 m²/);
  assert.match(cells.get("Services Provided") ?? "", /Feasibility study/);
});

test("scale survives a unit that ends in a superscript", () => {
  // A trailing \b never fires after "m²", which is how 108 of the owner's 114
  // records silently reported no scale at all.
  assert.equal(recordFactsFor({ name: "x", summary: "Office block (7,000 m²) completed." }).scale, "7,000 m²");
  assert.equal(recordFactsFor({ name: "x", summary: "Master plan covering 1,240 ha." }).scale, "1,240 ha");
  assert.equal(recordFactsFor({ name: "x", summary: "Scheme rated at 35 l/s." }).scale, "35 l/s");
  assert.equal(recordFactsFor({ name: "x", summary: "42.5 km of trunk road." }).scale, "42.5 km");
  assert.equal(recordFactsFor({ name: "x", summary: "No measurable scale is stated." }).scale, undefined);
});

test("stored service areas win over derived ones", () => {
  const facts = recordFactsFor({
    name: "x",
    summary: "Feasibility study, Structural design.",
    serviceAreas: JSON.stringify(["Master planning", "Urban design"]),
  });
  assert.equal(facts.services, "Master planning, Urban design");
});
