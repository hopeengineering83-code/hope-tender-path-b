import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { injectWinThemesTable } from "../lib/engine/win-themes-table";

/**
 * The delivered proposal printed the same differentiator block twice within a
 * few pages, verbatim, under two headings:
 *
 *   "Why we are best placed for this assignment:
 *      Hospital and medical-centre records inform the healthcare-specific
 *      delivery approach described in this proposal. …
 *      The proposed disciplines are mapped to the tender's healthcare scope."
 *
 *   "Further strengths we bring to this assignment:
 *      Hospital and medical-centre records inform the healthcare-specific
 *      delivery approach described in this proposal. …
 *      The proposed disciplines are mapped to the tender's healthcare scope."
 *
 * Three consumers already partition the list — Executive Summary slice(0,3),
 * Cover Letter slice(3,5), Section D slice(5) — so Section G's footer taking
 * the first five could only repeat what had just been said, and nothing it
 * could print was unreachable from Section D. It was redundant by
 * construction, not by accident of this vault's data.
 */

const DIFFERENTIATORS = [
  "Structured property assessment methodology covering structural adequacy, spatial feasibility and utility availability, backed by in-house geotechnical capability.",
  "Hospital and medical-centre records inform the healthcare-specific delivery approach described in this proposal.",
  "The proposed disciplines are mapped to the tender's healthcare scope.",
  "World Bank ESF and British Council records inform the proposal's documentation and review controls.",
  "In-house geotechnical laboratory removes a subcontracted dependency from the critical path.",
];

test("Section G does not reprint differentiators the document already carries", () => {
  const result = injectWinThemesTable("# Section G: Win Themes\n\nPlaceholder.\n", {
    primarySector: "Healthcare",
    projects: [],
    differentiators: DIFFERENTIATORS,
  } as unknown as Parameters<typeof injectWinThemesTable>[1]);

  const markdown = typeof result === "string" ? result : result.markdown;

  assert.ok(
    !/Further strengths we bring to this assignment/i.test(markdown),
    "the redundant differentiator footer is back",
  );
  for (const differentiator of DIFFERENTIATORS) {
    const head = differentiator.slice(0, 60);
    assert.ok(
      !markdown.includes(head),
      `Section G reprints a differentiator stated elsewhere: "${head}…"`,
    );
  }
});

test("Section G still delivers its own content", () => {
  const result = injectWinThemesTable("# Section G: Win Themes\n\nPlaceholder.\n", {
    primarySector: "Healthcare",
    projects: [],
    differentiators: DIFFERENTIATORS,
  } as unknown as Parameters<typeof injectWinThemesTable>[1]);
  const markdown = typeof result === "string" ? result : result.markdown;

  // The table is the section. Removing the footer must not empty the section.
  assert.match(markdown, /\|\s*#\s*\|/, "Section G lost its table");
  assert.ok(markdown.split("\n").filter((l) => l.trim().startsWith("|")).length > 3);
});

test("the four consumers still partition the list without overlap", () => {
  // Read the allocation straight from the source so a change to the constants
  // or to any slice is caught here rather than in a delivered PDF.
  const source = readFileSync(join(process.cwd(), "lib/engine/generate-elite.ts"), "utf8");

  const summary = /const summaryDifferentiators = params\.differentiators\.slice\(0, EXECUTIVE_SUMMARY_DIFFERENTIATORS\)/;
  const cover = /\.slice\(EXECUTIVE_SUMMARY_DIFFERENTIATORS, EXECUTIVE_SUMMARY_DIFFERENTIATORS \+ COVER_LETTER_DIFFERENTIATORS\)/;
  const sectionD = /params\.differentiators\.slice\(\s*EXECUTIVE_SUMMARY_DIFFERENTIATORS \+ COVER_LETTER_DIFFERENTIATORS,\s*\)/;

  assert.match(source, summary, "the Executive Summary slice changed");
  assert.match(source, cover, "the Cover Letter slice changed");
  assert.match(source, sectionD, "the Section D slice changed");

  // Section G takes no slice of its own — its footer is gone.
  const winThemes = readFileSync(join(process.cwd(), "lib/engine/win-themes-table.ts"), "utf8");
  const emitted = winThemes
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
  assert.ok(
    !/opts\.differentiators\s*\?\?\s*\[\]\)\.slice\(/.test(emitted),
    "Section G is slicing differentiators again",
  );
});
