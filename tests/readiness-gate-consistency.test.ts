import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveTenderLevelExportHardBlockers } from "../lib/engine/export-readiness";
import { isReadyForGenerationFromMatchingQuality, type MatchingQualityReport } from "../lib/matching-quality";

describe("readiness gate consistency", () => {
  it("export cannot pass with zero active documents", () => {
    const blockers = deriveTenderLevelExportHardBlockers({
      activeDocuments: 0,
      tenderStatus: "ANALYZED",
      tenderStage: "ANALYSIS",
      readinessScore: 0,
    });
    assert.ok(blockers.some((b) => b.title === "NO_ACTIVE_GENERATED_DOCUMENTS"));
  });

  it("VAULT_AWAITS_ENGINE is never ready for generation", () => {
    const report = {
      state: "VAULT_AWAITS_ENGINE",
      severity: "WARNING",
      score: 65,
      expertRequirementExists: true,
      projectRequirementExists: true,
      expertMatches: 0,
      projectMatches: 0,
      reviewedExpertMatches: 0,
      reviewedProjectMatches: 0,
      selectedExperts: 0,
      selectedProjects: 0,
      reviewedSelectedExperts: 0,
      reviewedSelectedProjects: 0,
      highConfidenceExpertMatches: 0,
      highConfidenceProjectMatches: 0,
      vaultReviewedExperts: 28,
      vaultReviewedProjects: 112,
      warnings: [],
      recommendations: [],
    } satisfies MatchingQualityReport;
    assert.equal(isReadyForGenerationFromMatchingQuality(report), false);
  });
});
