// Full-app audit regression tests for engine, UI, and API safety gaps.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const stripComments = (source: string) => source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("H1 — criticalMetadataOk no longer inverted", () => {
  it("uses the non-inverted async IIFE and fails closed", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    assert.doesNotMatch(src, /\? !\(await \(async \(\) =>/);
    assert.match(src, /\? \(await \(async \(\) =>/);
    assert.ok(src.indexOf("} catch { return false; }") > src.indexOf("? (await (async () =>"));
  });
});

describe("H3 — EXPORT_BLOCKED is selectable in canonical-workflow-decision", () => {
  it("is present in the union, priority order, and action map", () => {
    const src = read("lib/engine/canonical-workflow-decision.ts");
    const union = src.match(/export type WorkflowBlockerPriority\s*=\s*([\s\S]*?);/)?.[1] ?? "";
    assert.match(union, /"EXPORT_BLOCKED"/);
    assert.ok(src.indexOf('"EXPORT_BLOCKED"') < src.indexOf('"EXPORT_ZIP_READY"'));
    assert.match(src, /EXPORT_BLOCKED:\s*\{\s*action:\s*"FIX_EXPORT_BLOCKERS"/);
  });
});

describe("H2 — runtime-readiness-facts select mirrors the gate", () => {
  it("selects required tender and file fields", () => {
    const src = read("lib/engine/runtime-readiness-facts.ts");
    for (const token of ["title: true", "description: true", "intakeSummary: true", "originalFileName: true", "classification: true", "createdAt: true"]) {
      assert.ok(src.includes(token), `missing ${token}`);
    }
  });
});

describe("L2 — duplicate TENDER_FACTS_INVALID removed", () => {
  it("appears once in the GenerationBlockerCode union", () => {
    const src = read("lib/engine/generation-readiness-gate.ts");
    const union = src.match(/export type GenerationBlockerCode\s*=\s*([\s\S]*?);/)?.[1] ?? "";
    assert.equal((union.match(/"TENDER_FACTS_INVALID"/g) ?? []).length, 1);
  });
});

describe("M3 — mergeFallbackRows no-op contradiction fixed", () => {
  it("documents the fail-closed evidence-provenance boundary", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.doesNotMatch(src, /Created \$\{fallback\.rows\.length\} deterministic fallback compliance rows/);
    assert.match(src, /mergeFallbackRows is fail-closed no-op/);
    assert.ok(src.includes("evidence-provenance"));
    assert.ok(src.includes("diagnostics only") || src.includes("NOT Company Vault evidence") || src.includes("diagnostic rows not persisted as compliance evidence"));
  });
});

describe("H1 UI — mutation role gates remain fail-closed", () => {
  it("computes canMutate once and passes it to every live mutation owner", () => {
    const page = read("app/dashboard/tenders/[id]/page.tsx");
    assert.match(page, /const currentUser = await getCurrentUser\(\)/);
    assert.match(page, /const canMutate = canMutateTender\(currentUser\?\.role\)/);
    for (const component of ["TenderSourceFilesPanel", "AIAnalyzePanel", "RequirementCoveragePanel", "GenerationActionPanel", "ExportReadinessPanel", "PricingWorkbookPanel", "TenderSharePanel"]) {
      const start = page.indexOf(`<${component}`);
      assert.ok(start >= 0, `${component} must be mounted`);
      const end = page.indexOf("/>", start);
      assert.ok(end > start, `${component} must have a closed JSX tag`);
      const usage = page.slice(start, end + 2);
      assert.match(usage, /canMutate=\{canMutate\}/, `${component} must receive canMutate`);
    }
  });

  // "retired release-state form remains gated" test removed --
  // components/tender-release-state-panel.tsx was deleted as unrendered dead
  // code, and components/bid-decision-form.tsx (which it exclusively
  // consumed) is deleted alongside it as a cascading orphan.
});

// "M3 UI — dead EXTRACTION_NOT_READY branch removed" asserted that
// components/engine-action-panel.tsx rendered no force-run bypass. The whole
// panel is gone, so there is no bypass to regress. The guarantee that no UI
// invokes the Engine at all now lives in
// tests/engine-is-not-a-user-action.test.ts.

// "M4 UI — dead OCR provider state removed" and "L9 UI — dead MISSING
// substring removed" describe blocks removed --
// components/tender-recovery-command-center.tsx was deleted in full as
// unrendered dead code (nothing imports or renders it), so both formerly-dead
// branches these blocks proved were removed no longer exist anywhere to
// regress. No other component ever had a duplicate OCR provider selector or
// a state.includes("MISSING") check, so there is nothing to redirect to.

describe("H3 API — db-integrity does not leak connection errors", () => {
  it("returns a fixed safe message and logs only server-side detail", () => {
    const src = read("app/api/admin/db-integrity/route.ts");
    assert.doesNotMatch(src, /connectionError = err instanceof Error \? err\.message\.slice/);
    assert.match(src, /connectionError = "Connection check failed \(see server logs\)\."/);
    assert.match(src, /logger\.error\("\[db-integrity\] connection check failed"/);
    assert.match(src, /detail: err instanceof Error \? err\.constructor\.name : typeof err/);
  });
});
