import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildReleaseSnapshotEligibility } from "../lib/engine/release-snapshot-eligibility";

describe("release snapshot eligibility", () => {
  it("keeps source-verification/human-review blocker out of draft generation but inside final output gates", () => {
    const result = buildReleaseSnapshotEligibility({
      extractionBlocker: null,
      analysisBlocker: null,
      metadataGenerationBlocker: null,
      metadataFinalBlocker: null,
      requirementsBlocker: null,
      buildPlanGateBlocker: null,
      vaultBlocker: "Final approval requires durable human review.",
      mandatoryRequirementCount: 1,
      evidenceCoveragePercent: 100,
      allMandatoryGrounded: true,
    });

    assert.equal(result.generationEligible, true);
    assert.equal(result.exportEligible, false);
    assert.equal(result.finalZipEligible, false);
    assert.deepEqual(result.generationBlockers, []);
    assert.ok(result.exportBlockers.includes("Final approval requires durable human review."));
    assert.ok(result.finalZipBlockers.includes("Final approval requires durable human review."));
  });

  it("blocks generation on extraction, analysis, required metadata, requirements, and Build Plan gates", () => {
    const result = buildReleaseSnapshotEligibility({
      extractionBlocker: "Extraction failed",
      analysisBlocker: "AI analysis incomplete",
      metadataGenerationBlocker: "Deadline missing",
      metadataFinalBlocker: null,
      requirementsBlocker: "Mandatory requirement ungrounded",
      buildPlanGateBlocker: "Build Plan not confirmed",
      vaultBlocker: null,
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
      extractionBlocker: null,
      analysisBlocker: null,
      metadataGenerationBlocker: null,
      metadataFinalBlocker: null,
      requirementsBlocker: null,
      buildPlanGateBlocker: null,
      vaultBlocker: null,
      mandatoryRequirementCount: 2,
      evidenceCoveragePercent: 25,
      allMandatoryGrounded: true,
    });

    assert.equal(result.generationEligible, true);
    assert.equal(result.exportEligible, false);
    assert.ok(result.exportBlockers.some((blocker) => blocker.includes("Evidence coverage is 25%")));
  });

  it("does not invent evidence blockers when a tender has no mandatory requirements", () => {
    const result = buildReleaseSnapshotEligibility({
      extractionBlocker: null,
      analysisBlocker: null,
      metadataGenerationBlocker: null,
      metadataFinalBlocker: null,
      requirementsBlocker: null,
      buildPlanGateBlocker: null,
      vaultBlocker: null,
      mandatoryRequirementCount: 0,
      evidenceCoveragePercent: 0,
      allMandatoryGrounded: true,
    });

    assert.equal(result.generationEligible, true);
    assert.equal(result.exportEligible, true);
    assert.equal(result.finalZipEligible, true);
    assert.deepEqual(result.exportBlockers, []);
  });
});

describe("release snapshot durable Vault trust consumption", () => {
  const source = readFileSync("lib/engine/tender-release-snapshot.ts", "utf8");

  it("loads the same complete provenance fields used by producers", () => {
    assert.match(source, /VAULT_REVIEW_CONSUMER_SELECT\.EXPERT/);
    assert.match(source, /VAULT_REVIEW_CONSUMER_SELECT\.PROJECT/);
    assert.match(source, /isDurablyReviewed/);
    assert.match(source, /isDurablySourceVerified/);
  });

  it("uses durable human or source verification for matching and drafts", () => {
    assert.match(source, /generationEligibleExperts = selectedExperts\.filter/);
    assert.match(source, /isDurablyReviewed\(expert\) \|\| isDurablySourceVerified\(expert\)/);
    assert.match(source, /generationEligibleProjects = selectedProjects\.filter/);
    assert.match(source, /matchingVaultBlockers/);
    assert.match(source, /source-verified or human-reviewed evidence/);
  });

  it("requires durable human review for final approval and export", () => {
    assert.match(source, /reviewedExperts = selectedExperts\.filter\(isDurablyReviewed\)/);
    assert.match(source, /reviewedProjects = selectedProjects\.filter\(isDurablyReviewed\)/);
    assert.match(source, /finalApprovalVaultBlockers/);
    assert.match(source, /Final approval requires at least one selected expert with current durable human review/);
    assert.match(source, /vaultBlocker:\s*finalApprovalVaultBlocker/);
    assert.doesNotMatch(source, /filter\(\(expert\) => expert\.trustLevel === "REVIEWED"\)/);
    assert.doesNotMatch(source, /filter\(\(project\) => project\.trustLevel === "REVIEWED"\)/);
  });
});
