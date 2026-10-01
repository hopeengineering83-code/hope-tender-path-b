// Regression test for a real CI failure on PR #1192's merged head
// (run 29655851881): e2e/workflow-control-center-action-buttons.spec.ts
// asserts every Workflow Control Center scroll target is attached, and
// #requirement-coverage failed with "element(s) not found" — the
// RequirementCoveragePanel only rendered its id on the happy-path branch.
// Its loading, error, and totalMandatory===0 early returns rendered
// anchor-less divs, so in any of those states (CI's seeded tender hits
// one of them) the "Review Requirements" button had no scroll target and
// silently did nothing — the exact bug class the button fix was meant to
// close.
//
// This locks in that every return branch of the panel carries the anchor.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const src = readFileSync("components/requirement-coverage-panel.tsx", "utf8");

describe("RequirementCoveragePanel — #requirement-coverage anchor attaches in every render state", () => {
  it("the loading branch carries the anchor id", () => {
    const branch = src.slice(src.indexOf("if (loading)"), src.indexOf("if (error || !data)"));
    assert.match(branch, /id="requirement-coverage"/);
  });

  it("the error branch carries the anchor id", () => {
    const branch = src.slice(src.indexOf("if (error || !data)"), src.indexOf("if (data.totalMandatory === 0)"));
    assert.match(branch, /id="requirement-coverage"/);
  });

  it("the zero-mandatory-requirements branch carries the anchor id", () => {
    const start = src.indexOf("if (data.totalMandatory === 0)");
    const branch = src.slice(start, start + 500);
    assert.match(branch, /id="requirement-coverage"/);
  });

  it("the main branch still carries the anchor id", () => {
    const afterEmpty = src.slice(src.indexOf("const coveragePct"));
    assert.match(afterEmpty, /id="requirement-coverage"/);
  });
});
