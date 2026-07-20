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

  it("large vaults keep Safe Mode as a separate button alongside the background run", () => {
    assert.match(src, /canMutate && isLargeVault && \(/);
    assert.match(src, /Run Engine \(Safe Mode\)/);
    assert.match(src, /Run in background\{isLargeVault \? " \(full AI\)" : ""\}/);
  });

  it("keeps detailed recovery controls open while the optional quick workflow stays collapsed", () => {
    const page = readFileSync("app/dashboard/tenders/[id]/page.tsx", "utf8");
    assert.match(page, /<details open=\{defaultOpen\}/);

    const quickDisclosure = page.match(
      /<Disclosure\s+[\s\S]*?title="Quick workflow control"[\s\S]*?>/,
    )?.[0] ?? "";
    const detailedDisclosure = page.match(
      /<Disclosure\s+[\s\S]*?title="Detailed readiness and submission controls"[\s\S]*?>/,
    )?.[0] ?? "";

    assert.ok(quickDisclosure, "quick workflow disclosure must exist");
    assert.ok(detailedDisclosure, "detailed readiness disclosure must exist");
    assert.doesNotMatch(
      quickDisclosure,
      /^\s*defaultOpen$/m,
      "quick workflow is optional and must remain collapsed until opened",
    );
    assert.match(
      detailedDisclosure,
      /^\s*defaultOpen$/m,
      "detailed recovery and readiness controls must remain visible by default",
    );
  });
});
