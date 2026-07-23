// Workflow icon and action-affordance regression coverage.

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
const RAW_UNICODE_PATTERN = /[✓✗⚡▶↻⊘⏳✦→↓↑←▼▲✕↺↗ℹⓘ]/;

describe("Recovery Command Center affordances", () => {
  const source = read("components/tender-recovery-command-center.tsx");

  it("shows an icon and text for its generic recovery mutation", () => {
    assert.match(source, /<PlayIcon \/>/);
    assert.match(source, /"Execute"/);
  });

  it("does not own final ZIP download", () => {
    assert.doesNotMatch(source, /<DownloadIcon/);
  });

  it("uses ArrowRightIcon for the two links to the one canonical engine control", () => {
    assert.equal((source.match(/DisclosureAnchorLink href="#run-engine-action"/g) ?? []).length, 2);
    assert.equal((source.match(/<ArrowRightIcon \/> Go to Run Engine/g) ?? []).length, 2);
    assert.doesNotMatch(source, /executeAction\("RUN_ENGINE"\)/);
  });

  it("uses distinct mutation icons for the remaining quick actions", () => {
    assert.match(source, /<RefreshIcon \/> Retry AI Analyze/);
    assert.match(source, /<PlayIcon \/> Resume AI Analyze/);
    assert.match(source, /<WarningIcon \/> Review Matching Inputs/);
    assert.match(source, /<CheckIcon \/> Link Vault Evidence/);
  });
});

describe("Next Required Action icons", () => {
  const source = read("components/next-action-panel.tsx");

  it("uses SVG icons for complete, warning, and forward states", () => {
    assert.match(source, /<CheckCircleIcon \/>/);
    assert.match(source, /<WarningIcon \/>/);
    assert.match(source, /<ArrowRightIcon \/>/);
    const visible = stripComments(source);
    assert.doesNotMatch(visible, /return "[✓⚠→]"/);
    assert.doesNotMatch(visible, /"[✓→] "/);
  });
});

describe("workflow actions have visible semantic icons and labels", () => {
  it("Build Plan uses DocumentIcon", () => {
    const source = read("components/submission-plan-completeness-panel.tsx");
    assert.match(source, /<DocumentIcon \/>/);
    assert.match(source, /"Build Plan"/);
    assert.match(source, /title="Build the submission plan/);
  });

  it("evidence actions use PaperclipIcon and LinkIcon remains exported", () => {
    const exportPanel = read("components/export-readiness-panel.tsx");
    assert.match(exportPanel, /<PaperclipIcon \/>/);
    assert.match(exportPanel, /Use vault evidence/);
    assert.match(read("components/icons.tsx"), /export function LinkIcon/);
  });

  it("generation, review, and export actions use distinct icons", () => {
    assert.match(read("components/generation-action-panel.tsx"), /BoltIcon/);
    assert.match(read("components/submission-plan-completeness-panel.tsx"), /<CheckCircleIcon \/>/);
    assert.match(read("components/authority-review-panel.tsx"), /<CheckCircleIcon \/>/);
    assert.match(read("components/export-readiness-panel.tsx"), /<DownloadIcon \/> Download Final ZIP/);
  });
});

describe("disabled critical actions remain readable and explained", () => {
  it("uses at least 60% opacity on priority disabled actions", () => {
    for (const file of [
      "components/engine-action-panel.tsx",
      "components/export-readiness-panel.tsx",
      "components/submission-plan-completeness-panel.tsx",
    ]) assert.match(read(file), /disabled:opacity-60/);
  });

  it("does not use 40% disabled opacity in priority workflow components", () => {
    for (const file of [
      "components/next-action-panel.tsx",
      "components/tender-recovery-command-center.tsx",
      "components/engine-action-panel.tsx",
      "components/generation-action-panel.tsx",
      "components/submission-plan-completeness-panel.tsx",
      "components/requirement-coverage-panel.tsx",
      "components/authority-review-panel.tsx",
      "components/document-validator-panel.tsx",
      "components/export-readiness-panel.tsx",
      "components/tender-controls-panel.tsx",
      "components/tender-share-panel.tsx",
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
    const historical = source.split("\n").find((line) => line.includes('SUPERSEDED: { label: "HISTORICAL"')) ?? "";
    assert.match(historical, /icon: <FolderIcon \/>/);
  });

  it("authority and document quality states use text plus SVG", () => {
    const authority = read("components/authority-review-panel.tsx");
    assert.match(authority, /<CheckCircleIcon \/> AUTHORITY READY/);
    assert.match(authority, /<WarningIcon \/> NEEDS REVIEW/);
    assert.match(authority, /<CrossIcon \/> BLOCKED/);
    const validator = read("components/document-validator-panel.tsx");
    assert.match(validator, /<CheckIcon \/> Clean/);
    assert.match(validator, /<WarningIcon \/> Review/);
    assert.match(validator, /<CrossIcon \/> Blocked/);
  });
});

describe("workflow components contain no raw operational icons or user-facing metadata label", () => {
  const WORKFLOW_COMPONENTS = [
    "next-action-panel.tsx",
    "tender-recovery-command-center.tsx",
    "engine-action-panel.tsx",
    "generation-action-panel.tsx",
    "submission-plan-completeness-panel.tsx",
    "requirement-coverage-panel.tsx",
    "authority-review-panel.tsx",
    "document-validator-panel.tsx",
    "export-readiness-panel.tsx",
    "score-breakdown-panel.tsx",
  ];
  for (const file of WORKFLOW_COMPONENTS) {
    it(`${file} uses SVGs rather than Unicode dingbats`, () => {
      assert.doesNotMatch(stripComments(read(`components/${file}`)), RAW_UNICODE_PATTERN);
    });
  }
  it("does not expose metadata as user-facing recovery wording", () => {
    assert.doesNotMatch(stripComments(read("components/tender-recovery-command-center.tsx")), />\s*[Mm]etadata[\s<]/);
  });
});
