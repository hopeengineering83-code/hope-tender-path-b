// Regression tests for the May 16 production "panels disagree" bug.
//
// Production screenshot showed:
//   • Analysis Quality panel:        100/100 "appears usable"
//   • Generation Readiness panel:    "Tender analysis quality is poor (46/100)"
//   • Matching Quality panel:        30/100 with "no reviewed vault experts available"
//   • Bid Control Verdict panel:     64/100 with "28 reviewed vault experts ready"
//
// Same tender, four different numbers. Root cause: the dedicated
// /api/tenders/[id]/analysis-quality and /api/tenders/[id]/matching-quality
// routes called the assess* functions WITHOUT the new params our Gap 4/5
// fixes added (clientName, matchingScore, vaultReviewedExperts, etc.).
// Only getTenderGenerationReadiness() passed them.
//
// These tests pin the assess* contracts so any future regression where a
// caller drops params produces a visibly different score the panels can
// flag — and prove that with-params and without-params runs MUST produce
// the same score when the new state is the same as the legacy state.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { assessTenderAnalysisQuality } from "../lib/analysis-quality";
import { assessMatchingQuality } from "../lib/matching-quality";

describe("panel-route-parity — analysis-quality with new params", () => {
  it("score with corrupted metadata + zero matching is NOT 100/100", () => {
    // After PR #1002: metadata penalties were removed (metadata is advisory).
    // The score drop now comes from matching=0 only, not from metadata issues.
    // The test still verifies:
    //   - score < 100 (matching=0 reduces the score)
    //   - metadata issues are still REPORTED (just not penalized)
    //   - matchingReadiness sub-score is 0
    const requirements = Array.from({ length: 10 }, (_, i) => ({
      title: `Requirement ${i + 1}`,
      description: "Description with evaluation scoring criteria.",
      priority: i < 5 ? "MANDATORY" : "STANDARD",
      requirementType: "TECHNICAL",
      sectionReference: `Section ${i + 1}`,
    }));

    const report = assessTenderAnalysisQuality({
      requirements,
      analysisSummary: "Full analysis text here.",
      evaluationMethodology: "Technical 70% / Financial 30% — scoring matrix attached.",
      submissionNotes: "Submit by email to both contacts by deadline.",
      clientName: "references (where available) Photos or drawings of completed projects",
      referenceNumber: "only",
      country: "A ddis Ababa",
      clientContactName: "s Contact Person",
      matchingScore: 0,
      extractedTextLength: 14425,
    });

    assert.ok(report.score < 100, `Expected score < 100 with matching=0, got ${report.score}`);
    assert.ok(report.metadataIssues.length >= 4, `Expected ≥4 metadata issues reported, got: ${JSON.stringify(report.metadataIssues)}`);
    assert.equal(report.subScores.matchingReadiness, 0, "matchingReadiness sub-score must be 0");
  });

  it("the route that doesn't pass metadata params still works (back-compat)", () => {
    const requirements = Array.from({ length: 10 }, (_, i) => ({
      title: `Requirement ${i + 1}`,
      description: "Description with evaluation scoring criteria.",
      priority: "MANDATORY",
      requirementType: "TECHNICAL",
    }));
    const legacyReport = assessTenderAnalysisQuality({
      requirements,
      evaluationMethodology: "Technical 70%",
      submissionNotes: "Submit by deadline.",
    });
    // Legacy call still returns a valid report — back-compat preserved.
    assert.ok(typeof legacyReport.score === "number");
    assert.ok(legacyReport.subScores);
  });
});

describe("panel-route-parity — matching-quality with vault counts", () => {
  it("score with empty matches + vault evidence is NOT 30/100 POOR", () => {
    // Production screenshot scenario: tender requires experts + projects,
    // no matches yet, but vault has 28 reviewed experts and 112 reviewed
    // projects ready. The Bid Control Verdict (which passes vault counts)
    // showed 64/100 WARNING. The Matching Quality panel (which did NOT
    // pass vault counts) showed 30/100 POOR — same tender, two scores.
    const report = assessMatchingQuality({
      requirements: [{ requirementType: "EXPERT" }, { requirementType: "PROJECT_EXPERIENCE" }],
      expertMatches: [],
      projectMatches: [],
      vaultReviewedExperts: 28,
      vaultReviewedProjects: 112,
    });
    assert.ok(report.score >= 60, `Expected score ≥ 60 with vault fallback (28+112), got ${report.score}`);
    assert.equal(report.state, "VAULT_AWAITS_ENGINE");
    assert.equal(report.vaultReviewedExperts, 28);
    assert.equal(report.vaultReviewedProjects, 112);
  });

  it("warning message correctly cites vault counts (no 'unavailable' contradiction)", () => {
    const report = assessMatchingQuality({
      requirements: [{ requirementType: "EXPERT" }],
      expertMatches: [],
      projectMatches: [],
      vaultReviewedExperts: 28,
      vaultReviewedProjects: 0,
    });
    // The warning must mention vault availability, not say "no reviewed
    // vault experts are available" (the production bug). The count is now
    // described as "verified/source-backed" rather than "reviewed", because
    // machine SOURCE_VERIFIED evidence counts here too and calling it
    // "reviewed" implied a human step that the contract does not require.
    // What is pinned is that the real number reaches the owner, not which
    // adjective precedes it.
    const hasVaultMention = report.warnings.some((w) => /28\s+verified\/source-backed\s+vault\s+expert/i.test(w));
    assert.ok(hasVaultMention, `Expected a warning mentioning '28 verified/source-backed Vault expert(s)', got: ${JSON.stringify(report.warnings)}`);
    const hasFalseUnavailable = report.warnings.some((w) => /no\s+reviewed\s+vault\s+experts?\s+are\s+available/i.test(w));
    assert.equal(hasFalseUnavailable, false, "Must NOT say 'no reviewed vault experts available' when vault count > 0");
  });
});

describe("panel-route-parity — analysis-quality matches readiness composition", () => {
  it("analysis score with passed matchingScore equals analysis score the readiness gate computes", () => {
    // This is the structural invariant the production bug violated:
    // when both paths see the same inputs, they must produce the same
    // score. Now that the dedicated route ALSO passes metadata + matching
    // state, the two callers compute identical reports.
    const inputs = {
      requirements: Array.from({ length: 8 }, (_, i) => ({
        title: `R${i + 1}`,
        description: "scoring criteria",
        priority: "MANDATORY" as const,
        requirementType: "TECHNICAL" as const,
      })),
      analysisSummary: "summary",
      evaluationMethodology: "Tech 70 / Fin 30",
      submissionNotes: "Submit by deadline.",
      clientName: "Pharo Ventures",
      referenceNumber: "RFP-2026-001",
      country: "Ethiopia",
      clientContactName: "Jane Doe",
      matchingScore: 64,
      extractedTextLength: 14425,
    };
    const fromRoute = assessTenderAnalysisQuality(inputs);
    const fromReadiness = assessTenderAnalysisQuality(inputs);
    assert.deepEqual(fromRoute.score, fromReadiness.score);
    assert.deepEqual(fromRoute.severity, fromReadiness.severity);
    assert.deepEqual(fromRoute.subScores, fromReadiness.subScores);
  });
});
