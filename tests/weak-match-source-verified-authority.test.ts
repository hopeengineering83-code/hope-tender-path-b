import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyWeakMatches,
  isEligibleMatchTrustLevel,
} from "../lib/engine/weak-match-classifier";

describe("weak-match source-verified authority", () => {
  it("accepts honest machine-verified and human-reviewed trust states only", () => {
    assert.equal(isEligibleMatchTrustLevel("SOURCE_VERIFIED"), true);
    assert.equal(isEligibleMatchTrustLevel("REVIEWED"), true);
    assert.equal(isEligibleMatchTrustLevel("DRAFT"), false);
    assert.equal(isEligibleMatchTrustLevel("AI_DRAFT"), false);
    assert.equal(isEligibleMatchTrustLevel("REGEX_DRAFT"), false);
  });

  it("counts a selected strong SOURCE_VERIFIED expert as eligible", () => {
    const report = classifyWeakMatches({
      expertMatches: [{
        id: "expert-1",
        score: 0.91,
        isSelected: true,
        trustLevel: "SOURCE_VERIFIED",
        label: "Source Verified Expert",
      }],
      projectMatches: [],
      expertRequirementsCount: 1,
      projectRequirementsCount: 0,
    });
    assert.equal(report.reviewedSelectedStrongExperts, 1);
    assert.equal(report.needsJVExperts, false);
  });

  it("does not let an unverified high score suppress a genuine capability gap", () => {
    const report = classifyWeakMatches({
      expertMatches: [{
        id: "expert-draft",
        score: 0.99,
        isSelected: false,
        trustLevel: "DRAFT",
        label: "Unsupported Draft Expert",
      }],
      projectMatches: [],
      expertRequirementsCount: 1,
      projectRequirementsCount: 0,
    });
    assert.equal(report.reviewedSelectedStrongExperts, 0);
    assert.equal(report.needsJVExperts, true);
  });

  it("removes manual reviewed-evidence instructions from score-breakdown actions", () => {
    const route = readFileSync("app/api/tenders/[id]/score-breakdown/route.ts", "utf8");
    assert.doesNotMatch(route, /Link a reviewed/);
    assert.doesNotMatch(route, /Select a reviewed/);
    assert.doesNotMatch(route, /attach reviewed source evidence/i);
    assert.match(route, /Automatic rematching will prefer/);
    assert.match(route, /manualEvidenceLinkingRequired:\s*false/);
    assert.match(route, /AUTOMATIC_SOURCE_VERIFIED/);
  });
});
