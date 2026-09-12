import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { buildReleaseSnapshotEligibility } from "../lib/engine/release-snapshot-eligibility";

const clear = {
  extractionBlocker: null,
  analysisBlocker: null,
  metadataGenerationBlocker: null,
  metadataFinalBlocker: null,
  requirementsBlocker: null,
  buildPlanGateBlocker: null,
  matchingVaultBlocker: null,
  finalApprovalVaultBlocker: null,
  mandatoryRequirementCount: 0,
  evidenceCoveragePercent: 0,
  allMandatoryGrounded: true,
} as const;

describe("release snapshot eligibility", () => {
  it("allows draft generation but blocks final output on final-only Tender Facts", () => {
    const result = buildReleaseSnapshotEligibility({
      ...clear,
      metadataFinalBlocker: "Final Tender Facts lack source or audit authority.",
    });

    assert.equal(result.generationEligible, true);
    assert.equal(result.exportEligible, false);
    assert.equal(result.finalZipEligible, false);
    assert.deepEqual(result.generationBlockers, []);
    assert.match(result.exportBlockers.join(" "), /Tender Facts/);
  });

  it("requires the strict current confirmed Build Plan for every release action", () => {
    const result = buildReleaseSnapshotEligibility({
      ...clear,
      buildPlanGateBlocker: "Build Plan is stale.",
    });

    assert.equal(result.generationEligible, false);
    assert.equal(result.exportEligible, false);
    assert.equal(result.finalZipEligible, false);
    assert.ok(result.generationBlockers.includes("Build Plan is stale."));
  });

  it("does not invent an evidence blocker when there are no mandatory requirements", () => {
    const result = buildReleaseSnapshotEligibility(clear);
    assert.equal(result.generationEligible, true);
    assert.equal(result.exportEligible, true);
    assert.equal(result.finalZipEligible, true);
    assert.deepEqual(result.exportBlockers, []);
  });

  it("blocks export below mandatory evidence threshold and Final ZIP when grounding is incomplete", () => {
    const result = buildReleaseSnapshotEligibility({
      ...clear,
      mandatoryRequirementCount: 2,
      evidenceCoveragePercent: 25,
      allMandatoryGrounded: false,
    });

    assert.equal(result.generationEligible, true);
    assert.equal(result.exportEligible, false);
    assert.equal(result.finalZipEligible, false);
    assert.match(result.exportBlockers.join(" "), /25%/);
    assert.match(result.finalZipBlockers.join(" "), /source-grounded/);
  });

  it("propagates every generation blocker downstream without duplicates", () => {
    const result = buildReleaseSnapshotEligibility({
      ...clear,
      analysisBlocker: "Run AI Analyze.",
      metadataFinalBlocker: "Run AI Analyze.",
    });
    assert.deepEqual(result.generationBlockers, ["Run AI Analyze."]);
    assert.deepEqual(result.exportBlockers, ["Run AI Analyze."]);
    assert.deepEqual(result.finalZipBlockers, ["Run AI Analyze."]);
  });
});

describe("release snapshot wiring", () => {
  const source = readFileSync("lib/engine/tender-release-snapshot.ts", "utf8");

  it("never hard-codes final Tender Facts as valid", () => {
    assert.doesNotMatch(source, /const metadataGateValid = true/);
    assert.match(source, /validateCriticalMetadataEvidenceForBuildPlan/);
    assert.match(source, /"final"/);
  });

  it("uses the pure eligibility resolver and strict Build Plan gate", () => {
    assert.match(source, /buildReleaseSnapshotEligibility\(\{/);
    assert.match(source, /buildPlan\.gateValid/);
    assert.match(source, /metadata\.gateValid/);
    assert.doesNotMatch(source, /\.\.\.generationBlockers/);
  });

  it("includes final audit authority, gate state, and purpose-specific Vault authority in the snapshot revision", () => {
    assert.match(source, /confirmationBasis: override\.confirmationBasis/);
    assert.match(source, /authorityClass: override\.authorityClass/);
    assert.match(source, /metadataGateValid: metadata\.gateValid/);
    assert.match(source, /buildPlanGateValid: buildPlan\.gateValid/);
    assert.match(source, /matchingVaultBlocker,/);
    assert.match(source, /finalApprovalVaultBlocker,/);
  });
});
