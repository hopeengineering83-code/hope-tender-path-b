// Generation/BuildPlan/Export truth consistency regression tests.
//
// Tests that generation readiness, generation action, submission plan,
// authority review, document validator, and export readiness all agree
// on the canonical generation/export state.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── 1. Generation Readiness checks fullProposalBlockers before "Ready" ────

describe("Generation Readiness — no 'Ready' when blockers exist", () => {
  it("checks fullProposalBlockers before showing Ready", () => {
    const src = read("components/generation-readiness-panel.tsx");
    assert.ok(
      src.includes("hasFullProposalBlockers"),
      "must check if fullProposalBlockers exist before declaring ready",
    );
    assert.ok(
      src.includes("effectivelyReady"),
      "must compute effectivelyReady = fullProposalReady && !hasFullProposalBlockers && !hasNoConfirmedPlan",
    );
    // The real score remains informational; it must not be falsified to make
    // the blocked state look internally consistent.
    assert.ok(
      src.includes("<ScoreGauge score={score}"),
      "must show the actual informational score while canonical blockers control readiness",
    );
    assert.ok(!src.includes("Math.min(score, 45)"), "must not cosmetically rewrite the score");
  });

  it("checks for no confirmed Build Plan before showing Ready", () => {
    const src = read("components/generation-readiness-panel.tsx");
    assert.ok(
      src.includes("hasNoConfirmedPlan"),
      "must check for no confirmed Build Plan before showing Ready",
    );
    assert.ok(
      src.includes("BUILD_PLAN_MISSING"),
      "must detect BUILD_PLAN_MISSING blocker code",
    );
    assert.ok(
      src.includes("BUILD_PLAN_NOT_CONFIRMED"),
      "must detect BUILD_PLAN_NOT_CONFIRMED blocker code",
    );
    assert.ok(
      src.includes("No confirmed Build Plan"),
      "must show 'No confirmed Build Plan' message when plan is missing",
    );
  });

  it("deduplicates warnings that are already blockers", () => {
    const src = read("components/generation-readiness-panel.tsx");
    assert.ok(
      src.includes("blockerMessages"),
      "must build a set of blocker messages for deduplication",
    );
    assert.ok(
      src.includes("dedupedWarnings"),
      "must filter out warnings that duplicate blocker messages",
    );
  });
});

// ─── 2. Export Readiness returns structured blockers ────────────────────────

describe("Export Readiness — structured blockers not generic failure", () => {
  it("export-readiness route returns primaryBlockerReason", () => {
    const src = read("app/api/tenders/[id]/export-readiness/route.ts");
    assert.ok(
      src.includes("primaryBlockerReason"),
      "export-readiness route must return primaryBlockerReason",
    );
  });

  it("export-readiness route returns primaryFixAction", () => {
    const src = read("app/api/tenders/[id]/export-readiness/route.ts");
    assert.ok(
      src.includes("primaryFixAction"),
      "export-readiness route must return primaryFixAction",
    );
  });

  it("export-readiness route returns requiredDocumentsTotal", () => {
    const src = read("app/api/tenders/[id]/export-readiness/route.ts");
    assert.ok(
      src.includes("requiredDocumentsTotal"),
      "export-readiness route must return requiredDocumentsTotal",
    );
  });

  it("export-readiness route returns exportReadyDocumentsTotal", () => {
    const src = read("app/api/tenders/[id]/export-readiness/route.ts");
    assert.ok(
      src.includes("exportReadyDocumentsTotal"),
      "export-readiness route must return exportReadyDocumentsTotal",
    );
  });

  it("export-readiness route returns plannedRequiredDocuments", () => {
    const src = read("app/api/tenders/[id]/export-readiness/route.ts");
    assert.ok(
      src.includes("plannedRequiredDocuments"),
      "export-readiness route must return plannedRequiredDocuments",
    );
  });

  it("primaryBlockerReason priority: no-build-plan > ungenerated > document-blockers > tender-blockers", () => {
    const src = read("app/api/tenders/[id]/export-readiness/route.ts");
    assert.ok(
      src.includes("No confirmed Build Plan"),
      "must surface 'No confirmed Build Plan' as highest priority blocker",
    );
    assert.ok(
      src.includes("planned but not generated"),
      "must surface planned-not-generated as second priority",
    );
    assert.ok(
      src.includes("Run Engine to create and source-verify the Build Plan automatically"),
      "must name Run Engine as the sole normal Build Plan action",
    );
  });
});

// ─── 3. Export Readiness panel displays structured blockers ────────────────

describe("Export Readiness panel — structured blocker display", () => {
  it("displays primaryBlockerReason when export is blocked", () => {
    const src = read("components/export-readiness-panel.tsx");
    assert.ok(
      src.includes("primaryBlockerReason"),
      "panel must display primaryBlockerReason",
    );
    assert.ok(
      src.includes("Primary blocker:"),
      "panel must label the primary blocker",
    );
  });

  it("displays primaryFixAction when export is blocked", () => {
    const src = read("components/export-readiness-panel.tsx");
    assert.ok(
      src.includes("primaryFixAction"),
      "panel must display primaryFixAction",
    );
    assert.ok(
      src.includes("Next action:"),
      "panel must label the fix action",
    );
  });

  it("Repair prohibited assets button removed from export panel", () => {
    assert.doesNotMatch(read("components/export-readiness-panel.tsx"), /Repair prohibited assets/);
  });
});

// ─── 4. No user-facing metadata wording ────────────────────────────────────

describe("No user-facing metadata in generation/export panels", () => {
  it("generation-readiness-panel has no user-facing metadata text", () => {
    const src = read("components/generation-readiness-panel.tsx");
    assert.ok(
      !/>.*[Mm]etadata.*</.test(src) || !/label.*[Mm]etadata/i.test(src),
      "must not show 'metadata' as a user-facing label",
    );
  });

  it("export-readiness-panel has no user-facing metadata text", () => {
    const src = read("components/export-readiness-panel.tsx");
    assert.ok(
      !/>.*[Mm]etadata.*</.test(src) || !/label.*[Mm]etadata/i.test(src),
      "must not show 'metadata' as a user-facing label",
    );
  });
});

// ─── 5. Screenshot regression fixture ──────────────────────────────────────

describe("Screenshot regression — contradictory state", () => {
  it("Generation Readiness would NOT show 'Ready' when no confirmed Build Plan", () => {
    const src = read("components/generation-readiness-panel.tsx");
    // When hasNoConfirmedPlan is true, effectivelyReady must be false
    assert.ok(
      /hasNoConfirmedPlan/.test(src) && /effectivelyReady/.test(src),
      "must compute effectivelyReady=false when hasNoConfirmedPlan=true",
    );
    // The heading must say "blocked" not "Ready"
    assert.ok(
      src.includes("Full proposal generation blocked"),
      "must show 'blocked' heading when not effectively ready",
    );
  });

  it("Export Readiness would show structured blocker, not generic failure", () => {
    const src = read("app/api/tenders/[id]/export-readiness/route.ts");
    assert.ok(
      src.includes("primaryBlockerReason"),
      "must return structured primaryBlockerReason",
    );
    assert.ok(
      src.includes("primaryFixAction"),
      "must return structured primaryFixAction",
    );
  });
});
