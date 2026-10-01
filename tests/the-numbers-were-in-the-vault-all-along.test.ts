// The numbers were in the vault the whole time; nothing parsed them out.
//
// REPRODUCED, against the owner's real 114-project portfolio and the
// reference proposal they benchmark against.
//
//   delivered 35-page proposal from the app : 0 monetary figures
//   reference proposal                      : 35 monetary figures,
//                                             leading with ETB 550 million
//
// The flagship project's own reference text, stored verbatim in the vault:
//
//   "14 G+6 General Hospital - Dr Abdul Seid / Gimba City ... (7,000 m2)
//    ... 1. Construction Cost: 550,074,678.02 ETB 2. Feasibility Study,
//    Geotechnical & New Design Cost: 1,100,000 ETB ... 2015-2018 E.C."
//
// Project has columns for all of it - contractValue, currency, startDate,
// endDate - and the Plan B bulk import left all four null on all 114 records.
// portfolio-metrics therefore summed a total of 0, the value tile never
// rendered, and no writer could cite a figure it had no field for. This was
// never an authorship problem: a perfect model cannot quote a number that is
// not in its input.
//
// CAUSE. Two ingestion paths, one behaviour missing.
// app/api/company/projects already ran extractProjectFacts +
// mergeProjectFacts to fill empty columns from the summary text. The bulk
// Plan B import built the very same summary string and never called it.
//
// FIX. The bulk path now calls the same two functions. mergeProjectFacts
// fills ONLY empty fields, so a value from the payload, or one already stored
// on the row, is kept - which is why the import's existing-project query was
// widened to select those columns.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { extractProjectFacts, mergeProjectFacts } from "../lib/engine/project-fact-extractor";
import { computePortfolioMetrics, buildPortfolioMetricsBlock } from "../lib/engine/portfolio-metrics";

const IMPORT = readFileSync("app/api/company/plan-b-import/route.ts", "utf8");

// The flagship record's reference text, reproduced from the owner's export.
const FLAGSHIP = [
  "14 G+6 General Hospital -",
  "Dr Abdul Seid / Gimba",
  "City, South Wollo Zone,",
  "Amhara Region,",
  "Ethiopia",
  "(7,000 m2)",
  "1. Construction",
  "Cost:",
  "550,074,678.02",
  "ETB 2.",
  "Feasibility",
  "Study,",
  "Geotechnical &",
  "New Design",
  "Cost: 1,100,000",
  "ETB 3. Contract",
  "Administration",
  "& Construction",
  "Supervision",
  "Cost: 110,000",
  "ETB/month",
  "2015-2018",
  "E.C.",
].join("\n");

describe("the bulk import derives the facts the reference text already carries", () => {
  it("recovers the contract value, currency and dates from the stored text", () => {
    const facts = extractProjectFacts(FLAGSHIP, "G+6 General Hospital - Dr Abdul Seid");
    assert.equal(facts.contractValue, 550074678.02);
    assert.equal(facts.currency, "ETB");
    assert.equal(facts.country, "Ethiopia");
    assert.ok(facts.startDate instanceof Date);
    assert.ok(facts.endDate instanceof Date);
  });

  it("fills only empty columns — a stored or supplied value is never replaced", () => {
    const extracted = extractProjectFacts(FLAGSHIP, "G+6");
    // A row a person already corrected by hand.
    const corrected = mergeProjectFacts(
      { contractValue: 123, currency: "USD", country: "Kenya", clientName: "Set By Hand" },
      extracted,
    ) as Record<string, unknown>;
    assert.equal(corrected.contractValue, undefined, "an existing value must not be re-derived over");
    assert.equal(corrected.currency, undefined);
    assert.equal(corrected.country, undefined);
    assert.equal(corrected.clientName, undefined);

    // An untouched row gets the derived facts.
    const empty = mergeProjectFacts({}, extracted) as Record<string, unknown>;
    assert.equal(empty.contractValue, 550074678.02);
    assert.equal(empty.country, "Ethiopia");
  });

  it("the bulk import calls the same extractor the single-project route does", () => {
    assert.match(IMPORT, /extractProjectFacts/);
    assert.match(IMPORT, /mergeProjectFacts/);
    // And it must be able to see what the stored row holds, or "fills only
    // empty columns" is not true across a re-import.
    assert.match(IMPORT, /contractValue: true/);
    assert.match(IMPORT, /startDate: true/);
    // Enrichment is additive: a failure must not cost the import the record.
    // Anchor on the CALL, not the first mention — the comment above it names
    // the function too, and a window around the comment proves nothing.
    const at = IMPORT.indexOf("const { extractProjectFacts, mergeProjectFacts } = await import");
    assert.ok(at > -1, "the bulk import must actually call the extractor");
    assert.match(IMPORT.slice(at, at + 700), /catch/);
  });

  it("the value tile says what the number is, not more", () => {
    // contractValue is overwhelmingly the CONSTRUCTION cost of the works the
    // firm designed or supervised, not the firm's fee. Now that the import
    // populates it, an unqualified "Portfolio Value" in the first block an
    // evaluator reads would imply turnover.
    const block = buildPortfolioMetricsBlock(
      computePortfolioMetrics({
        experts: [] as never,
        projects: [
          { contractValue: 550074678.02, currency: "ETB", country: "Ethiopia", sector: "Healthcare" },
          { contractValue: 125000000, currency: "ETB", country: "Ethiopia", sector: "Healthcare" },
        ] as never,
      }),
      "Test Consultancy PLC",
    );
    assert.match(block, /Aggregate Value of Projects Delivered/);
    assert.doesNotMatch(block, /Aggregate Portfolio Value/);
  });
});
