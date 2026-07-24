// Live audit gap fixes — regression tests for findings from the live
// Vercel preview audit.
//
// The live audit (run against https://hope-tender-path-i4x46q338-...vercel.app
// with real admin credentials) found 19 real findings (after filtering out
// Vercel Live CSP noise):
//   - 18 frozen/silent disabled controls on /dashboard/company/review
//     (Experts + Projects sections, 3 viewports × 2 sections × 3 buttons)
//   - 1 horizontal overflow on /dashboard/compliance mobile viewport
//     (131px overflow: scrollW=521 vs viewW=390)
//
// These tests verify the fixes are in place and prevent regression.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readApp(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("live audit fix — /dashboard/compliance mobile horizontal overflow", () => {
  const source = readApp("app/dashboard/compliance/compliance-dashboard.tsx");

  it("wraps the per-tender matrix table in overflow-x-auto", () => {
    // The fix: every <table> in the compliance dashboard must be wrapped in
    // a <div className="overflow-x-auto"> so wide tables scroll horizontally
    // on mobile instead of pushing the page width past the viewport.
    const tableCount = (source.match(/<table/g) ?? []).length;
    const overflowWrapperCount = (source.match(/<div className="overflow-x-auto">/g) ?? []).length;
    assert.ok(
      overflowWrapperCount >= tableCount,
      `Expected at least ${tableCount} overflow-x-auto wrappers (one per table), got ${overflowWrapperCount}`,
    );
  });

  it("does NOT have a bare <table> without an overflow-x-auto wrapper", () => {
    // Strip comments, then check that every <table> is preceded (within a
    // few lines) by an overflow-x-auto wrapper. We approximate by checking
    // that the count of overflow-x-auto wrappers is >= the count of tables.
    const stripped = source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const tableCount = (stripped.match(/<table/g) ?? []).length;
    const wrapperCount = (stripped.match(/overflow-x-auto/g) ?? []).length;
    assert.ok(
      wrapperCount >= tableCount,
      `Found ${tableCount} <table> elements but only ${wrapperCount} overflow-x-auto wrappers — every table must be wrapped to prevent mobile overflow`,
    );
  });
});

describe("live audit fix — /dashboard/company/review frozen/silent disabled controls", () => {
  const source = readApp("app/dashboard/company/review/page.tsx");

  it("Experts section shows an inline hint when eligibleExperts is empty", () => {
    // The fix: when eligibleExperts.length === 0, an inline <span> explains
    // why the buttons are disabled and what to do (upload source files or
    // that all are already reviewed).
    assert.match(
      source,
      /eligibleExperts\.length === 0 && \([\s\S]*?No expert drafts yet — upload Expert CV \/ Portfolio sources in the Company Vault, then run Vault Repair\./,
    );
  });

  it("Projects section shows an inline hint when eligibleProjects is empty", () => {
    assert.match(
      source,
      /eligibleProjects\.length === 0 && \([\s\S]*?No project drafts yet — upload Project Reference \/ Contract \/ Portfolio sources in the Company Vault, then run Vault Repair\./,
    );
  });

  it("Experts 'Select eligible on page' button has a title attribute explaining why it's disabled", () => {
    // The fix: every disabled button gets a title attribute so screen
    // readers and hover tooltips explain the disabled state.
    const selectExpertsButton = source.match(/onClick=\{\(\) => setSelectedExperts\([^}]*\)\}[^>]*disabled=\{eligibleExperts\.length === 0\}[^>]*>/);
    assert.ok(selectExpertsButton, "Could not find the Experts 'Select eligible on page' button");
    assert.match(selectExpertsButton[0], /title=\{eligibleExperts\.length === 0 \? "No eligible experts on this page to select\./);
  });

  it("Experts 'Review selected' button has a title attribute explaining why it's disabled", () => {
    const reviewExpertsButton = source.match(/onClick=\{\(\) => void submitBatch\("experts"\)\}[^>]*disabled=\{selectedExperts\.size === 0[^}]*\}[^>]*>/);
    assert.ok(reviewExpertsButton, "Could not find the Experts 'Review selected' button");
    assert.match(reviewExpertsButton[0], /title=\{selectedExperts\.size === 0 \? "Select at least one expert to review\./);
  });

  it("Projects 'Select eligible on page' button has a title attribute explaining why it's disabled", () => {
    const selectProjectsButton = source.match(/onClick=\{\(\) => setSelectedProjects\([^}]*\)\}[^>]*disabled=\{eligibleProjects\.length === 0\}[^>]*>/);
    assert.ok(selectProjectsButton, "Could not find the Projects 'Select eligible on page' button");
    assert.match(selectProjectsButton[0], /title=\{eligibleProjects\.length === 0 \? "No eligible projects on this page to select\./);
  });

  it("Projects 'Review selected' button has a title attribute explaining why it's disabled", () => {
    const reviewProjectsButton = source.match(/onClick=\{\(\) => void submitBatch\("projects"\)\}[^>]*disabled=\{selectedProjects\.size === 0[^}]*\}[^>]*>/);
    assert.ok(reviewProjectsButton, "Could not find the Projects 'Review selected' button");
    assert.match(reviewProjectsButton[0], /title=\{selectedProjects\.size === 0 \? "Select at least one project to review\./);
  });

  it("Previous pagination button has a title attribute", () => {
    assert.match(source, /title=\{props\.page <= 1 \? "You are on the first page\./);
  });

  it("Next pagination button has a title attribute", () => {
    assert.match(source, /title=\{props\.page >= props\.totalPages \? "You are on the last page\./);
  });

  it("disabled buttons use cursor-not-allowed (visible disabled state)", () => {
    // The fix: every disabled button gets disabled:cursor-not-allowed so
    // the cursor visibly changes, reinforcing the disabled state visually.
    const cursorNotAllowedCount = (source.match(/disabled:cursor-not-allowed/g) ?? []).length;
    assert.ok(
      cursorNotAllowedCount >= 6,
      `Expected at least 6 disabled:cursor-not-allowed (3 Experts + 3 Projects buttons), got ${cursorNotAllowedCount}`,
    );
  });
});
