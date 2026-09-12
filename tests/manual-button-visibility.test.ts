// ─── UI button visibility tests for MANUAL AI Analyze and Run Engine ──────────
//
// These tests statically verify the button visibility conditions documented in
// the owner's workflow requirement:
//
// AI Analyze button is visible when:
//   - extraction is successfully completed;
//   - source integrity is valid;
//   - at least one AI provider is available;
//   - the current user has the required role;
//   - there is no active duplicate AI Analyze job;
//   - (removed) the current revision has not already completed successfully —
//     see the re-run tests below. Both controls are now always rendered for a
//     user entitled to press them; completion changes the label, not their
//     presence.
//
// Run Engine button is visible when:
//   - AI Analyze completed successfully;
//   - the result belongs to the current tender revision;
//   - grounding and promotion requirements passed;
//   - the tender is not blocked by source integrity or authority review;
//   - the current user has the required role;
//   - no duplicate Engine job is queued or running.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  describeAIAnalyzeWorkflowState,
  describeMatchingEngineState,
} from "../lib/engine/workflow-panel-presentation";

const aiPanel = readFileSync("components/ai-analyze-panel.tsx", "utf8");
const matchingPanel = readFileSync("components/matching-selected-evidence-panel.tsx", "utf8");
const engineReadinessRoute = readFileSync("app/api/tenders/[id]/engine-readiness/route.ts", "utf8");

