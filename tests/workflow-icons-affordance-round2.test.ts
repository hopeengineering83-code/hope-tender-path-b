import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}
function stripComments(source: string): string {
  return source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
const RAW_OPERATIONAL_ICON = /[✓✗⚡▶↻⊘⏳✦▼▲✕↺↗ℹⓘ]/;

describe("Next Required Action icons", () => {
  it("uses SVG icons for complete, warning, and forward states", () => {
    const source = read("components/next-action-panel.tsx");
    assert.match(source, /<CheckCircleIcon \/>/);
    assert.match(source, /<WarningIcon \/>/);
    assert.match(source, /<ArrowRightIcon \/>/);
    assert.doesNotMatch(stripComments(source), RAW_OPERATIONAL_ICON);
  });
});

describe("the two normal actions have visible semantic icons", () => {
  const owner = read("components/workflow-step-links.tsx");

  it("AI Analyze uses SparklesIcon and Run Engine uses BoltIcon", () => {
    assert.match(owner, /manualAction === "AI_ANALYZE" \? <SparklesIcon \/> : <BoltIcon \/>/);
    assert.match(owner, /"AI Analyze"/);
    assert.match(owner, /"Run Engine"/);
    assert.match(owner, /disabled:opacity-60/);
  });

  it("Build Plan is a status surface with status-specific SVGs", () => {
    const source = read("components/build-submission-plan-button.tsx");
    assert.match(source, /<ClockIcon \/>/);
    assert.match(source, /<CheckCircleIcon \/>/);
    assert.match(source, /<WarningIcon \/>/);
    assert.match(source, /Build Plan awaits Run Engine/);
    assert.doesNotMatch(source, /<button/);
  });

  it("generation remains text-status only and Final ZIP has DownloadIcon", () => {
    const generation = read("components/generation-action-panel.tsx");
    assert.doesNotMatch(generation, /DocumentGenerateIcon|BoltIcon/);
    assert.match(generation, /PROCESSING_AUTOMATICALLY/);
    assert.match(read("components/export-readiness-panel.tsx"), /<DownloadIcon \/> Download Final ZIP/);
  });
});

describe("disabled critical actions remain readable", () => {
  it("uses at least 60% opacity on remaining disabled action controls", () => {
    for (const file of [
      "components/workflow-step-links.tsx",
      "components/export-readiness-panel.tsx",
      "components/submission-plan-completeness-panel.tsx",
    ]) assert.match(read(file), /disabled:opacity-60/);
  });

  it("does not use 40% disabled opacity in priority workflow components", () => {
    for (const file of [
      "components/next-action-panel.tsx",
      "components/workflow-step-links.tsx",
      "components/generation-action-panel.tsx",
      "components/submission-plan-completeness-panel.tsx",
      "components/requirement-coverage-panel.tsx",
      "components/authority-review-panel.tsx",
      "components/document-validator-panel.tsx",
      "components/export-readiness-panel.tsx",
    ]) assert.doesNotMatch(stripComments(read(file)), /disabled:opacity-40/);
  });

  it("provides blocked reasons or titles", () => {
    assert.match(read("components/export-readiness-panel.tsx"), /Download blocked/);
    assert.match(read("components/submission-plan-completeness-panel.tsx"), /title=\{disabled/);
  });
});

describe("status badges use SVG icons with distinct meanings", () => {
  it("submission plan statuses distinguish complete, warning, blocked, planned, and historical", () => {
    const source = read("components/submission-plan-completeness-panel.tsx");
    assert.match(source, /icon: <CheckCircleIcon \/>/);
    assert.match(source, /icon: <WarningIcon \/>/);
    assert.match(source, /icon: <BanIcon \/>/);
    assert.match(source, /icon: <ClockIcon \/>/);
    assert.match(source, /SUPERSEDED: \{ label: "HISTORICAL"[\s\S]*?icon: <FolderIcon \/>/);
  });

  it("key workflow components contain no raw operational icon glyphs", () => {
    for (const file of [
      "components/next-action-panel.tsx",
      "components/workflow-step-links.tsx",
      "components/build-submission-plan-button.tsx",
      "components/generation-action-panel.tsx",
      "components/export-readiness-panel.tsx",
    ]) assert.doesNotMatch(stripComments(read(file)), RAW_OPERATIONAL_ICON, file);
  });
});
