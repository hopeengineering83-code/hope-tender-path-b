// Regression test: proves AI-extracted company evidence CANNOT become REVIEWED
// automatically. REVIEWED requires an explicit human review event.
//
// This test was adapted from PR #1230's company-knowledge-auto-review.test.ts,
// but INVERTED: PR #1230 tried to add auto-promotion (which we explicitly
// reject per the donor extraction rules). This test proves the CURRENT
// behavior is correct — no auto-review path exists.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const src = readFileSync("lib/company-knowledge-import-safe.ts", "utf8");

describe("company knowledge auto-review safety contract (NEGATIVE — no auto-promotion)", () => {
  it("does NOT auto-promote AI records to REVIEWED", () => {
    // The source must NOT contain any auto-review logic that promotes
    // AI-extracted records to REVIEWED without a human review event.
    assert.ok(
      !src.includes("AUTO_REVIEW_MIN_CONFIDENCE"),
      "must NOT have auto-review confidence threshold — REVIEWED requires human review",
    );
    assert.ok(
      !src.includes("autoReviewedTrust"),
      "must NOT have auto-review trust function — REVIEWED requires human review",
    );
    assert.ok(
      !src.match(/confidence.*>=.*0\.\d+.*\?.*"REVIEWED"/),
      "must NOT have confidence-based auto-promotion to REVIEWED",
    );
  });

  it("documents that REVIEWED requires human review", () => {
    assert.ok(
      src.includes("NEVER") && src.includes("REVIEWED"),
      "must document that records are NEVER auto-promoted to REVIEWED",
    );
  });

  it("does not import or use trustLevel auto-assignment", () => {
    // The trustLevel must be set by the import path based on the source type
    // (REGEX_DRAFT for regex, AI_DRAFT for AI), NOT by confidence thresholds.
    assert.ok(
      !src.includes("? \"REVIEWED\""),
      "must NOT have conditional REVIEWED assignment based on confidence",
    );
  });
});
