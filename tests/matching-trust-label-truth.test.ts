// The match rationale must not say a person reviewed something they did not.
//
// checkMatchingEligibility deliberately treats a durably machine
// SOURCE_VERIFIED record as equally eligible with a human REVIEWED one — its
// own comment says so, and that policy is fine. What was not fine is what the
// user then read: trustLevelLabel was written
//
//     function trustLevelLabel(trustLevel) {
//       if (true) return "✓ Reviewed";
//       if (trustLevel === "AI_DRAFT") return "⚠ AI draft — ...";
//       return "⚠ Regex draft — review required";
//     }
//
// so every eligible record was described as "Reviewed", including records that
// isDurablySourceVerified requires to have reviewedBy and reviewedAt NULL.
// The app was stating a human judgement that provably never happened, in the
// text a bid manager reads when deciding who to put forward.
//
// Two knock-on effects, both of which this file also pins:
//
//   - the two `.sort()` calls rank by rationale.includes("✓ Reviewed"). With
//     every record carrying that label the comparison was a constant and the
//     sort silently degraded to score-only.
//   - trustLevelAdjustment had the same `if (true)` shape, so its two draft
//     branches were unreachable. The flat value is correct — scoring only
//     reaches eligible records — but the dead branches read as though drafts
//     were still being penalised.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SRC = readFileSync("lib/engine/matching.ts", "utf8");

describe("no unreachable branch pretends to be a decision", () => {
  it("matching.ts contains no `if (true)` short-circuit", () => {
    const codeOnly = SRC.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(codeOnly, /if\s*\(\s*true\s*\)/, "an `if (true)` makes every branch below it a lie");
  });

  it("the trust adjustment is a named constant, not a fake branch", () => {
    assert.match(SRC, /const ELIGIBLE_TRUST_ADJUSTMENT = 0\.18;/);
    assert.doesNotMatch(SRC, /function trustLevelAdjustment/);
  });
});

describe("the label states what is actually true of the record", () => {
  it("only a durably human-reviewed record is called Reviewed", () => {
    const fn = SRC.slice(SRC.indexOf("function trustProvenanceLabel"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    assert.match(body, /case "REVIEWED": return HUMAN_REVIEWED_LABEL;/);
  });

  it("a machine-verified record says so, and says it was not human-reviewed", () => {
    const fn = SRC.slice(SRC.indexOf("function trustProvenanceLabel"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    assert.match(body, /case "SOURCE_VERIFIED": return "✓ Source-verified[^"]*not human-reviewed\)";/);
    // The distinction is only meaningful if it cannot be read as "Reviewed".
    assert.doesNotMatch(
      /return "(✓ Source-verified[^"]*)"/.exec(body)?.[1] ?? "",
      /✓ Reviewed/,
      "the source-verified label must not contain the reviewed label",
    );
  });

  it("derives from effectiveReviewTrustLevel, not the raw trustLevel column", () => {
    // The stored column can say REVIEWED on a record whose provenance no
    // longer backs it; effectiveReviewTrustLevel is what checks that.
    assert.match(SRC, /switch \(effectiveReviewTrustLevel\(record\)\)/);
    assert.doesNotMatch(SRC, /trustLevelLabel\(trustLevel\)/);
  });

  it("labels the same record object the eligibility gate judged", () => {
    // Labelling a different shape than the gate read is how the two drift.
    assert.match(SRC, /const matchingEligibility = checkMatchingEligibility\(eligibilityRecord\);/);
    assert.match(SRC, /trustProvenanceLabel\(eligibilityRecord as never\)/);
  });
});

describe("the reviewed-first sort is a real comparison again", () => {
  it("both sorts rank through one helper bound to the label constant", () => {
    assert.match(SRC, /function humanReviewedRank\(rationale: string\): number \{/);
    assert.match(SRC, /return rationale\.includes\(HUMAN_REVIEWED_LABEL\)/);
    const uses = SRC.match(/humanReviewedRank\((?:a|b)\.rationale\)/g) ?? [];
    assert.equal(uses.length, 4, "two sorts, two keys each, all going through the helper");
  });

  it("no sort compares against a hand-written copy of the label", () => {
    const codeOnly = SRC.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const literals = codeOnly.match(/rationale\.includes\("[^"]*"\)/g) ?? [];
    assert.deepEqual(literals, [], "a duplicated literal is what let the sort silently break");
  });
});

describe("the two labels actually behave differently at runtime", () => {
  // Guards the claim above with real calls rather than source text: build a
  // record that is durably SOURCE_VERIFIED and check the resolver does not
  // call it reviewed.
  it("a source-verified record does not resolve to REVIEWED", async () => {
    const { effectiveReviewTrustLevel } = await import("../lib/vault-review-provenance");

    const fields = [
      { field: "fullName", value: "Test Engineer" },
      { field: "title", value: "Lead" },
      { field: "yearsExperience", value: 12 },
    ];
    const canonical = JSON.stringify(fields.map((f) => [f.field, f.value ?? null]));
    const fieldsHash = createHash("sha256").update(canonical).digest("hex");

    const sourceVerified = {
      id: "e1",
      trustLevel: "SOURCE_VERIFIED",
      reviewedBy: null,
      reviewedAt: null,
      sourceDocumentId: "doc-1",
      reviewNotes: JSON.stringify({ kind: "SOURCE_VERIFICATION", sourceDocumentId: "doc-1", fieldsHash }),
      fullName: "Test Engineer",
      title: "Lead",
      yearsExperience: 12,
    };

    const resolved = effectiveReviewTrustLevel(sourceVerified as never);
    assert.notEqual(resolved, "REVIEWED", "a record with no reviewer must never resolve to REVIEWED");
  });

  it("a record with no provenance at all resolves to neither", async () => {
    const { effectiveReviewTrustLevel } = await import("../lib/vault-review-provenance");
    const draft = {
      id: "e2", trustLevel: "AI_DRAFT", reviewedBy: null, reviewedAt: null,
      sourceDocumentId: null, reviewNotes: null, fullName: "Draft Person",
    };
    const resolved = effectiveReviewTrustLevel(draft as never);
    assert.notEqual(resolved, "REVIEWED");
    assert.notEqual(resolved, "SOURCE_VERIFIED");
  });
});
