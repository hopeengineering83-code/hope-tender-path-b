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
  "engine-action-panel.tsx",
  // tender-recovery-command-center.tsx removed -- deleted as unrendered dead
  // code (nothing imports or renders it).
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

  it("generation and engine actions retain distinct icons and visible labels", () => {
    const generation = readComponent("generation-action-panel.tsx");
    const engine = readComponent("engine-action-panel.tsx");
    // Generate Docs now uses DocumentGenerateIcon (the icon literally named
    // for this action) so it no longer competes with the engine's BoltIcon.
    // BoltIcon stays canonical for "Run Safe Mode" on the engine-action surface.
    assert.match(generation, /DocumentGenerateIcon/);
    assert.match(generation, /Generate Docs/);
    assert.match(engine, /<BoltIcon/);
    assert.match(engine, /Run Safe Mode — Recommended/);
    assert.match(engine, /<ClockIcon/);
    assert.match(engine, /Run Full AI in Background/);
    // Generation must NOT use BoltIcon — that icon is reserved for engine
    // actions on the engine-action surface.
    assert.doesNotMatch(generation, /BoltIcon/);
  });

  it("final ZIP uses DownloadIcon and visible text", () => {
    assert.match(readComponent("export-readiness-panel.tsx"), /<DownloadIcon \/> Download Final ZIP/);
  });

  it("disabled controls remain readable", () => {
    const engine = stripComments(readComponent("engine-action-panel.tsx"));
    const exportPanel = readComponent("export-readiness-panel.tsx");
    assert.match(engine, /disabled:opacity-60/);
    assert.doesNotMatch(engine, /disabled:opacity-(40|50)/);
    assert.match(exportPanel, /disabled:opacity-60/);
    assert.match(readComponent("generation-action-panel.tsx"), /blockedReason/);
  });
});

// "Recovery Command Center diagnostic icons" describe block removed --
// components/tender-recovery-command-center.tsx was deleted as unrendered
// dead code (nothing imports or renders it). Its Execute/Retry/Resume/
// Review/Link button set had no single live equivalent to redirect to — each
// underlying action now lives on its own live panel (e.g. Retry AI Analyze
// on ai-analyze-panel.tsx, final ZIP download ownership on
// export-readiness-panel.tsx, covered by their own icon tests elsewhere in
// this suite).

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

  it("prohibited-asset repair is conditional", () => {
    assert.match(readComponent("export-readiness-panel.tsx"), /b\.category === "PROHIBITED_ASSET"/);
  });
});

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

  // "does not introduce user-facing metadata wording in recovery
  // diagnostics" test removed -- components/tender-recovery-command-center.tsx
  // was deleted as unrendered dead code (nothing imports or renders it); the
  // no-user-facing-metadata property for the live recovery/next-action
  // surface is already covered by tests/ui-workflow-polish.test.ts against
  // components/next-action-panel.tsx.
});
