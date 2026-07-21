// Recovery Command Center action scoping.
//
// TenderRecoveryCommandCenter computes its own "primaryNextAction" via a
// separate orchestrator (lib/engine/tender-lifecycle-orchestrator.ts), not
// the canonical workflow decision NextActionPanel reads. A real Playwright
// screenshot of a live seeded tender showed both panels rendering a "next
// action" banner simultaneously with DIFFERENT text for the same tender at
// the same moment — a genuine, user-visible contradiction.
//
// Fix: the recovery banner only renders for a lifecycle state that
// represents an actual failure/stall/degradation (RECOVERY_LIFECYCLE_STATES
// in the component), is relabeled away from "PRIMARY NEXT ACTION" /
// "NEXT REQUIRED ACTION", and explicitly says it repairs an inconsistent
// state rather than replacing the canonical next action. For ordinary
// forward-progress states it renders nothing — those actions already have a
// dedicated stage panel elsewhere (AIAnalyzePanel, EngineActionPanel,
// GenerationActionPanel, SubmissionPlanReconciliationPanel, etc.).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const recoverySrc = read("components/tender-recovery-command-center.tsx");

describe("Recovery Command Center — no competing general next-action label", () => {
  it("never renders the literal labels NextActionPanel owns", () => {
    assert.doesNotMatch(recoverySrc, />Primary Next Action</);
    assert.doesNotMatch(recoverySrc, /Primary Next Action/);
    assert.doesNotMatch(recoverySrc, /Next Required Action/i);
  });

  it("labels its action banner as an exceptional recovery operation", () => {
    assert.match(recoverySrc, /Recovery operation available/);
  });

  it("explains it repairs an inconsistent/stalled state and does not replace the canonical next action", () => {
    assert.match(recoverySrc, /repairs an inconsistent or stalled workflow state/);
    assert.match(recoverySrc, /does not replace the tender.{0,10}s canonical next action/);
  });
});

