import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
  it("allows durable SOURCE_VERIFIED evidence through final output without human approval", () => {
    const result = buildReleaseSnapshotEligibility({
      ...clear,
      finalApprovalVaultBlocker: "Legacy human-only blocker must be ignored.",
      mandatoryRequirementCount: 1,
      evidenceCoveragePercent: 100,
    });

    assert.equal(result.generationEligible, true);
    assert.equal(result.exportEligible, true);
    assert.equal(result.finalZipEligible, true);
    assert.deepEqual(result.generationBlockers, []);
    assert.doesNotMatch(result.exportBlockers.join(" "), /human-only|human review/i);
  });

  it("blocks every downstream tier when no durable source-verified or reviewed evidence is selected", () => {
    const result = buildReleaseSnapshotEligibility({
      ...clear,
      matchingVaultBlocker: "No source-verified or human-reviewed evidence is selected.",
    });
    assert.equal(result.generationEligible, false);
    assert.equal(result.exportEligible, false);
    assert.equal(result.finalZipEligible, false);
    assert.deepEqual(result.generationBlockers, ["No source-verified or human-reviewed evidence is selected."]);
    assert.deepEqual(result.exportBlockers, result.generationBlockers);
    assert.deepEqual(result.finalZipBlockers, result.generationBlockers);
  });

  it("blocks generation on extraction, analysis, metadata, requirements, and Build Plan gates", () => {
    const result = buildReleaseSnapshotEligibility({
      ...clear,
      extractionBlocker: "Extraction failed",
      analysisBlocker: "AI analysis incomplete",
      metadataGenerationBlocker: "Deadline missing",
      requirementsBlocker: "Mandatory requirement ungrounded",
      buildPlanGateBlocker: "Build Plan not confirmed",
      mandatoryRequirementCount: 2,
      evidenceCoveragePercent: 100,
      allMandatoryGrounded: false,
    });

    assert.equal(result.generationEligible, false);
    assert.deepEqual(result.generationBlockers, [
      "Extraction failed",
      "AI analysis incomplete",
      "Deadline missing",
      "Mandatory requirement ungrounded",
      "Build Plan not confirmed",
    ]);
    assert.ok(result.finalZipBlockers.includes("All mandatory requirements must be source-grounded for Final ZIP."));
  });

  it("requires evidence coverage for export", () => {
    const result = buildReleaseSnapshotEligibility({
      ...clear,
      mandatoryRequirementCount: 2,
      evidenceCoveragePercent: 25,
    });
    assert.equal(result.generationEligible, true);
    assert.equal(result.exportEligible, false);
    assert.ok(result.exportBlockers.some((blocker) => blocker.includes("Evidence coverage is 25%")));
  });

  it("does not invent evidence blockers when a tender has no mandatory requirements", () => {
    const result = buildReleaseSnapshotEligibility(clear);
    assert.equal(result.generationEligible, true);
    assert.equal(result.exportEligible, true);
    assert.equal(result.finalZipEligible, true);
    assert.deepEqual(result.exportBlockers, []);
  });
});

describe("release snapshot durable Vault trust consumption", () => {
  const source = readFileSync("lib/engine/tender-release-snapshot.ts", "utf8");

  it("loads complete provenance fields", () => {
    assert.match(source, /VAULT_REVIEW_CONSUMER_SELECT\.EXPERT/);
    assert.match(source, /VAULT_REVIEW_CONSUMER_SELECT\.PROJECT/);
    assert.match(source, /isDurablyReviewed/);
    assert.match(source, /isDurablySourceVerified/);
  });

  it("derives matching eligibility from durable source or review authority", () => {
    assert.match(source, /generationEligibleExperts = selectedExperts\.filter/);
    assert.match(source, /generationEligibleProjects = selectedProjects\.filter/);
    assert.match(source, /matchingVaultBlockers/);
    assert.match(source, /matchingVaultBlocker,/);
  });

  it("keeps legacy final-approval diagnostics separate from tier inheritance", () => {
    assert.match(source, /finalApprovalVaultBlockers/);
    assert.match(source, /finalApprovalVaultBlocker,/);
    const resolver = readFileSync("lib/engine/release-snapshot-eligibility.ts", "utf8");
    assert.doesNotMatch(resolver, /input\.finalApprovalVaultBlocker[,\]]/);
  });
});
