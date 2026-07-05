// Grounding consistency — the Metadata Truth panel and the Client & Submission
// panel/gates must apply the SAME grounding rule. Previously each resolver had
// its own threshold (canonical: page>0 & quote>5; metadata-truth: page finite &
// quote>0), so the same field could read "grounded" in one panel and
// "review evidence" in the other. Both now call lib/engine/evidence-grounding.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { isGroundedEvidence, MIN_GROUNDING_QUOTE_LENGTH } from "../lib/engine/evidence-grounding";

describe("evidence-grounding — shared predicate", () => {
  it("requires a real page (> 0)", () => {
    assert.equal(isGroundedEvidence(0, "A valid supporting quote"), false);
    assert.equal(isGroundedEvidence(-1, "A valid supporting quote"), false);
    assert.equal(isGroundedEvidence(null, "A valid supporting quote"), false);
    assert.equal(isGroundedEvidence(2, "A valid supporting quote"), true);
  });

  it("requires a non-trivial quote (>= 10 non-space chars — matches gates' MIN_MEANINGFUL_QUOTE_CHARS)", () => {
    assert.equal(isGroundedEvidence(2, "ABC"), false, "3-char quote is not evidence");
    assert.equal(isGroundedEvidence(2, "123456789"), false, "9-char quote is below the 10-char threshold, not grounded");
    assert.equal(isGroundedEvidence(2, "1234567890"), true, "10-char quote meets the threshold (>=)");
    assert.equal(isGroundedEvidence(2, "A meaningful quote"), true);
    assert.equal(isGroundedEvidence(2, "     "), false, "whitespace-only quote is not evidence");
    assert.equal(isGroundedEvidence(2, null), false);
  });

  it("exposes the threshold constant used by both resolvers", () => {
    assert.equal(MIN_GROUNDING_QUOTE_LENGTH, 10, "threshold raised 5→10 to match gates' MIN_MEANINGFUL_QUOTE_CHARS");
  });
});

describe("evidence-grounding — both resolvers import the shared predicate", () => {
  it("canonical-field-state and metadata-truth both use evidence-grounding", () => {
    const canonical = readFileSync("lib/engine/canonical-field-state.ts", "utf8");
    const truth = readFileSync("lib/engine/analysis/metadata-truth.ts", "utf8");
    assert.ok(canonical.includes('from "./evidence-grounding"'), "canonical resolver must import the shared predicate");
    assert.ok(truth.includes('from "../evidence-grounding"'), "metadata-truth must import the shared predicate");
    // Neither may re-declare a divergent inline threshold.
    assert.ok(!/quote.*trim\(\).length\s*>\s*0/.test(truth), "metadata-truth must not use a quote>0 grounding threshold");
  });
});
