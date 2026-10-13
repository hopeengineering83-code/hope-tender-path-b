import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { stripInternalReviewSections } from "../lib/engine/internal-review-stripper";

/**
 * Section G ("Why We Are Well Suited", formerly "Win Themes and
 * Discriminators") was a bid-desk construct. Its rows restated the
 * differentiators the cover letter, Executive Summary and Section D already
 * carry, and in run 36074770709 each row printed the same differentiator
 * twice — its opening words as "Capability" and its first sentence as "What
 * This Means for the Client". What it was for — each criterion and the
 * evidence that answers it — is Section F. So no path ships it: no builder
 * emits it, the refinement pass no longer asks for it, and a model-written
 * copy is stripped before render.
 */

const DOC = (heading: string) => [
  "# Section F: Response to Evaluation Criteria",
  "",
  "| Criterion | Where | Evidence |",
  "|---|---|---|",
  "| Team | A.5 | 8 named experts |",
  "",
  heading,
  "",
  "| Capability | What This Means for the Client | Linked Evaluation Criterion | Supporting Evidence |",
  "|---|---|---|---|",
  "| In-house geotechnical | In-house geotechnical capability. | Team | B.2 |",
  "",
  "# Declaration",
  "",
  "We confirm.",
].join("\n");

describe("Section G is not shipped to the client", () => {
  for (const heading of [
    "# Section G: Why We Are Well Suited",
    "## Section G: Win Themes and Discriminators",
    "## SECTION G: WHY WE ARE WELL SUITED",
    "## Win Themes & Discriminators",
    "### G. Why We Are Well Suited",
    "## Why We Are Well Suited",
  ]) {
    it(`strips "${heading}" and only it`, () => {
      const { markdown, removedSections } = stripInternalReviewSections(DOC(heading));
      assert.equal(removedSections.length, 1, removedSections.join(" | "));
      assert.doesNotMatch(markdown, /What This Means for the Client|Why We Are Well Suited|Win Themes/i);
      assert.match(markdown, /# Section F: Response to Evaluation Criteria/);
      assert.match(markdown, /\| Team \| A\.5 \| 8 named experts \|/);
      assert.match(markdown, /# Declaration\n\nWe confirm\./);
    });
  }

  it("keeps a client heading that only begins with 'Why'", () => {
    const md = "## Why Acme Consulting for the Ministry\n\n1. Reason.\n";
    assert.equal(stripInternalReviewSections(md).markdown, md);
  });

  it("no builder, contract or refinement directive asks for it", () => {
    const elite = readFileSync("lib/engine/generate-elite.ts", "utf8");
    assert.doesNotMatch(elite, /injectWinThemesTable\(/);
    assert.match(elite, /const deterministicWinThemes: string \| null = null;/);
    const repair = readFileSync("lib/engine/proposal-quality-repair.ts", "utf8");
    assert.doesNotMatch(repair, /function sectionG\b|repairs\.push\(sectionG/);
    const contract = readFileSync("lib/engine/proposal-sections.ts", "utf8");
    assert.doesNotMatch(contract, /^- Why We Are Well Suited$/m);
    const ai = readFileSync("lib/ai.ts", "utf8");
    assert.doesNotMatch(ai, /winThemesPresence: "Add or complete Section G/);
  });
});
