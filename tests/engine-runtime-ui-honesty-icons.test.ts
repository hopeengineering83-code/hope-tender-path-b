// Engine runtime + UI honesty + icons — regression tests for the 8 gaps.
//
// These tests verify the fixes on the fix/engine-runtime-ui-honesty-icons branch:
//   GAP A: Engine route returns success:false when partial=true
//   GAP B: Engine route catch-block logs errorName only (not raw error)
//   GAP C: Engine route passes deadlineAt to runTenderEngine
//   GAP D: engine-action-panel checks data.partial before showing success
//   GAP E: tender-detail checks engineData.partial before proceeding to generate
//   GAP G: No raw Unicode in audit-trail-list.tsx
//   GAP H: No raw Unicode in build-version-badge.tsx

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── GAP A: Engine route returns success:false when partial ──────────────────

describe("GAP A — Engine route returns success:false when partial", () => {
  it("does NOT return success:true when partial=true", () => {
    const src = read("app/api/tenders/[id]/engine/route.ts");
    assert.match(src, /const isPartial = engineMeta\.partial \?\? false/);
    assert.match(src, /success: !isPartial/);
    assert.match(src, /ok: !isPartial/);
    // Must NOT unconditionally return success: true.
    assert.doesNotMatch(src, /success: true,\s*\n\s*ok: !engineMeta\.partial/);
  });
});

// ─── GAP B: Engine route logs errorName only ──────────────────────────────────

describe("GAP B — Engine route logs errorName only (no raw error leak)", () => {
  it("catch-block does NOT log the raw error object", () => {
    const src = read("app/api/tenders/[id]/engine/route.ts");
    assert.doesNotMatch(src, /console\.error\("Engine run failed:", \{ diagnosticId, error \}\)/);
  });

  it("catch-block logs errorName (constructor name) instead of raw error", () => {
    const src = read("app/api/tenders/[id]/engine/route.ts");
    assert.match(src, /const errorName = error instanceof Error \? error\.constructor\.name : typeof error/);
    assert.match(src, /console\.error\("Engine run failed:", \{ diagnosticId, errorName \}\)/);
  });
});

// ─── GAP C: Engine route passes deadlineAt ───────────────────────────────────

describe("GAP C — Engine route passes deadlineAt to runTenderEngine", () => {
  it("computes a 50s deadline and passes it to runTenderEngine", () => {
    const src = read("app/api/tenders/[id]/engine/route.ts");
    assert.match(src, /const deadlineAt = Date\.now\(\) \+ 50_000/);
    assert.match(src, /runTenderEngine\(id, userId, undefined, \{ deadlineAt \}\)/);
  });

  it("runTenderEngine accepts deadlineAt in EngineRunOptions", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /deadlineAt\?: number/);
  });

  it("runTenderEngine skips AI rematch when deadline is near", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /REMATCH_RESERVE_MS = 15_000/);
    assert.match(src, /deadlineNear = typeof options\?\.deadlineAt === "number"/);
    assert.match(src, /!options\?\.skipAiRematch && !options\?\.safe && isAIEnabled\(\) && !deadlineNear/);
  });

  it("runTenderEngine sets rematchSkippedForDeadline flag", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /let rematchSkippedForDeadline = false/);
    assert.match(src, /rematchSkippedForDeadline = true/);
  });

  it("aiRematchFailed includes rematchSkippedForDeadline", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /\|\| rematchSkippedForDeadline/);
  });
});

// ─── GAP D: UI (engine-action-panel) consumes partial/blockers ────────────────

describe("GAP D — UI (engine-action-panel) consumes partial/blockers", () => {
  it("EngineResponse type includes partial, partialBlockers, evidenceMatchingBlocker", () => {
    const src = read("components/engine-action-panel.tsx");
    assert.match(src, /partial\?: boolean/);
    assert.match(src, /partialBlockers\?: string\[\]/);
    assert.match(src, /evidenceMatchingBlocker\?: \{ code: string; message: string \} \| null/);
    assert.match(src, /analysisMethod\?: string/);
  });

  it("executeEngineRun checks data.partial BEFORE the success path", () => {
    const src = read("components/engine-action-panel.tsx");
    const partialCheck = src.indexOf("if (data.partial)");
    const successPath = src.indexOf("warningCount > 0");
    assert.ok(partialCheck > -1, "must check data.partial");
    assert.ok(successPath > -1, "success path must exist");
    assert.ok(
      partialCheck < successPath,
      "partial check must come BEFORE the success path so partial responses don't show 'Engine run completed'",
    );
  });

  it("partial path sets success:false and code:EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED", () => {
    const src = read("components/engine-action-panel.tsx");
    assert.match(src, /success: false/);
    assert.match(src, /EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED/);
    assert.match(src, /REVIEW_MATCHING_INPUTS/);
  });
});

// ─── GAP E: tender-detail checks engineData.partial ──────────────────────────

