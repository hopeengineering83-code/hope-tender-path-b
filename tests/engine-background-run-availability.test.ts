// Background engine run must be reachable exactly when the engine tells the
// user to use it. Observed live: on a large vault the panel's only button was
// "Run Engine (Safe Mode)" (async safe+skipAiRematch), whose own result
// message says "Re-run in background mode for AI multi-perspective scoring"
// — but the full-AI background button was hidden by the same isLargeVault
// condition, a circular dead end with no affordance.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const src = readFileSync("components/engine-action-panel.tsx", "utf8");

describe("engine background-run availability", () => {
  it("the full-AI background button is rendered for every mutating role, large vaults included", () => {
    // The background button's onClick must be the plain async run, not
    // gated behind an isLargeVault ternary that swaps it for safe mode.
    assert.match(src, /onClick=\{\(\) => runEngineAsync\(false\)\}/);
    assert.doesNotMatch(
      src,
      /isLargeVault\s*\n?\s*\? runEngineAsync\(false, \{ safe: "true", skipAiRematch: "true" \}\)\s*\n?\s*: runEngineAsync\(false\)/,
      "background run must not be swapped out for safe mode on large vaults",
    );
  });

  it("Safe Mode and the background run are both always visible, regardless of vault size (no vault-size-conditional swap)", () => {
    // Consolidated to exactly two engine actions, unconditionally rendered
    // for every mutating role — no isLargeVault ternary hides or swaps
    // either one, and neither is duplicated in a banner below.
    assert.match(src, /Run Safe Mode — Recommended/);
    assert.match(src, /Run Full AI in Background/);
    assert.doesNotMatch(src, /canMutate && isLargeVault && \(/, "Safe Mode must not be gated behind isLargeVault");
    assert.doesNotMatch(src, /canMutate && !isLargeVault && \(/, "no vault-size-conditional sync-only button should remain");
  });

  it("NextActionPanel is the one always-visible authoritative status card; Recovery Command Center / Release State / Final Submission Control Center are collapsed advanced diagnostics", () => {
    const page = readFileSync("app/dashboard/tenders/[id]/page.tsx", "utf8");
    assert.match(page, /<NextActionPanel tenderId=\{tender\.id\} \/>/, "NextActionPanel must render directly, not inside a collapsible Disclosure");

    const quickDisclosure = page.match(
      /<Disclosure\s+[\s\S]*?title="Quick workflow control"[\s\S]*?>/,
    )?.[0] ?? "";
    const advancedDisclosure = page.match(
      /<Disclosure\s+[\s\S]*?title="Advanced diagnostics"[\s\S]*?<\/Disclosure>/,
    )?.[0] ?? "";

    assert.ok(quickDisclosure, "quick workflow disclosure must exist");
    assert.ok(advancedDisclosure, "advanced diagnostics disclosure must exist");
    // Both secondary disclosures must be collapsed by default — neither
    // duplicates NextActionPanel's status, so neither needs to compete for
    // primary attention on page load.
    assert.doesNotMatch(quickDisclosure, /defaultOpen/, "quick workflow must remain collapsed until opened");
    assert.doesNotMatch(advancedDisclosure, /title="Advanced diagnostics"[\s\S]*?defaultOpen/, "advanced diagnostics (Recovery Command Center, Release State, Final Submission Control Center) must be collapsed, not competing with the status card above");
    // The three previously-competing panels are still present (moved, not
    // deleted) inside the collapsed advanced-diagnostics section.
    assert.match(advancedDisclosure, /<TenderRecoveryCommandCenter/);
    assert.match(advancedDisclosure, /<TenderReleaseStatePanel/);
    assert.match(advancedDisclosure, /<FinalSubmissionControlCenter/);
  });
});
