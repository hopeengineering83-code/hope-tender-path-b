import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildExecutiveSummaryOpener } from "../lib/engine/benchmark-tables";

/**
 * The delivered Executive Summary read as an evidence inventory rather than as
 * an argument. Three separate defects produced that impression:
 *
 *   1. "The evidence inventory includes 3 reviewed specialist record(s)."
 *      The count of rows in the bidder's own database, printed to the client.
 *
 *   2. The same project named twice in consecutive paragraphs — once by the
 *      opener as "provides a reference point", then again as "presents ... as a
 *      relevant reviewed project record".
 *
 *   3. Its "Why we are best placed" bullets were the cover letter's own three
 *      bullets, verbatim, one page later. Every differentiator was printed at
 *      least twice.
 *
 * These tests pin the properties rather than the wording, so the summary can be
 * rewritten without silently reintroducing any of them.
 */

const PROJECT = {
  name: "Regional Water Supply Scheme",
  clientName: "Regional Water Bureau",
  country: "Ethiopia",
  sector: "Water and sanitation",
  serviceAreas: null,
  contractValue: null,
  currency: null,
} as Parameters<typeof buildExecutiveSummaryOpener>[0]["projects"][number];

test("the opener never reports how many records the vault holds", () => {
  for (const count of [0, 1, 3, 28]) {
    const opener = buildExecutiveSummaryOpener({
      companyName: "Example Consultancy PLC",
      clientName: "Regional Water Bureau",
      projects: [PROJECT],
      reviewedExpertCount: count,
      topExpertName: "A. Person",
      topExpertTitle: "Water Engineer",
    });
    assert.doesNotMatch(opener, /evidence inventory/i, `count=${count}`);
    assert.doesNotMatch(opener, /\breviewed specialist record\(s\)/i, `count=${count}`);
    assert.doesNotMatch(opener, /\brecord\(s\)/i, `count=${count}`);
  }
});

test("the opener still names the reference project, in any sector", () => {
  const road = { ...PROJECT, name: "Trunk Road Rehabilitation", sector: "Roads" };
  for (const project of [PROJECT, road]) {
    const opener = buildExecutiveSummaryOpener({
      companyName: "Example Consultancy PLC",
      clientName: "Roads Authority",
      projects: [project],
      reviewedExpertCount: 4,
      topExpertName: null,
      topExpertTitle: null,
    });
    assert.ok(opener.includes(project.name), project.name);
  }
});