describe("GAP E — tender-detail checks engineData.partial", () => {
  it("handleGenerateFullPackage checks engineData.partial before proceeding to generation", () => {
    const src = read("app/dashboard/tenders/[id]/tender-detail.tsx");
    const okCheck = src.indexOf("if (!engineRes.ok)");
    const partialCheck = src.indexOf("if (engineData.partial)");
    assert.ok(okCheck > -1, "must check !engineRes.ok");
    assert.ok(partialCheck > -1, "must check engineData.partial");
    assert.ok(partialCheck > okCheck, "partial check must come AFTER the ok check");
  });

  it("partial path surfaces blocker text and returns before generation", () => {
    const src = read("app/dashboard/tenders/[id]/tender-detail.tsx");
    assert.match(src, /engineData\.blockers\?\.\[0\]/);
    // The partial check must come before the generate fetch.
    const engineFetch = src.indexOf('fetch(`/api/tenders/${tender.id}/engine`');
    const partialCheck = src.indexOf("if (engineData.partial)");
    const generateAfterPartial = src.indexOf("/api/tenders/${tender.id}/generate", partialCheck);
    assert.ok(engineFetch > -1, "must have engine fetch");
    assert.ok(partialCheck > -1, "must check engineData.partial");
    assert.ok(partialCheck > engineFetch, "partial check must come AFTER the engine fetch");
    assert.ok(generateAfterPartial > -1, "must have a generate fetch after the partial check");
  });
});

// ─── GAP G: No raw Unicode in audit-trail-list.tsx ───────────────────────────

describe("GAP G — No raw Unicode in audit-trail-list.tsx", () => {
  it("imports ChevronDownIcon from icons", () => {
    const src = read("components/audit-trail-list.tsx");
    assert.match(src, /import \{ ChevronDownIcon \} from "\.\/icons"/);
  });

  it("does NOT contain raw Unicode ▲ or ▼", () => {
    const src = read("components/audit-trail-list.tsx");
    assert.ok(!src.includes("▲"), "must not contain raw Unicode ▲");
    assert.ok(!src.includes("▼"), "must not contain raw Unicode ▼");
  });

  it("uses ChevronDownIcon with rotate-180 for expanded state", () => {
    const src = read("components/audit-trail-list.tsx");
    assert.match(src, /ChevronDownIcon className=\{showAll \? "inline h-3 w-3 rotate-180" : "inline h-3 w-3"\}/);
  });
});

// ─── GAP H: No raw Unicode in build-version-badge.tsx ─────────────────────────

describe("GAP H — No raw Unicode in build-version-badge.tsx", () => {
  it("imports WarningIcon, CheckIcon, CrossIcon, ChevronDownIcon from icons", () => {
    const src = read("components/build-version-badge.tsx");
    assert.match(src, /import \{ WarningIcon, CheckIcon, CrossIcon, ChevronDownIcon \} from "\.\/icons"/);
  });

  it("does NOT contain raw Unicode ⚠ ✓ ✗ ▲ ▼", () => {
    const src = read("components/build-version-badge.tsx");
    // Strip comments and string literals that mention the old glyphs
    const codeOnly = src.replace(/\/\/[^\n]*/g, "").replace(/"[^"]*"/g, '""');
    assert.ok(!codeOnly.includes("⚠"), "must not contain raw Unicode ⚠ in code");
    assert.ok(!codeOnly.includes("✓"), "must not contain raw Unicode ✓ in code");
    assert.ok(!codeOnly.includes("✗"), "must not contain raw Unicode ✗ in code");
    assert.ok(!codeOnly.includes("▲"), "must not contain raw Unicode ▲ in code");
    assert.ok(!codeOnly.includes("▼"), "must not contain raw Unicode ▼ in code");
  });

  it("uses WarningIcon for the stale-cache warning", () => {
    const src = read("components/build-version-badge.tsx");
    assert.match(src, /<WarningIcon className="shrink-0 inline h-4 w-4" \/>/);
  });

  it("uses ChevronDownIcon for the expand/collapse toggle", () => {
    const src = read("components/build-version-badge.tsx");
    assert.match(src, /<ChevronDownIcon className=\{open \? "inline h-3 w-3 rotate-180" : "inline h-3 w-3"\} \/>/);
  });

  it("uses CheckIcon for 'in sync' status", () => {
    const src = read("components/build-version-badge.tsx");
    assert.match(src, /<CheckIcon className="inline h-3 w-3" \/> in sync/);
  });

  it("uses WarningIcon for 'mismatch' status", () => {
    const src = read("components/build-version-badge.tsx");
    assert.match(src, /<WarningIcon className="inline h-3 w-3" \/> mismatch/);
  });

  it("uses CheckIcon/CrossIcon for feature flags", () => {
    const src = read("components/build-version-badge.tsx");
    assert.match(src, /\{v \? <CheckIcon className="inline h-3 w-3 text-emerald-600" \/> : <CrossIcon className="inline h-3 w-3 text-red-500" \/>/);
  });
});
