import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const actionCenter = readFileSync("components/tender-workflow-action-center.tsx", "utf8");
const aiAnalyzePanel = readFileSync("components/ai-analyze-panel.tsx", "utf8");
// Stage-to-anchor targets are the single canonical map in
// lib/tender-workflow-stage-targets.ts, imported by both
// TenderWorkflowActionCenter and WorkflowStepLinks — assert against that one
// source instead of a copy inline in either consuming component.
const stageTargets = readFileSync("lib/tender-workflow-stage-targets.ts", "utf8");

describe("Workflow Control Center requirement-action anchor fallback", () => {
  it("prefers the requirement coverage panel and falls back to the stable analysis section", () => {
    assert.match(
      stageTargets,
      /4:\s*\["#requirement-coverage",\s*"#ai-analyze-section"\]/,
      "stage 4 must preserve the precise requirement target and an always-present fallback",
    );
    assert.match(
      actionCenter,
      /TENDER_WORKFLOW_STAGE_TARGETS\[stage\.stage\]/,
      "the action center must resolve stage targets from the canonical registry",
    );
  });

  it("selects the first attached target instead of silently doing nothing", () => {
    assert.match(actionCenter, /\.map\(\(selector\)\s*=>\s*document\.querySelector\(selector\)\)/);
    assert.match(actionCenter, /\.find\(\(candidate\): candidate is Element => candidate !== null\)/);
    // The action center delegates scroll to openParentDetailsAndScroll() so
    // parent <details>/disclosures are opened before scrolling. The helper
    // itself calls scrollIntoView internally — the test checks for the helper
    // call instead of the inline scrollIntoView.
    assert.match(actionCenter, /openParentDetailsAndScroll\(element\)/);
    assert.match(actionCenter, /could not find its target panel/);
  });

  it("the fallback anchor is rendered unconditionally by AIAnalyzePanel", () => {
    assert.match(aiAnalyzePanel, /<section id="ai-analyze-section"/);
  });
});
