// Regression tests for quality gap fixes from phase 7.
//
// Phase 7 addresses:
//   lib/ai.ts: the structureCompleteness refinement directive did not mention
//   Section C.2 sub-sections.  When the AI produced fewer than 6 C.2.x
//   sub-sections (which the quality scorer penalises under tableCoverage),
//   the refinement pass had no instruction to repair them — so the scorer
//   could flag the deficit but the auto-repair never fired.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const aiSrc = readFileSync(resolve(process.cwd(), "lib/ai.ts"), "utf8");

describe("ai.ts — structureCompleteness refinement directive includes C.2 sub-sections", () => {
  it("mentions Section C.2 Technical Methodology in the structureCompleteness directive", () => {
    // The directive must reference C.2 so the refinement pass knows to expand it.
    assert.ok(
      aiSrc.includes("C.2 Technical Methodology") || aiSrc.includes("C.2.1"),
      "structureCompleteness directive must mention C.2 Technical Methodology or C.2.1",
    );
  });

  it("requires at least 6 numbered C.2 sub-sections in the directive", () => {
    assert.ok(
      aiSrc.includes("at least 6") || aiSrc.includes("minimum 6"),
      "structureCompleteness directive must require at least 6 C.2 sub-sections",
    );
  });

  it("directive still covers all canonical sections (Cover Letter through Submission Control Sheet)", () => {
    const idx = aiSrc.indexOf("structureCompleteness:");
    assert.ok(idx !== -1, "structureCompleteness directive must exist");
    // Extract the directive value up to the next key
    const slice = aiSrc.slice(idx, idx + 1000);
    for (const keyword of ["Cover Letter", "Executive Summary", "Submission Control Sheet"]) {
      assert.ok(
        slice.includes(keyword),
        `structureCompleteness directive must still mention "${keyword}"`,
      );
    }
  });

  it("directive instructs not to delete existing sections", () => {
    const idx = aiSrc.indexOf("structureCompleteness:");
    const slice = aiSrc.slice(idx, idx + 1000);
    assert.ok(
      slice.includes("Do NOT delete existing"),
      "directive must still say 'Do NOT delete existing sections'",
    );
  });
});
