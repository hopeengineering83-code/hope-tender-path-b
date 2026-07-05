import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessMatchingQuality } from "../lib/matching-quality";

describe("readiness gate consistency", () => {
  it("VAULT_AWAITS_ENGINE state is never ready for full proposal generation", () => {
    const report = assessMatchingQuality({
      requirements: [{ requirementType: "EXPERT" }, { requirementType: "PROJECT_EXPERIENCE" }] as Parameters<typeof assessMatchingQuality>[0]["requirements"],
      expertMatches: [],
      projectMatches: [],
      vaultReviewedExperts: 28,
      vaultReviewedProjects: 112,
    });
    assert.equal(report.state, "VAULT_AWAITS_ENGINE");
    assert.equal(report.expertMatches, 0);
    assert.equal(report.projectMatches, 0);
  });

  it("NO_VAULT state is never ready for full proposal generation", () => {
    const report = assessMatchingQuality({
      requirements: [{ requirementType: "EXPERT" }] as Parameters<typeof assessMatchingQuality>[0]["requirements"],
      expertMatches: [],
      projectMatches: [],
      vaultReviewedExperts: 0,
      vaultReviewedProjects: 0,
    });
    assert.equal(report.state, "NO_VAULT");
    assert.ok(report.severity !== "GOOD", `NO_VAULT severity should not be GOOD, got ${report.severity}`);
  });

  it("MATCHES_WEAK blocks full proposal when selected matches have no reviewed evidence", () => {
    const report = assessMatchingQuality({
      requirements: [{ requirementType: "EXPERT" }, { requirementType: "PROJECT_EXPERIENCE" }] as Parameters<typeof assessMatchingQuality>[0]["requirements"],
      expertMatches: [
        { isSelected: true, expert: { trustLevel: "PENDING" } },
        { isSelected: false, expert: { trustLevel: "REVIEWED" } },
        { isSelected: false, expert: { trustLevel: "REVIEWED" } },
        { isSelected: false, expert: { trustLevel: "REVIEWED" } },
      ] as Parameters<typeof assessMatchingQuality>[0]["expertMatches"],
      projectMatches: [
        { isSelected: true, project: { trustLevel: "PENDING" } },
        { isSelected: false, project: { trustLevel: "REVIEWED" } },
        { isSelected: false, project: { trustLevel: "REVIEWED" } },
      ] as Parameters<typeof assessMatchingQuality>[0]["projectMatches"],
      vaultReviewedExperts: 10,
      vaultReviewedProjects: 10,
    });
    // When selected matches exist but none are reviewed, quality cannot be GOOD
    assert.ok(report.reviewedSelectedExperts === 0, "No reviewed selected experts");
    assert.ok(report.reviewedSelectedProjects === 0, "No reviewed selected projects");
    assert.ok(report.severity !== "GOOD", `Severity should not be GOOD when no reviewed selections, got ${report.severity}`);
  });

  it("state is MATCHES_STRONG when all selected are reviewed", () => {
    const report = assessMatchingQuality({
      requirements: [{ requirementType: "EXPERT" }] as Parameters<typeof assessMatchingQuality>[0]["requirements"],
      expertMatches: [
        { isSelected: true, score: 0.95, expert: { trustLevel: "REVIEWED" } },
        { isSelected: true, score: 0.88, expert: { trustLevel: "REVIEWED" } },
      ] as Parameters<typeof assessMatchingQuality>[0]["expertMatches"],
      projectMatches: [],
      vaultReviewedExperts: 15,
      vaultReviewedProjects: 30,
    });
    assert.equal(report.reviewedSelectedExperts, 2);
    assert.ok(report.score >= 50, `Score should be decent when reviewed experts selected, got ${report.score}`);
  });
});