test("no differentiator is printed in more than one section", async () => {
  // The allocation is what guarantees this, so assert the allocation: the three
  // slices must be disjoint and must together cover the list.
  const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
  assert.match(source, /const COVER_LETTER_DIFFERENTIATORS = (\d+);/);
  assert.match(source, /const EXECUTIVE_SUMMARY_DIFFERENTIATORS = (\d+);/);

  const cover = Number(/const COVER_LETTER_DIFFERENTIATORS = (\d+);/.exec(source)![1]);
  const summary = Number(/const EXECUTIVE_SUMMARY_DIFFERENTIATORS = (\d+);/.exec(source)![1]);

  // Summary: [0, summary). Cover letter: [summary, summary+cover).
  // Section D: [summary+cover, end). The strongest go to the summary — see the
  // dedicated test below for why the order is not the order of appearance.
  assert.match(source, /slice\(0, EXECUTIVE_SUMMARY_DIFFERENTIATORS\)/);
  assert.match(source, /slice\(EXECUTIVE_SUMMARY_DIFFERENTIATORS, EXECUTIVE_SUMMARY_DIFFERENTIATORS \+ COVER_LETTER_DIFFERENTIATORS\)/);
  assert.match(source, /slice\(\s*EXECUTIVE_SUMMARY_DIFFERENTIATORS \+ COVER_LETTER_DIFFERENTIATORS,\s*\)/);

  // And the Executive Summary must no longer print the whole list.
  assert.doesNotMatch(source, /lines\.push\(\.\.\.params\.differentiators\.map\(/);

  // Simulate the split over a realistic list and assert disjointness.
  const list = Array.from({ length: 9 }, (_, i) => `differentiator-${i}`);
  const inSummary = list.slice(0, summary);
  const inCover = list.slice(summary, summary + cover);
  const inSectionD = list.slice(summary + cover);
  const all = [...inSummary, ...inCover, ...inSectionD];
  assert.equal(new Set(all).size, all.length, "a differentiator appears in two sections");
  assert.deepEqual(all, list, "a differentiator is dropped entirely");
});

test("the Executive Summary does not restate the project the opener just named", async () => {
  const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
  assert.doesNotMatch(source, /as a relevant reviewed project record/);
});

/**
 * The delivered "Portfolio at a Glance" opened with
 *
 *   1 Reviewed Project Reference
 *   3 Reviewed Specialists on the Proposed Team
 *
 * under the line "Headline metrics ... computed from reviewed project and
 * expert records". "Reviewed" is this application's internal trust state, not a
 * fact about the firm, and a headline block that announces "1" tells the
 * evaluator the evidence is thin in the first line they read — while the
 * reference itself is set out in full in Section B.
 */
test("the headline block carries no internal review vocabulary", async () => {
  const { buildPortfolioMetricsBlock } = await import("../lib/engine/portfolio-metrics");
  const block = buildPortfolioMetricsBlock(
    {
      reviewedProjectCount: 4,
      reviewedExpertCount: 6,
      totalContractValue: 0,
      currency: "ETB",
      certificationsCount: 0,
      countriesCovered: ["Ethiopia"],
      topSectors: ["Water and sanitation"],
      uniqueDisciplines: ["Water Engineering"],
      hasDonorEvidence: false,
    },
    "Example Consultancy PLC",
  );
  assert.doesNotMatch(block, /\bReviewed\b/);
  assert.doesNotMatch(block, /reviewed project and expert records/i);
  assert.match(block, /\*\*4\*\* Project References/);
  assert.match(block, /\*\*6\*\* Specialists/);
});

test("a count of one is the reference, not a portfolio statistic", async () => {
  const { buildPortfolioMetricsBlock } = await import("../lib/engine/portfolio-metrics");
  const block = buildPortfolioMetricsBlock(
    {
      reviewedProjectCount: 1,
      reviewedExpertCount: 1,
      totalContractValue: 0,
      currency: "ETB",
      certificationsCount: 1,
      countriesCovered: ["Ethiopia"],
      topSectors: ["Roads"],
      uniqueDisciplines: ["Highway Engineering"],
      hasDonorEvidence: false,
    },
    "Example Consultancy PLC",
  );
  // No "1 ..." count tiles; the substantive tiles carry the block.
  assert.doesNotMatch(block, /\*\*1\*\*/);
  assert.match(block, /Highway Engineering/);
  assert.match(block, /Roads/);
});

test("with nothing substantive to show, no empty table is emitted", async () => {
  const { buildPortfolioMetricsBlock } = await import("../lib/engine/portfolio-metrics");
  const block = buildPortfolioMetricsBlock(
    {
      reviewedProjectCount: 1,
      reviewedExpertCount: 1,
      totalContractValue: 0,
      currency: "ETB",
      certificationsCount: 0,
      countriesCovered: [],
      topSectors: [],
      uniqueDisciplines: [],
      hasDonorEvidence: false,
    },
    "Example Consultancy PLC",
  );
  assert.equal(block, "");
});

/**
 * The Executive Summary is the section an evaluator scores; a cover letter is
 * courtesy and is rarely scored at all. Allocating the first three
 * differentiators to the cover letter left the summary arguing from the weaker
 * half: a delivered proposal opened its "Why we are best placed" with
 * property-assessment methodology and geotechnical drilling rigs on a
 * HEALTHCARE tender, while the healthcare-relevant claims sat in the covering
 * note.
 */
test("the Executive Summary gets the strongest differentiators", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
  // Summary takes from index 0; the cover letter takes the slice after it.
  assert.match(source, /slice\(0, EXECUTIVE_SUMMARY_DIFFERENTIATORS\)/);
  assert.match(
    source,
    /slice\(EXECUTIVE_SUMMARY_DIFFERENTIATORS, EXECUTIVE_SUMMARY_DIFFERENTIATORS \+ COVER_LETTER_DIFFERENTIATORS\)/,
  );
  assert.match(
    source,
    /slice\(\s*EXECUTIVE_SUMMARY_DIFFERENTIATORS \+ COVER_LETTER_DIFFERENTIATORS,\s*\)/,
  );
});
