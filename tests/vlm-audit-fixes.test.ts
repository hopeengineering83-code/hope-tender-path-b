// VLM screenshot audit fixes — regression tests for confirmed visual gaps.
//
// These tests verify the fixes for gaps found by the vision-based screenshot
// audit (using z-ai vision CLI to analyze each page screenshot line-by-line).
//
// Confirmed gaps fixed:
// 1. Company Vault loading state: poor contrast (text-slate-400 on white) +
//    no spinner. Fixed: added spinner + text-slate-700 + font-medium.
// 2. Data Diagnostics loading state: same issue. Fixed: same pattern.
// 3. Export Hub "ZIP locked" button: no visible explanation of why it's
//    locked. Fixed: added inline "N blockers — view checklist to resolve"
//    link that expands the checklist.
// 4. New Tender "Create Tender from Uploaded Documents" button: disabled
//    state not visually distinct (opacity-60 on blue still looks blue).
//    Fixed: disabled:bg-slate-200 disabled:text-slate-400 + title attr.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readApp(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("VLM audit fix — Company Vault loading state contrast + spinner", () => {
  const source = readApp("app/dashboard/company/page.tsx");

  it("uses text-slate-700 for the loading text", () => {
    // The VLM audit found text-slate-400 on white has poor contrast (fails
    // WCAG AA). The fix uses text-slate-700 + font-medium.
    const loadingBlock = source.match(/if \(loading\) return \([\s\S]*?Loading Company Vault/);
    assert.ok(loadingBlock, "Could not find the loading state block");
    assert.match(loadingBlock[0], /text-slate-700/);
  });

  it("does NOT use text-slate-400 in the className (only in comments)", () => {
    // Strip comments before checking.
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const loadingBlock = stripped.match(/if \(loading\) return \([\s\S]*?Loading Company Vault/);
    assert.ok(loadingBlock, "Could not find the loading state block");
    assert.doesNotMatch(loadingBlock[0], /text-slate-400/);
  });

  it("includes an animated spinner SVG", () => {
    const loadingBlock = source.match(/if \(loading\) return \([\s\S]*?Loading Company Vault[\s\S]*?<\/div>/);
    assert.ok(loadingBlock, "Could not find the loading state block");
    assert.match(loadingBlock[0], /animate-spin/);
    assert.match(loadingBlock[0], /<svg/);
  });

  it("has role=status and aria-live=polite for screen readers", () => {
    const loadingBlock = source.match(/if \(loading\) return \([\s\S]*?Loading Company Vault[\s\S]*?<\/div>/);
    assert.ok(loadingBlock, "Could not find the loading state block");
    assert.match(loadingBlock[0], /role="status"/);
    assert.match(loadingBlock[0], /aria-live="polite"/);
  });
});

describe("VLM audit fix — Data Diagnostics loading state contrast + spinner", () => {
  const source = readApp("app/dashboard/company/review/page.tsx");

  it("uses text-slate-700 for the loading text", () => {
    const loadingBlock = source.match(/if \(loading && !diagnostics\) \{[\s\S]*?Loading Review Inbox/);
    assert.ok(loadingBlock, "Could not find the loading state block");
    assert.match(loadingBlock[0], /text-slate-700/);
  });

  it("does NOT use text-slate-400 in the className (only in comments)", () => {
    // Strip comments before checking — the comment references text-slate-400
    // to explain what was changed, but the actual className must not use it.
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const loadingBlock = stripped.match(/if \(loading && !diagnostics\) \{[\s\S]*?Loading Review Inbox/);
    assert.ok(loadingBlock, "Could not find the loading state block");
    assert.doesNotMatch(loadingBlock[0], /text-slate-400/);
  });

  it("includes an animated spinner SVG", () => {
    const loadingBlock = source.match(/if \(loading && !diagnostics\) \{[\s\S]*?\n  \}/);
    assert.ok(loadingBlock, "Could not find the loading state block");
    assert.match(loadingBlock[0], /animate-spin/);
    assert.match(loadingBlock[0], /<svg/);
  });
});

describe("VLM audit fix — Export Hub ZIP locked explanation", () => {
  const source = readApp("app/dashboard/export/export-tender-card.tsx");

  it("shows an inline blocker count and 'view checklist to resolve' link when ZIP is locked", () => {
    // The VLM audit found the "ZIP locked" button had no visible explanation.
    // The fix adds an inline span showing the blocker count + a button that
    // expands the checklist.
    assert.match(
      source,
      /canonicalBlockerCodes\.length[\s\S]*?blocker[\s\S]*?view checklist to resolve/,
      "Expected inline blocker count + 'view checklist to resolve' link",
    );
  });

  it("the 'view checklist to resolve' link expands the checklist (calls setExpanded(true))", () => {
    assert.match(
      source,
      /onClick=\{\(\) => setExpanded\(true\)\}[\s\S]*?view checklist to resolve/,
    );
  });

  it("the ZIP locked button title explains the recovery action", () => {
    assert.match(
      source,
      /title=\{canonicalNextAction \?\? "Resolve all critical gaps to unlock the ZIP download\."\}/,
    );
  });
});

describe("VLM audit fix — New Tender button disabled state visually distinct", () => {
  const source = readApp("app/dashboard/tenders/new/page.tsx");

  it("uses disabled:bg-slate-200 disabled:text-slate-400 (not just opacity-60)", () => {
    // The VLM audit found opacity-60 on a blue button still looks blue/enabled.
    // The fix uses disabled:bg-slate-200 disabled:text-slate-400 so the
    // disabled state is visually distinct (grey background + grey text).
    // Match just the button element (not the function body).
    const btnMatch = source.match(/<button[\s\S]*?handleUploadFirst[\s\S]*?<\/button>/);
    assert.ok(btnMatch, "Could not find the upload button");
    assert.match(btnMatch[0], /disabled:bg-slate-200/);
    assert.match(btnMatch[0], /disabled:text-slate-400/);
  });

  it("has a title attribute explaining why it's disabled when no files selected", () => {
    const btnMatch = source.match(/<button[\s\S]*?handleUploadFirst[\s\S]*?<\/button>/);
    assert.ok(btnMatch, "Could not find the upload button");
    assert.match(
      btnMatch[0],
      /title=\{files\.length === 0 \? "Select at least one tender document to enable this action\./,
    );
  });

  it("the button is still disabled when files.length === 0 (logic unchanged)", () => {
    const btnMatch = source.match(/<button[\s\S]*?handleUploadFirst[\s\S]*?<\/button>/);
    assert.ok(btnMatch, "Could not find the upload button");
    assert.match(btnMatch[0], /disabled=\{uploading \|\| files\.length === 0\}/);
  });
});
