import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const actionCenter = readFileSync("components/tender-workflow-action-center.tsx", "utf8");
const aiAnalyzePanel = readFileSync("components/ai-analyze-panel.tsx", "utf8");

describe("Workflow Control Center requirement-action anchor fallback", () => {
  it("prefers the requirement coverage panel and falls back to the stable analysis section", () => {
    assert.match(
      actionCenter,
      /4:\s*\["#requirement-coverage",\s*"#ai-analyze-section"\]/,
      "stage 4 must preserve the precise requirement target and an always-present fallback",
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
