// Grounding consistency — the Metadata Truth panel and the Client & Submission
// panel/gates must apply the SAME grounding rule. Previously each resolver had
// its own threshold (canonical: page>0 & quote>5; the old metadata-truth: page finite &
// quote>0), so the same field could read "grounded" in one panel and
// "review evidence" in the other. Both now call lib/engine/evidence-grounding.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { isGroundedEvidence, isGroundedEvidenceInActiveFiles, MIN_GROUNDING_QUOTE_LENGTH } from "../lib/engine/evidence-grounding";

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

describe("evidence-grounding — full active-file check (containment + page bound)", () => {
  const files = [{ id: "f1", extractedText: "Submit bids by email to bids@example.org before noon.", totalPages: 10 }];

  it("grounds only when the normalized quote is contained in the file's extracted text", () => {
    assert.equal(isGroundedEvidenceInActiveFiles(1, "by email to bids@example.org", "f1", files), true);
    assert.equal(isGroundedEvidenceInActiveFiles(1, "a foreign quote never in the file", "f1", files), false, "foreign quotes never ground");
  });

  it("normalizes whitespace/case for containment", () => {
    assert.equal(isGroundedEvidenceInActiveFiles(1, "  BY   EMAIL to bids@example.org ", "f1", files), true);
  });

  it("rejects a source page beyond the file's totalPages", () => {
    assert.equal(isGroundedEvidenceInActiveFiles(11, "by email to bids@example.org", "f1", files), false);
    assert.equal(isGroundedEvidenceInActiveFiles(10, "by email to bids@example.org", "f1", files), true);
  });

  it("rejects an unknown or missing fileId (active-file membership)", () => {
    assert.equal(isGroundedEvidenceInActiveFiles(1, "by email to bids@example.org", "other", files), false);
    assert.equal(isGroundedEvidenceInActiveFiles(1, "by email to bids@example.org", null, files), false);
  });

  it("fails closed when the file has no extracted text (matches the gate)", () => {
    const empty = [{ id: "f1", extractedText: "", totalPages: 10 }];
    assert.equal(isGroundedEvidenceInActiveFiles(1, "by email to bids@example.org", "f1", empty), false);
  });
});

describe("evidence-grounding — ONE metadata resolver, importing the shared predicate", () => {
  it("canonical-field-state uses evidence-grounding and the duplicate resolver is gone", () => {
    const canonical = readFileSync("lib/engine/canonical-field-state.ts", "utf8");
    assert.ok(canonical.includes('from "./evidence-grounding"'), "canonical resolver must import the shared predicate");
    // The Metadata Truth panel's duplicate resolver (analysis/metadata-truth.ts)
    // had ZERO runtime callers — the panel reads the workflow-center snapshot,
    // which uses resolveCanonicalFieldState. A second resolver is a standing
    // drift risk (the original source of the two-thresholds contradiction),
    // so it was deleted. This pin keeps it deleted.
    assert.ok(!existsSync("lib/engine/analysis/metadata-truth.ts"), "the orphaned duplicate metadata resolver must not come back");
  });
});