describe("Recovery Command Center — recovery banner is state-gated, not always shown", () => {
  it("defines an explicit RECOVERY_LIFECYCLE_STATES set used to gate the banner", () => {
    assert.match(recoverySrc, /const RECOVERY_LIFECYCLE_STATES: ReadonlySet<LifecycleState> = new Set\(/);
    assert.match(recoverySrc, /const isRecoveryState = RECOVERY_LIFECYCLE_STATES\.has\(data\.lifecycleState\)/);
  });

  it("gates the recovery banner behind isRecoveryState", () => {
    assert.match(recoverySrc, /\{isRecoveryState && \(/);
  });

  it("recovery states cover genuine failure/stall/degradation, not ordinary forward progress", () => {
    for (const state of [
      "AI_ANALYSIS_FAILED",
      "PARTIAL_AI_ANALYSIS_BLOCKED",
      "ANALYSIS_FALLBACK_UNAPPROVED",
      "ANALYSIS_FALLBACK_APPROVED_AUDIT_ONLY",
      "SOURCE_REFERENCES_INCOMPLETE",
      "EVIDENCE_MATCHING_EMPTY",
      "QUALITY_REVIEW_REQUIRED",
    ]) {
      assert.ok(
        recoverySrc.includes(`"${state}"`),
        `RECOVERY_LIFECYCLE_STATES must include ${state}`,
      );
    }
  });

  it("ordinary forward-progress states are NOT in the recovery set (spot check against the set literal only, not the whole file)", () => {
    const setMatch = recoverySrc.match(/const RECOVERY_LIFECYCLE_STATES: ReadonlySet<LifecycleState> = new Set\(\[([\s\S]*?)\]\)/);
    assert.ok(setMatch, "RECOVERY_LIFECYCLE_STATES set literal must be found");
    const setBody = setMatch![1];
    for (const state of [
      "UPLOADED",
      "EXTRACTED",
      "AI_ANALYSIS_REQUIRED",
      "SUBMISSION_PLAN_REQUIRED",
      "EVIDENCE_MATCHING_REQUIRED",
      "DOCUMENT_GENERATION_REQUIRED",
      "AUTO_FINALIZE_REQUIRED",
      "EXPORT_READY",
      "ZIP_READY",
      "CLOSED",
    ]) {
      assert.ok(
        !setBody.includes(`"${state}"`),
        `RECOVERY_LIFECYCLE_STATES must NOT include ordinary forward-progress state ${state}`,
      );
    }
  });
});

describe("Recovery Command Center — authorization and mutation capability preserved", () => {
  it("the recovery banner's Execute button still requires canMutate", () => {
    // Within the isRecoveryState block, the Execute button must be gated by canMutate.
    const bannerStart = recoverySrc.indexOf("Recovery operation available");
    assert.ok(bannerStart > 0, "recovery banner must exist");
    const bannerBlock = recoverySrc.slice(bannerStart, bannerStart + 1200);
    assert.match(bannerBlock, /\{canMutate && \(/);
    assert.match(bannerBlock, /onClick=\{\(\) => void executeAction\(data\.primaryNextAction\)\}/);
  });

  it("per-blocker quick-action mutation buttons (Retry/Resume AI Analyze, Run Engine, Review Matching Inputs, Link Vault Evidence) are unchanged and still canMutate-gated", () => {
    assert.match(recoverySrc, /canMutate && b\.code === "ANALYSIS_REGEX_FALLBACK_UNAPPROVED"/);
    assert.match(recoverySrc, /canMutate && b\.code === "ANALYSIS_PARTIAL_NEEDS_RESUME"/);
    assert.match(recoverySrc, /canMutate && b\.code === "EVIDENCE_NOT_ASSESSED"/);
    assert.match(recoverySrc, /canMutate && b\.code === "ENGINE_RAN_NO_MATCHES"/);
    assert.match(recoverySrc, /canMutate && b\.code === "MANDATORY_EVIDENCE_WEAK"/);
  });

  it("executeAction still calls the real mutation API routes (no mutation capability removed)", () => {
    assert.match(recoverySrc, /async function executeAction\(action: string\)/);
    assert.match(recoverySrc, /fetch\(renderRecoveryActionPath\(spec\.path, tenderId\), fetchOptions\)/);
  });
});

describe("Recovery Command Center — action feedback stays visible regardless of recovery-state gating", () => {
  it("actionMsg/analyzeProgress render in a block independent of isRecoveryState", () => {
    // The feedback strip must be reachable even when isRecoveryState is false,
    // since per-blocker quick actions (e.g. Run Engine from a normal
    // EVIDENCE_MATCHING_REQUIRED state) can set actionMsg outside the
    // recovery banner.
    const feedbackIdx = recoverySrc.indexOf("(analyzeProgress !== null || actionMsg)");
    const recoveryIdx = recoverySrc.indexOf("{isRecoveryState && (");
    assert.ok(feedbackIdx > 0, "feedback block must exist");
    assert.ok(recoveryIdx > 0, "recovery block must exist");
    assert.ok(feedbackIdx < recoveryIdx, "feedback block must be a sibling BEFORE the recovery block, not nested inside it");
  });
});

describe("Recovery Command Center — does not derive the canonical workflow action", () => {
  it("does not import getCanonicalTenderWorkflowDecision or lib/engine/tender-release-state.ts", () => {
    assert.doesNotMatch(recoverySrc, /getCanonicalTenderWorkflowDecision/);
    assert.doesNotMatch(recoverySrc, /tender-release-state/);
  });

  it("lib/engine/tender-release-state.ts does not import the lifecycle orchestrator", () => {
    const releaseStateSrc = read("lib/engine/tender-release-state.ts");
    assert.doesNotMatch(releaseStateSrc, /tender-lifecycle-orchestrator/);
  });
});
