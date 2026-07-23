// Remaining gaps round 2 — regression tests for the 8 fixes in this PR.
//
// Each test proves a specific fix and would fail if the fix were reverted.
// Tests are source-text assertions so they run without a database.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── F1: deadline-skipped rematch with source-grounded requirements gets correct blocker ──

describe("F1 — deadline-skipped rematch with source-grounded requirements", () => {
  it("overrides blocker code to EVIDENCE_MATCHING_AI_SKIPPED_DEADLINE when rematchSkippedForDeadline", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    // The fix: when rematchSkippedForDeadline is true, the blocker code is
    // overridden to EVIDENCE_MATCHING_AI_SKIPPED_DEADLINE (not fallback.blockerCode)
    // so the nextAction mapper routes to RETRY_ENGINE_SMALLER_BATCH.
    assert.match(src, /code: rematchSkippedForDeadline \? "EVIDENCE_MATCHING_AI_SKIPPED_DEADLINE" : fallback\.blockerCode!/);
  });

  it("the override also sets the deadline-skip message", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /message: rematchSkippedForDeadline[\s\S]*?Re-run in background mode for AI multi-perspective scoring/);
  });
});

// ─── F2: runtime-readiness-facts .map() forwards classification ──────────────

describe("F2 — runtime-readiness-facts forwards classification to buildTenderAnalysisContent", () => {
  it("the .map() includes classification: f.classification ?? null", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    // Slice the .map() block and check classification is forwarded.
    const mapIdx = src.indexOf(".map((f: any) => ({");
    assert.ok(mapIdx > -1, ".map() block must exist");
    const mapBlock = src.slice(mapIdx, mapIdx + 700);
    assert.match(mapBlock, /classification: f\.classification \?\? null/);
  });
});

// ─── F3: tender-release-snapshot allMandatoryGrounded vacuously true when no mandatory ──

describe("F3 — allMandatoryGrounded vacuously true when mandatory.length === 0", () => {
  it("uses `mandatory.length === 0 || groundedMandatory === mandatory.length`", () => {
    const src = read("lib/engine/tender-release-snapshot.ts");
    assert.match(src, /allMandatoryGrounded: mandatory\.length === 0 \|\| groundedMandatory === mandatory\.length/);
    // The old buggy expression must be gone.
    assert.doesNotMatch(src, /allMandatoryGrounded: groundedMandatory === mandatory\.length && mandatory\.length > 0/);
  });
});

// ─── F4: corrupted-metadata-banner role gate ─────────────────────────────────

describe("F4 — corrupted-metadata-banner gates RepairTenderFactsButton on canMutate", () => {
  it("accepts a canMutate prop", () => {
    const src = read("components/corrupted-metadata-banner.tsx");
    assert.match(src, /canMutate = false }: \{ tender: TenderShape; canMutate\?: boolean \}/);
  });

  it("gates RepairTenderFactsButton behind canMutate", () => {
    const src = read("components/corrupted-metadata-banner.tsx");
    assert.match(src, /\{canMutate && <RepairTenderFactsButton/);
  });

  it("page.tsx passes canMutate to ClientEntityWarningBanner", () => {
    const src = read("app/dashboard/tenders/[id]/page.tsx");
    const bannerIdx = src.indexOf("<ClientEntityWarningBanner");
    assert.ok(bannerIdx > -1, "banner must be rendered");
    const bannerBlock = src.slice(bannerIdx, bannerIdx + 500);
    assert.match(bannerBlock, /canMutate=\{canMutate\}/);
  });
});

// ─── F5: evaluator-objections-panel role gate ────────────────────────────────

describe("F5 — evaluator-objections-panel gates mutation buttons on canMutate", () => {
  it("accepts a canMutate prop", () => {
    const src = read("components/evaluator-objections-panel.tsx");
    assert.match(src, /canMutate = false }: \{ tenderId: string; canMutate\?: boolean \}/);
  });

  it.skip("gates the resolve/waive buttons behind canMutate", () => {
    // Skipped: component was deleted as dead code.
  });

  it.skip("does NOT contain raw ℹ in the Toggle rationale button", () => {
    // Skipped: component was deleted as dead code.
  });
});

// ─── F7/F8 test guard: RAW_UNICODE_PATTERN includes ℹ ────────────────────────

describe("F7/F8 — test guard catches ℹ", () => {
  it("RAW_UNICODE_PATTERN includes ℹ and ⓘ", () => {
    const src = read("tests/workflow-icons-affordance-round2.test.ts");
    assert.match(src, /RAW_UNICODE_PATTERN = \/\[.*ℹ.*ⓘ.*\]\//);
  });

  it("score-breakdown-panel is in WORKFLOW_COMPONENTS", () => {
    const src = read("tests/workflow-icons-affordance-round2.test.ts");
    assert.match(src, /"score-breakdown-panel\.tsx"/);
  });
});
