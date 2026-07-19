// Structural tests for the panel interlinking and matching gap fixes.
//
// These are STRUCTURAL source-string tests: they read source files and assert
// on code structure. They do NOT execute routes, handlers, or HTTP paths.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("[PANEL-INTERLINK] A2: Workflow Action Center fetch contract", () => {
  it("uses cache: no-store and credentials: include", () => {
    const src = readFileSync(resolve("components/tender-workflow-action-center.tsx"), "utf8");
    assert.ok(src.includes('cache: "no-store"'), "must use cache: no-store to prevent stale responses");
    assert.ok(src.includes('credentials: "include"'), "must use credentials: include for auth cookies");
  });

  it("validates response.ok before parsing JSON", () => {
    const src = readFileSync(resolve("components/tender-workflow-action-center.tsx"), "utf8");
    assert.ok(/if\s*\(!res\.ok\)/.test(src), "must check res.ok before parsing JSON");
  });

  it("validates Array.isArray(json.stages) before setting state", () => {
    const src = readFileSync(resolve("components/tender-workflow-action-center.tsx"), "utf8");
    assert.ok(/Array\.isArray\(json\.stages\)/.test(src), "must validate Array.isArray(json.stages)");
  });

  it("has loadError state with Retry button", () => {
    const src = readFileSync(resolve("components/tender-workflow-action-center.tsx"), "utf8");
    assert.ok(src.includes("loadError"), "must have loadError state");
    assert.ok(src.includes("Retry"), "must have Retry button in error state");
  });

  it("guards polling with document.hidden check", () => {
    const src = readFileSync(resolve("components/tender-workflow-action-center.tsx"), "utf8");
    assert.ok(src.includes("document.hidden"), "must guard polling with document.hidden check");
  });
});

describe("[PANEL-INTERLINK] A3: Recovery Command Center field name", () => {
  it("Blocker type includes nextAction field", () => {
    const src = readFileSync(resolve("components/tender-recovery-command-center.tsx"), "utf8");
    assert.ok(src.includes("nextAction"), "Blocker type must include nextAction field");
  });

  it("renders b.nextAction ?? b.action (not just b.action)", () => {
    const src = readFileSync(resolve("components/tender-recovery-command-center.tsx"), "utf8");
    assert.ok(/b\.nextAction\s*\?\?\s*b\.action/.test(src), "must render b.nextAction ?? b.action");
  });
});

describe("[MATCHING] A5: Bonus stacking cap", () => {
  it("matching.ts has MAX_BONUS_TOTAL constant", () => {
    const src = readFileSync(resolve("lib/engine/matching.ts"), "utf8");
    assert.ok(src.includes("MAX_BONUS_TOTAL"), "must define MAX_BONUS_TOTAL");
  });

  it("uses Math.min(bonusTotal, MAX_BONUS_TOTAL)", () => {
    const src = readFileSync(resolve("lib/engine/matching.ts"), "utf8");
    assert.ok(/Math\.min\(bonusTotal,\s*MAX_BONUS_TOTAL\)/.test(src), "must cap bonus with Math.min");
  });

  it("caps score at 0.95 when coverage < 1.0", () => {
    const src = readFileSync(resolve("lib/engine/matching.ts"), "utf8");
    assert.ok(/coverage < 1\.0.*Math\.min\(score,\s*0\.95\)/s.test(src), "must cap at 0.95 when coverage < 1.0");
  });
});

describe("[MATCHING] A7: Off-sector conflict groups", () => {
  it("SECTOR_CONFLICT_GROUPS includes abattoir/slaughter", () => {
    const src = readFileSync(resolve("lib/engine/matching.ts"), "utf8");
    assert.ok(/abattoir|slaughter/.test(src), "must include abattoir/slaughter conflict group");
  });

  it("SECTOR_CONFLICT_GROUPS includes residential/housing", () => {
    const src = readFileSync(resolve("lib/engine/matching.ts"), "utf8");
    assert.ok(/residential|housing/.test(src), "must include residential/housing conflict group");
  });

  it("SECTOR_CONFLICT_GROUPS includes commercial/retail", () => {
    const src = readFileSync(resolve("lib/engine/matching.ts"), "utf8");
    assert.ok(/commercial|retail/.test(src), "must include commercial/retail conflict group");
  });
});

describe("[CURRENCY] A12: No fabricated USD on missing currency", () => {
  it("ai-multi-perspective-matcher uses 'Currency unresolved' not 'USD'", () => {
    const src = readFileSync(resolve("lib/engine/ai-multi-perspective-matcher.ts"), "utf8");
    assert.ok(src.includes("Currency unresolved"), "must use 'Currency unresolved' when currency is null");
    assert.ok(!/currency\s*\|\|\s*"USD"/.test(src), "must NOT use currency || 'USD' pattern");
  });

  it("generate.ts uses 'Currency unresolved' not 'USD'", () => {
    const src = readFileSync(resolve("lib/engine/generate.ts"), "utf8");
    assert.ok(src.includes("Currency unresolved"), "must use 'Currency unresolved' when currency is null");
    assert.ok(!/currency\s*\?\?\s*"USD"/.test(src), "must NOT use currency ?? 'USD' pattern");
  });
});
