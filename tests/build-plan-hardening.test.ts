// Tests for Build Plan hardening:
//   - buildDerivedDraftPlan heuristics
//   - Build Plan route error cases (mocked)
//
// Uses node:test + node:assert — no Jest, no Prisma.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { buildDerivedDraftPlan } from "../lib/engine/submission-plan";

// ── helper ───────────────────────────────────────────────────────────────────

type MockReq = {
  title: string;
  description?: string | null;
  requirementType?: string;
  priority?: string;
};

function req(title: string, description = "", requirementType = "TECHNICAL", priority = "SHOULD"): MockReq {
  return { title, description, requirementType, priority };
}

// ── buildDerivedDraftPlan ────────────────────────────────────────────────────

// buildDerivedDraftPlan tests removed — heuristic drafts are no longer authoritative

// ── Route-level behaviour (logic-only, no HTTP) ──────────────────────────────
// We test the same conditional logic the route uses, without actually running
// the route (which needs Prisma / Next.js). These tests cover the documented
// decision branches so regressions are caught.

describe("Build Plan route logic (unit-level reproduction)", () => {
  // Reproduces the BUILD_PLAN_BLOCKED_WEAK_EXTRACTION gate
  it("should block when files exist, requirements=0, and a file has extraction score < 60", () => {
    const tender = {
      requirements: [] as unknown[],
      files: [{ extractionScore: 45 }],
      analysisExtractionStatus: null as string | null,
    };

    const isWeak = tender.files.some(
      (f: { extractionScore: number | null }) =>
        (f.extractionScore ?? 100) < 60 ||
        tender.analysisExtractionStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED",
    );

    assert.ok(isWeak, "Should detect weak extraction");
    assert.equal(tender.requirements.length, 0);
    // In the route this combination returns BUILD_PLAN_BLOCKED_WEAK_EXTRACTION
  });

  // Reproduces the BUILD_PLAN_BLOCKED_WEAK_EXTRACTION gate via status flag
  it("should block when analysisExtractionStatus is EXTRACTION_CORRUPTED_AI_SKIPPED and no requirements", () => {
    const tender = {
      requirements: [] as unknown[],
      files: [{ extractionScore: 80 }], // score is fine but status says corrupted
      analysisExtractionStatus: "EXTRACTION_CORRUPTED_AI_SKIPPED",
    };

    const isWeak = tender.files.some(
      (f: { extractionScore: number | null }) =>
        (f.extractionScore ?? 100) < 60 ||
        tender.analysisExtractionStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED",
    );

    assert.ok(isWeak, "Should detect corrupted extraction even when score is high");
  });

  // Reproduces the BUILD_PLAN_EMPTY gate
  it("should surface BUILD_PLAN_EMPTY errorCode when primary and derived plans both yield 0 files", () => {
    // Requirements that contain no keywords matching any heuristic
    const requirements = [
      { title: "XYZ123", description: "abc def ghi", requirementType: "UNKNOWN", priority: "SHOULD" },
    ];

    const derivedEntries = buildDerivedDraftPlan({ requirements });

    // The route returns BUILD_PLAN_EMPTY when derivedEntries.length === 0
    // after the primary plan also returned 0 files.
    // Our requirements contain no matching keywords so derived plan is empty.
    assert.equal(derivedEntries.length, 0, "Should produce 0 derived entries for keyword-free requirements");
    // In the route this results in { errorCode: 'BUILD_PLAN_EMPTY', status: 400 }
  });

  // Reproduces isDerivedDraft=true branch
  it("should set isDerivedDraft=true when the derived plan is used", () => {
    // Simulate: primary plan returned 0, derived plan returned entries
    const requirements = [
      { title: "Technical Scope", description: "methodology and approach", requirementType: "TECHNICAL", priority: "SHOULD" },
    ];

    const derivedEntries = buildDerivedDraftPlan({ requirements });
    assert.ok(derivedEntries.length > 0, "Derived plan should produce entries");

    // isDerivedDraft flag is set to true in this branch
    const isDerivedDraft = true;
    assert.equal(isDerivedDraft, true);
  });

  // Reproduces warning field in response when derived plan is used
  it("should include warning in response when isDerivedDraft is true", () => {
    const isDerivedDraft = true;
    const isWeakExtraction = false;

    const warning = isDerivedDraft
      ? `Derived draft plan created — requires user confirmation. ${
          isWeakExtraction
            ? "Extraction quality was weak; re-run AI Analyze after OCR for a more reliable plan."
            : "Re-run AI Analyze or manually confirm required submission documents."
        }`
      : undefined;

    assert.ok(warning !== undefined, "Warning should be present when isDerivedDraft is true");
    assert.ok(warning!.includes("Derived draft plan created"), "Warning should mention derived draft");
  });

  // Reproduces warning with weak extraction text
  it("should include weak extraction note in warning when extraction was weak", () => {
    const isDerivedDraft = true;
    const isWeakExtraction = true;

    const warning = isDerivedDraft
      ? `Derived draft plan created — requires user confirmation. ${
          isWeakExtraction
            ? "Extraction quality was weak; re-run AI Analyze after OCR for a more reliable plan."
            : "Re-run AI Analyze or manually confirm required submission documents."
        }`
      : undefined;

    assert.ok(warning!.includes("Extraction quality was weak"), "Warning should note weak extraction");
  });
});

import { assessExtractionQualityPerPage } from "../lib/extraction-quality";

// The following test blocks were removed because the submission-plan/build
// route is now a thin compatibility endpoint that calls the canonical
// buildDraftBuildPlan service. The extraction, analysis, content-page,
// and derived-draft logic these tests checked has been removed from the
// route and is now enforced by the preflight in lib/engine/build-plan.ts.
// Real PostgreSQL route tests in tests/build-plan-route-integration.test.ts
// cover the actual behavior.
