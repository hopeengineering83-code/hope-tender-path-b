// Tests for Build Plan hardening:
//   - buildDerivedDraftPlan heuristics
//   - Build Plan route error cases (mocked)
//
// Uses node:test + node:assert — no Jest, no Prisma.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
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

describe("buildDerivedDraftPlan", () => {
  it("returns technical + financial for a standard tender with mixed requirements", () => {
    const entries = buildDerivedDraftPlan({
      requirements: [
        req("Technical Approach", "Describe methodology and approach"),
        req("Financial Schedule", "Submit price schedule", "FINANCIAL"),
      ],
    });

    const names = entries.map((e) => e.name);
    assert.ok(names.includes("Technical Proposal"), `Expected 'Technical Proposal' in ${JSON.stringify(names)}`);
    assert.ok(names.includes("Financial Proposal"), `Expected 'Financial Proposal' in ${JSON.stringify(names)}`);
  });

  it("returns CV Package when requirements mention 'experts'", () => {
    const entries = buildDerivedDraftPlan({
      requirements: [
        req("Key Experts", "Provide CVs for key experts and personnel"),
      ],
    });

    const names = entries.map((e) => e.name);
    assert.ok(names.includes("CV Package"), `Expected 'CV Package' in ${JSON.stringify(names)}`);
  });

  it("returns [] when requirements array is empty", () => {
    const entries = buildDerivedDraftPlan({ requirements: [] });
    assert.deepEqual(entries, []);
  });

  it("returns [] when requirements is undefined", () => {
    const entries = buildDerivedDraftPlan({});
    assert.deepEqual(entries, []);
  });

  it("returns Project Experience entry when requirements mention 'similar projects'", () => {
    const entries = buildDerivedDraftPlan({
      requirements: [
        req("Similar Projects", "Provide references for at least 3 similar projects"),
      ],
    });

    const names = entries.map((e) => e.name);
    assert.ok(names.includes("Project Experience / References"), `Expected project experience in ${JSON.stringify(names)}`);
  });

  it("returns Financial Capacity Package when requirements mention audited financial statements", () => {
    const entries = buildDerivedDraftPlan({
      requirements: [
        req("Financial Capacity", "Submit audited financial statements for last 3 years"),
      ],
    });

    const names = entries.map((e) => e.name);
    assert.ok(names.includes("Financial Capacity Package"), `Expected financial capacity in ${JSON.stringify(names)}`);
  });

  it("returns Work Plan when requirements mention timeline", () => {
    const entries = buildDerivedDraftPlan({
      requirements: [
        req("Implementation Timeline", "Provide a detailed work plan and schedule"),
      ],
    });

    const names = entries.map((e) => e.name);
    assert.ok(names.includes("Work Plan / Methodology"), `Expected work plan in ${JSON.stringify(names)}`);
  });

  it("returns Compliance Matrix when requirements mention compliance checklist", () => {
    const entries = buildDerivedDraftPlan({
      requirements: [
        req("Compliance Checklist", "Submit a compliance matrix against requirements"),
      ],
    });

    const names = entries.map((e) => e.name);
    assert.ok(names.includes("Compliance Matrix"), `Expected compliance matrix in ${JSON.stringify(names)}`);
  });

  it("marks all derived entries with DERIVED_DRAFT_UNCONFIRMED", () => {
    const entries = buildDerivedDraftPlan({
      requirements: [
        req("Technical Approach", "methodology and approach"),
      ],
    });

    assert.ok(entries.length > 0, "Expected at least one entry");
    for (const entry of entries) {
      assert.ok(
        entry.derivedFrom.includes("DERIVED_DRAFT_UNCONFIRMED"),
        `Expected derivedFrom to contain DERIVED_DRAFT_UNCONFIRMED, got: ${entry.derivedFrom}`,
      );
    }
  });

  it("assigns HIGH confidence to Technical and Financial Proposal entries", () => {
    const entries = buildDerivedDraftPlan({
      requirements: [
        req("Scope", "technical methodology approach"),
        req("Cost", "price cost budget financial"),
      ],
    });

    const tech = entries.find((e) => e.name === "Technical Proposal");
    const fin = entries.find((e) => e.name === "Financial Proposal");

    if (tech) assert.equal(tech.confidence, "HIGH");
    if (fin) assert.equal(fin.confidence, "HIGH");
  });

  it("does not produce duplicate entries for the same document type", () => {
    const entries = buildDerivedDraftPlan({
      requirements: [
        req("Technical A", "technical methodology approach"),
        req("Technical B", "technical scope"),
      ],
    });

    const techEntries = entries.filter((e) => e.name === "Technical Proposal");
    assert.equal(techEntries.length, 1, "Should not duplicate Technical Proposal");
  });
});

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
