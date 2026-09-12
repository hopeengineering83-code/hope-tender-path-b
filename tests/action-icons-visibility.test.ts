// Regression tests for visible action icons and non-overlapping meanings.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readComponent(name: string): string {
  return readFileSync(resolve(process.cwd(), "components", name), "utf8");
}

function stripComments(source: string): string {
  return source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const OPERATIONAL_COMPONENTS = [
  "generation-action-panel.tsx",
  "document-validator-panel.tsx",
  "export-readiness-panel.tsx",
  "authority-review-panel.tsx",
  "tender-share-panel.tsx",
  "requirement-coverage-panel.tsx",
  "tender-controls-panel.tsx",
];
const RAW_UNICODE_PATTERN = /[✓✗⚡▶↻⊘⏳✦→↓↑←▼▲✕↺↗]/;

describe("operational components use SVG icons", () => {
  for (const file of OPERATIONAL_COMPONENTS) {
    it(`${file} has no raw operational dingbats`, () => {
      assert.doesNotMatch(stripComments(readComponent(file)), RAW_UNICODE_PATTERN);
    });
  }

  it("generation actions use text-based status (no icons)", () => {
    const generation = readComponent("generation-action-panel.tsx");
    assert.match(generation, /PROCESSING_AUTOMATICALLY/);
    assert.match(generation, /READY_TO_DOWNLOAD/);
  });

  it("final ZIP uses DownloadIcon and visible text", () => {
    assert.match(readComponent("export-readiness-panel.tsx"), /<DownloadIcon \/> Download Final ZIP/);
  });

  it("disabled controls remain readable", () => {
    const exportPanel = readComponent("export-readiness-panel.tsx");
    assert.match(exportPanel, /disabled:opacity-60/);
    // Gap 2+3: generation-action-panel no longer has buttons or disabled states.
  });
});

describe("document, share, and export affordances", () => {
  it("document validation states use SVG icons", () => {
    const source = readComponent("document-validator-panel.tsx");
    assert.match(source, /<CheckIcon \/> Clean/);
    assert.match(source, /<WarningIcon \/> Review/);
    assert.match(source, /<CrossIcon \/> Blocked/);
    assert.match(source, /<WarningIcon/);
  });

  it("share controls use ShareIcon and readable disabled opacity", () => {
    const source = readComponent("tender-share-panel.tsx");
    assert.match(source, /ShareIcon/);
    assert.match(source, /<ShareIcon/);
    assert.match(source, /disabled:opacity-60/);
  });

  it("prohibited-asset repair button removed from export panel", () => {
    const exportPanel = readComponent("export-readiness-panel.tsx");
    assert.doesNotMatch(exportPanel, /Repair prohibited assets/);
  });});

describe("icon registry contract", () => {
  it("exports the required semantic icon set", () => {
    const source = readComponent("icons.tsx");
    const required = [
      "SparklesIcon", "BoltIcon", "CheckIcon", "CheckCircleIcon", "DownloadIcon",
      "PlayIcon", "RefreshIcon", "BanIcon", "WarningIcon", "LockIcon", "CrossIcon",
      "InfoIcon", "UploadIcon", "ShareIcon", "DocumentIcon", "PaperclipIcon",
      "ClockIcon", "ArrowRightIcon",
    ];
    for (const icon of required) assert.match(source, new RegExp(`export function ${icon}`));
    assert.match(source, /stroke: "currentColor"/);
  });
});
