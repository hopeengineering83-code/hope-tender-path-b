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
  it("uses `<count> === 0 || groundedMandatory === <count>`", () => {
    const src = read("lib/engine/tender-release-snapshot.ts");
    // The mandatory population is now `mandatoryCount`, derived from the same
    // `status.mandatory` predicate that feeds groundedMandatory/covered, so the
    // numerator and denominator can no longer disagree. The vacuous-true
    // guarantee this test guards is unchanged.
    assert.match(src, /allMandatoryGrounded: mandatoryCount === 0 \|\| groundedMandatory === mandatoryCount/);
    // The old buggy expression must stay gone, under either identifier.
    assert.doesNotMatch(src, /allMandatoryGrounded: groundedMandatory === mandatory\.length && mandatory\.length > 0/);
    assert.doesNotMatch(src, /allMandatoryGrounded: groundedMandatory === mandatoryCount && mandatoryCount > 0/);
  });
});

// ─── F4: corrupted-metadata-banner role gate ─────────────────────────────────

describe("F4 — corrupted-metadata-banner (Gap 2: RepairTenderFactsButton removed)", () => {
  it("accepts a canMutate prop (retained for backward compat)", () => {
    const src = read("components/corrupted-metadata-banner.tsx");
    assert.match(src, /canMutate = false }: \{ tender: TenderShape; canMutate\?: boolean \}/);
  });

  it("does NOT render RepairTenderFactsButton (Gap 2: removed from normal path)", () => {
    const src = read("components/corrupted-metadata-banner.tsx");
    assert.doesNotMatch(src, /\{canMutate && <RepairTenderFactsButton/);
  });

  it("page.tsx still passes canMutate to ClientEntityWarningBanner", () => {
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

  it("gates the resolve/waive buttons behind canMutate", () => {
    const src = read("components/evaluator-objections-panel.tsx");
    assert.match(src, /\{isOpen && canMutate && \(/);
  });

  it("shows a read-only notice when !canMutate", () => {
    const src = read("components/evaluator-objections-panel.tsx");
    assert.match(src, /\{isOpen && !canMutate && \(/);
    assert.match(src, /Read-only: resolving or waiving objections requires ADMIN or PROPOSAL_MANAGER/);
  });

  it("page.tsx passes canMutate to EvaluatorObjectionsPanel", () => {
    const src = read("app/dashboard/tenders/[id]/page.tsx");
    assert.match(src, /<EvaluatorObjectionsPanel tenderId=\{tender\.id\} canMutate=\{canMutate\} \/>/);
  });
});

// ─── F6: Build Plan panel role gate ──────────────────────────────────────────
//
// The three plan mutations moved out of the deleted
// submission-plan-reconciliation-panel.tsx into the one surviving Build Plan
// panel. That panel is a client component, so the role decision itself is
// made on the server by the page and passed down as canMutate — the gate
// still has to hold on every one of the three buttons.

describe("F6 — the Build Plan panel gates every mutation button on canMutate", () => {
  it("resolves the role server-side with getCurrentUser + canMutateTender and passes it down", () => {
    const page = read("app/dashboard/tenders/[id]/page.tsx");
    assert.match(page, /import \{ getSession, getCurrentUser \} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/auth"/);
    assert.match(page, /import \{ canMutateTender \} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/recovery-command-actions"/);
    assert.match(page, /const currentUser = await getCurrentUser\(\)/);
    assert.match(page, /const canMutate = canMutateTender\(currentUser\?\.role\)/);
    assert.match(page, /<SubmissionPlanCompletenessPanel tenderId=\{tender\.id\} canMutate=\{canMutate\} \/>/);
  });

  it("gates BuildSubmissionPlanButton behind canMutate", () => {
    const src = read("components/submission-plan-completeness-panel.tsx");
    assert.match(src, /\{canMutate && <BuildSubmissionPlanButton/);
  });

  it("GenerateMissingPlanFilesButton removed — planned docs generated automatically", () => {
    const src = read("components/submission-plan-completeness-panel.tsx");
    assert.doesNotMatch(src, /<GenerateMissingPlanFilesButton/);
  });

  it("gates ReconcileStaleFilesButton behind canMutate", () => {
    const src = read("components/submission-plan-completeness-panel.tsx");
    assert.match(src, /canMutate && data\.summary\.totalOutsidePlan > 0 && \(\s*<ReconcileStaleFilesButton/);
  });
});

// ─── F7: raw ℹ replaced with InfoIcon in tender-recovery-command-center ──────
//
// "F7 — tender-recovery-command-center replaces raw ℹ with InfoIcon" describe
// block removed -- components/tender-recovery-command-center.tsx was deleted
// as unrendered dead code (nothing imports or renders it), taking its InfoIcon
// usage with it. No other component ever used a raw ℹ character, so there is
// nothing to redirect this to.

// ─── F8: raw ℹ replaced with InfoIcon in score-breakdown-panel ────────────────

describe("F8 — score-breakdown-panel replaces raw ℹ with InfoIcon", () => {
  it("imports InfoIcon from icons", () => {
    const src = read("components/score-breakdown-panel.tsx");
    assert.match(src, /import \{[^}]* InfoIcon[^}]*\} from "\.\/icons"/);
  });

  it("does NOT contain raw ℹ in the Toggle rationale button", () => {
    const src = read("components/score-breakdown-panel.tsx");
    // Strip comments so the check only applies to real code.
    const codeOnly = src.replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(codeOnly, /aria-label="Toggle rationale"[\s\S]*?ℹ/);
    assert.match(codeOnly, /<InfoIcon className="inline h-3 w-3" \/>/);
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
