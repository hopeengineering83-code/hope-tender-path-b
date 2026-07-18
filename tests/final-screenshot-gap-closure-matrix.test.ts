import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const matrixPath = "docs/audits/final-screenshot-gap-closure-matrix.md";
const matrix = readFileSync(matrixPath, "utf8");

describe("final screenshot gap closure matrix", () => {
  it("records the requested branch, target branch, baseline run and baseline artifact", () => {
    assert.match(matrix, /fix\/final-screenshot-root-gap-closure/);
    assert.match(matrix, /release\/consolidated-recovery-20260717/);
    assert.match(matrix, /29429622568/);
    assert.match(matrix, /8350811807/);
  });

  it("enumerates exactly 30 primary screenshot gap groups", () => {
    const rows = matrix.match(/^\| SG-\d{3} \|/gm) ?? [];
    assert.equal(rows.length, 30, "matrix must enumerate all 30 primary gap groups");
    const ids = rows.map((row) => row.match(/SG-\d{3}/)?.[0]);
    assert.deepEqual(ids, Array.from({ length: 30 }, (_, index) => `SG-${String(index + 1).padStart(3, "0")}`));
  });

  it("keeps every gap row evidence-backed instead of marking unproven work complete", () => {
    const rows = matrix.split("\n").filter((line) => /^\| SG-\d{3} \|/.test(line));
    for (const row of rows) {
      assert.doesNotMatch(row, /\|\s*COMPLETE\s*\|/i, "unverified rows must not be marked complete");
      assert.match(row, /\| (NEEDS_LIVE_VERIFICATION|NEEDS_IMPLEMENTATION|SKIPPED_BLOCKER|EXECUTED_PASS|EXECUTED_FAIL|NOT_CONFIGURED) \|/, "row must use an allowed final status");
    }
  });

  it("contains the mandatory WORKING declaration fields", () => {
    for (const field of [
      "WORKING — FINAL SCREENSHOT ROOT-GAP CLOSURE",
      "Starting PR #1175 head:",
      "Starting exact SHA:",
      "New branch:",
      "Target branch:",
      "Baseline screenshot artifact:",
      "Primary remaining gap groups:",
      "Expected files/subsystems:",
      "Schema or migration decision:",
      "Overlap check against open PRs:",
      "No merge/deploy/production-migration confirmation:",
    ]) {
      assert.ok(matrix.includes(field), `matrix must include ${field}`);
    }
  });

  it("explicitly documents the live GitHub/artifact inspection blocker", () => {
    assert.match(matrix, /CONNECT tunnel failed, response 403/);
    assert.match(matrix, /SKIPPED_BLOCKER — GitHub fetch unavailable/);
  });
});
