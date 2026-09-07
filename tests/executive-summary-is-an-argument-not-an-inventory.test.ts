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

  // Cover letter: [0, cover). Summary: [cover, cover+summary). Section D: [cover+summary, end).
  assert.match(source, new RegExp(`slice\\(0, COVER_LETTER_DIFFERENTIATORS\\)`));
  assert.match(source, /slice\(\s*COVER_LETTER_DIFFERENTIATORS,\s*COVER_LETTER_DIFFERENTIATORS \+ EXECUTIVE_SUMMARY_DIFFERENTIATORS,\s*\)/);
  assert.match(source, /slice\(\s*COVER_LETTER_DIFFERENTIATORS \+ EXECUTIVE_SUMMARY_DIFFERENTIATORS,\s*\)/);

  // And the Executive Summary must no longer print the whole list.
  assert.doesNotMatch(source, /lines\.push\(\.\.\.params\.differentiators\.map\(/);

  // Simulate the split over a realistic list and assert disjointness.
  const list = Array.from({ length: 9 }, (_, i) => `differentiator-${i}`);
  const inCover = list.slice(0, cover);
  const inSummary = list.slice(cover, cover + summary);
  const inSectionD = list.slice(cover + summary);
  const all = [...inCover, ...inSummary, ...inSectionD];
  assert.equal(new Set(all).size, all.length, "a differentiator appears in two sections");
  assert.deepEqual(all, list, "a differentiator is dropped entirely");
});

test("the Executive Summary does not restate the project the opener just named", async () => {
  const source = readFileSync("lib/engine/generate-elite.ts", "utf8");
  assert.doesNotMatch(source, /as a relevant reviewed project record/);
});