function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("AI Analyze button visibility conditions", () => {
  it("renders a Run AI Analyze button", () => {
    assert.match(aiPanel, /Run AI Analyze/);
    assert.match(aiPanel, /onClick.*runAiAnalyze/);
  });

  it("button is disabled when extraction is not complete", () => {
    // canRunAnalyze requires canonicalAnalysisReady (which includes extraction readiness)
    assert.match(aiPanel, /canRunAnalyze\s*=\s*canMutate/);
    assert.match(aiPanel, /canonicalAnalysisReady/);
  });

  it("button is disabled when no AI provider is available", () => {
    assert.match(aiPanel, /aiEnabled/);
  });

  it("button is disabled when user lacks permission", () => {
    assert.match(aiPanel, /canMutate/);
  });

  it("button is disabled when an active job exists", () => {
    assert.match(aiPanel, /!analyzing/);
  });

  // Replaces an assertion that pinned the opposite rule. A completed analysis
  // used to remove the button from the page entirely, so the owner opening a
  // finished tender saw no AI Analyze control and had no way to re-run after
  // correcting or adding a source. That was reported from the live Preview as
  // the buttons simply being missing.
  it("stays on the page and stays pressable after a completed analysis", () => {
    assert.match(aiPanel, /\{canMutate \? \(/, "the button must not be hidden once analysis completes");
    assert.doesNotMatch(
      aiPanel,
      /canMutate && !analysisComplete/,
      "a finished run is a label, not a reason to remove the owner's control",
    );
    const enablement = aiPanel.match(/const canRunAnalyze = canMutate[\s\S]*?;/)?.[0] ?? "";
    assert.doesNotMatch(enablement, /!analysisComplete/, "re-running a completed analysis is the owner's call");
    assert.match(enablement, /!analyzing/, "two concurrent analyses must still be impossible");
    assert.match(aiPanel, /Re-run AI Analyze/, "the completed state must say what pressing it will do");
  });

  it("button uses aria-disabled and aria-busy correctly", () => {
    assert.match(aiPanel, /aria-disabled=\{!canRunAnalyze\}/);
    assert.match(aiPanel, /aria-busy=\{submitting \|\| analyzing/);
  });

  it("shows a disabled reason when the button is not actionable", () => {
    assert.match(aiPanel, /disabledReason/);
    assert.match(aiPanel, /role="note"/);
  });

  it("does not start AI Analyze automatically on page render", () => {
    // The runAiAnalyze function is only called via onClick, never via useEffect.
    const src = codeOnly(aiPanel);
    // No useEffect that calls runAiAnalyze.
    const useEffectMatches = src.match(/useEffect\(/g) ?? [];
    assert.ok(useEffectMatches.length > 0, "should have at least one useEffect (for job polling)");
    // The useEffect must only watch an existing job, not start a new one.
    // The panel uses jobId state (initialized from initialContinueJobId), and
    // the useEffect returns early if jobId is null.
    assert.match(src, /useEffect\(\(\) => \{[\s\S]*?if \(!jobId\) return/);
  });
});

describe("Run Engine button visibility conditions", () => {
  it("renders a Run Engine button", () => {
    assert.match(matchingPanel, /Run Engine/);
    assert.match(matchingPanel, /onClick.*runEngine/);
  });

  it("button is disabled when AI Analyze has not completed", () => {
    // canRunEngine is derived from the canonical engine-readiness endpoint,
    // which checks analysisCurrent and source revision.
    assert.match(matchingPanel, /canRunEngine\s*=\s*canMutate/);
    assert.match(matchingPanel, /readiness\?\.canRunEngine === true/);
  });

  it("button is disabled when user lacks permission", () => {
    assert.match(matchingPanel, /canMutate/);
  });

  it("button is disabled when an Engine job is running", () => {
    // The canonical readiness endpoint returns engineRunning, which is checked in canRunEngine.
    assert.match(matchingPanel, /engineRunning/);
  });

  // Same correction on the Engine side, and the more consequential one: adding
  // Company Vault evidence does not move the tender's source revision, so a
  // completed Engine run stayed "current" while being out of date, with no
  // control left to redo it.
  it("stays on the page and stays pressable after a completed Engine run", () => {
    assert.match(matchingPanel, /\{canMutate && \(/, "the button must not be hidden once Engine completes");
    assert.doesNotMatch(
      matchingPanel,
      /canMutate && !engineComplete/,
      "a completed run must not remove the owner's only way to re-run matching",
    );
    const enablement = matchingPanel.match(/const canRunEngine = canMutate[\s\S]*?;/)?.[0] ?? "";
    assert.doesNotMatch(enablement, /!engineComplete/, "re-running a completed Engine is the owner's call");
    assert.match(matchingPanel, /Re-run Engine/, "the completed state must say what pressing it will do");

    // The server must agree, or the button would be visible and permanently dead.
    assert.doesNotMatch(
      engineReadinessRoute,
      /canRunEngine:[^\n]*!engineComplete/,
      "engine-readiness must not withhold canRunEngine purely because a run finished",
    );
    assert.match(
      engineReadinessRoute,
      /canRunEngine:[^\n]*!engineRunning/,
      "a queued or running Engine job must still block another",
    );
  });

  it("button uses aria-disabled and aria-busy correctly", () => {
    assert.match(matchingPanel, /aria-disabled=\{!canRunEngine\}/);
    assert.match(matchingPanel, /aria-busy=\{submitting \|\| engineRunning/);
    assert.match(matchingPanel, /disabled=\{!canRunEngine\}/);
  });

  it("shows a disabled reason when the button is not actionable", () => {
    assert.match(matchingPanel, /disabledReason/);
    assert.match(matchingPanel, /role="note"/);
  });

  it("does not start Engine automatically on page render", () => {
    const src = codeOnly(matchingPanel);
    // runEngine must only be called from onClick, not from any useEffect.
    // Check that no useEffect body contains a direct call to runEngine().
    const useEffectBlocks = src.split("useEffect(").slice(1);
    for (const block of useEffectBlocks) {
      // Get the effect body up to the closing of the effect callback.
      const effectBody = block.slice(0, block.indexOf("}, ["));
      assert.doesNotMatch(effectBody, /runEngine\(\)/, "useEffect must not call runEngine()");
    }
  });
});

describe("double-click protection", () => {
  it("AI Analyze: submitting state prevents duplicate clicks", () => {
    assert.match(aiPanel, /if \(submitting \|\| analyzing/);
    assert.match(aiPanel, /setSubmitting\(true\)/);
  });

  it("Run Engine: submitting state prevents duplicate clicks", () => {
    // The panel uses canRunEngine (which includes !submitting) as the guard.
    assert.match(matchingPanel, /if \(!canRunEngine/);
    assert.match(matchingPanel, /setSubmitting\(true\)/);
  });
});

describe("truthful status messages", () => {
  it("AI Analyze panel shows correct status for each state", () => {
    // The panel uses canonical source readiness for status messages.
    assert.match(aiPanel, /Canonical source extraction is still running/);
    assert.match(aiPanel, /Extraction complete\. Run AI Analyze to continue\./);
    assert.match(aiPanel, /AI Analyze is running\./);
    assert.equal(
      describeAIAnalyzeWorkflowState({
        analysisCurrent: true,
        engineRunning: false,
        engineComplete: false,
        engineFailed: false,
        canRunEngine: true,
        activeJob: null,
      }),
      "AI Analyze complete. Run Engine to continue.",
    );
  });

  it("Run Engine panel shows correct status for each state", () => {
    const base = {
      analysisCurrent: false,
      engineRunning: false,
      engineComplete: false,
      engineFailed: false,
      canRunEngine: false,
      activeJob: null,
    };
    assert.equal(describeMatchingEngineState(base, false), "Run AI Analyze first to enable Engine.");
    assert.match(
      describeMatchingEngineState({ ...base, analysisCurrent: true, engineRunning: true }, false),
      /Engine is running/,
    );
    assert.equal(
      describeMatchingEngineState(
        { ...base, analysisCurrent: true, engineComplete: true },
        true,
        {
          nextRequiredAction: "AUTOMATIC_PROCESSING",
          nextRequiredActionLabel: "Processing automatically",
          nextRequiredActionReason: "The durable worker owns this stage.",
          currentBlockingStage: "DOCS_NOT_VALIDATED",
          downstreamSuppressedBy: "DOCS_NOT_VALIDATED",
          finalExportAllowed: false,
          activeJob: { jobType: "AUTO_FINALIZE", status: "RUNNING" },
        },
      ),
      "Engine complete. Downstream processing is continuing automatically.",
    );
  });

  it("workflow-step-links shows correct status messages", () => {
    const workflow = readFileSync("components/workflow-step-links.tsx", "utf8");
    assert.match(workflow, /Source extraction is running automatically\./);
    assert.match(workflow, /Extraction complete\. Run AI Analyze to continue\./);
    assert.match(workflow, /AI Analyze is running\./);
    assert.match(workflow, /AI Analyze complete\. Run Engine to continue\./);
    assert.match(workflow, /Engine started\. Downstream processing continues automatically\./);
    assert.match(workflow, /Processing stopped because review is required\./);
    assert.match(workflow, /Workflow complete\./);
  });
});
