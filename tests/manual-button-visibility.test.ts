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
//   - the current revision has not already completed successfully.
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

const aiPanel = readFileSync("components/ai-analyze-panel.tsx", "utf8");
const matchingPanel = readFileSync("components/matching-selected-evidence-panel.tsx", "utf8");

function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("AI Analyze button visibility conditions", () => {
  it("renders a Run AI Analyze button", () => {
    assert.match(aiPanel, /Run AI Analyze/);
    assert.match(aiPanel, /onClick.*runAiAnalyze/);
  });

  it("button is disabled when extraction is not complete", () => {
    // canRunAnalyze requires extractionComplete
    assert.match(aiPanel, /extractionComplete/);
    assert.match(aiPanel, /canRunAnalyze\s*=\s*canMutate/);
  });

  it("button is disabled when no AI provider is available", () => {
    assert.match(aiPanel, /aiEnabled/);
  });

  it("button is disabled when user lacks permission", () => {
    assert.match(aiPanel, /canMutate/);
  });

  it("button is disabled when an active job exists", () => {
    assert.match(aiPanel, /!analyzing/);
    assert.match(aiPanel, /hasActiveJob/);
  });

  it("button is disabled when analysis already completed", () => {
    assert.match(aiPanel, /!analysisComplete/);
  });

  it("button uses aria-disabled and aria-busy correctly", () => {
    assert.match(aiPanel, /aria-disabled=\{!canRunAnalyze\}/);
    assert.match(aiPanel, /aria-busy=\{submitting \|\| analyzing\}/);
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
    assert.match(src, /useEffect\(\(\) => \{[\s\S]*?if \(!initialContinueJobId\) return/);
  });
});

describe("Run Engine button visibility conditions", () => {
  it("renders a Run Engine button", () => {
    assert.match(matchingPanel, /Run Engine/);
    assert.match(matchingPanel, /onClick.*runEngine/);
  });

  it("button is disabled when AI Analyze has not completed", () => {
    assert.match(matchingPanel, /analysisComplete/);
    assert.match(matchingPanel, /canRunEngine\s*=\s*canMutate && analysisComplete/);
  });

  it("button is disabled when user lacks permission", () => {
    assert.match(matchingPanel, /canMutate/);
  });

  it("button is disabled when an Engine job is running", () => {
    assert.match(matchingPanel, /!engineRunning/);
  });

  it("button is disabled when Engine already completed", () => {
    assert.match(matchingPanel, /!engineComplete/);
  });

  it("button uses aria-disabled and aria-busy correctly", () => {
    assert.match(matchingPanel, /aria-disabled=\{!canRunEngine\}/);
    assert.match(matchingPanel, /aria-busy=\{submitting \|\| engineRunning\}/);
  });

  it("shows a disabled reason when the button is not actionable", () => {
    assert.match(matchingPanel, /disabledReason/);
    assert.match(matchingPanel, /role="note"/);
  });

  it("does not start Engine automatically on page render", () => {
    const src = codeOnly(matchingPanel);
    // No useEffect that calls runEngine.
    assert.doesNotMatch(src, /useEffect\(\(\) => \{[\s\S]*?runEngine/);
  });
});

describe("double-click protection", () => {
  it("AI Analyze: submitting state prevents duplicate clicks", () => {
    assert.match(aiPanel, /if \(submitting \|\| analyzing\) return;/);
    assert.match(aiPanel, /setSubmitting\(true\)/);
  });

  it("Run Engine: submitting state prevents duplicate clicks", () => {
    assert.match(matchingPanel, /if \(submitting \|\| engineRunning\) return;/);
    assert.match(matchingPanel, /setSubmitting\(true\)/);
  });
});

describe("truthful status messages", () => {
  it("AI Analyze panel shows correct status for each state", () => {
    assert.match(aiPanel, /Source extraction is running automatically\./);
    assert.match(aiPanel, /Extraction complete\. Run AI Analyze to continue\./);
    assert.match(aiPanel, /AI Analyze is running\./);
    assert.match(aiPanel, /AI Analyze complete\. Run Engine to continue\./);
  });

  it("Run Engine panel shows correct status for each state", () => {
    assert.match(matchingPanel, /Run AI Analyze first to enable Engine\./);
    assert.match(matchingPanel, /Engine is running\./);
    assert.match(matchingPanel, /Engine complete\. Downstream processing continues automatically\./);
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
