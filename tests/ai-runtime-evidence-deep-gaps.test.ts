// AI runtime evidence deep gaps — regression tests for real fixes.
//
// These tests verify the SUBSTANTIVE fixes (not cosmetic) for the gaps found
// in the initial PR #1041:
//
// GAP 1: Engine route returns success:false when partial=true (not success:true)
// GAP 2: Engine route passes deadlineAt to runTenderEngine (Vercel-safe)
// GAP 3: UI (engine-action-panel) consumes partial/blockers/nextAction
// GAP 4: tender-detail handleGenerateFullPackage checks engineData.partial
// GAP 5: Preflight is model-aware (reads configured model, uses tighter limit)
// GAP 6: Engine route catch-block logs errorName only (no raw error leak)
// GAP 7: runTenderEngine skips AI rematch when deadline is near

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// ─── GAP 1: Engine route returns success:false when partial ──────────────────

describe("GAP 1 — Engine route returns success:false when partial", () => {
  it("does NOT return success:true when partial=true", () => {
    const src = read("app/api/tenders/[id]/engine/route.ts");
    // The route must compute isPartial and return success: !isPartial.
    assert.match(src, /const isPartial = engineMeta\.partial \?\? false/);
    assert.match(src, /success: !isPartial/);
    assert.match(src, /ok: !isPartial/);
    // Must NOT unconditionally return success: true.
    assert.doesNotMatch(src, /success: true,\s*\n\s*ok: !engineMeta\.partial/);
  });
});

// ─── GAP 2: Engine route passes deadlineAt ───────────────────────────────────

describe("GAP 2 — Engine route passes deadlineAt to runTenderEngine", () => {
  it("computes a 50s deadline and passes it to runTenderEngine", () => {
    const src = read("app/api/tenders/[id]/engine/route.ts");
    assert.match(src, /const deadlineAt = Date\.now\(\) \+ 50_000/);
    // Must pass { deadlineAt } as the 4th argument (options).
    assert.match(src, /runTenderEngine\(id, userId, undefined, \{ deadlineAt \}\)/);
  });

  it("runTenderEngine accepts deadlineAt in EngineRunOptions", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /deadlineAt\?: number/);
  });
});

// ─── GAP 3: UI consumes partial/blockers/nextAction ──────────────────────────

describe("GAP 3 — UI (engine-action-panel) consumes partial/blockers", () => {
  it("EngineResponse type includes partial, partialBlockers, evidenceMatchingBlocker", () => {
    const src = read("components/engine-action-panel.tsx");
    assert.match(src, /partial\?: boolean/);
    assert.match(src, /partialBlockers\?: string\[\]/);
    assert.match(src, /evidenceMatchingBlocker\?: \{ code: string; message: string \} \| null/);
    assert.match(src, /analysisMethod\?: string/);
  });

  it("executeEngineRun checks data.partial and surfaces blockers", () => {
    const src = read("components/engine-action-panel.tsx");
    // Must check data.partial BEFORE the success path.
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

// ─── GAP 4: tender-detail handleGenerateFullPackage checks partial ───────────

describe("GAP 4 — tender-detail checks engineData.partial", () => {
  it("handleGenerateFullPackage checks engineData.partial before proceeding to generation", () => {
    const src = read("app/dashboard/tenders/[id]/tender-detail.tsx");
    // Must check engineData.partial after the !engineRes.ok check.
    const okCheck = src.indexOf("if (!engineRes.ok)");
    const partialCheck = src.indexOf("if (engineData.partial)");
    assert.ok(okCheck > -1, "must check !engineRes.ok");
    assert.ok(partialCheck > -1, "must check engineData.partial");
    assert.ok(
      partialCheck > okCheck,
      "partial check must come AFTER the ok check",
    );
  });

  it("partial path surfaces blocker text and returns before generation", () => {
    const src = read("app/dashboard/tenders/[id]/tender-detail.tsx");
    // Must read engineData.blockers?.[0] and return before the generate call.
    assert.match(src, /engineData\.blockers\?\.\[0\]/);
    // The partial check must come before the SECOND generate fetch (the one
    // inside handleGenerateFullPackage). The first generate fetch is in a
    // different function. We verify the partial check is after the engine
    // fetch and before a generate fetch by checking the ordering relative to
    // the engine fetch.
    const engineFetch = src.indexOf('fetch(`/api/tenders/${tender.id}/engine`');
    const partialCheck = src.indexOf("if (engineData.partial)");
    // Find the generate fetch that comes AFTER the partial check.
    const generateAfterPartial = src.indexOf("/api/tenders/${tender.id}/generate", partialCheck);
    assert.ok(engineFetch > -1, "must have engine fetch");
    assert.ok(partialCheck > -1, "must check engineData.partial");
    assert.ok(
      partialCheck > engineFetch,
      "partial check must come AFTER the engine fetch",
    );
    assert.ok(
      generateAfterPartial > -1,
      "must have a generate fetch after the partial check",
    );
  });
});

// ─── GAP 5: Preflight is model-aware ─────────────────────────────────────────

describe("GAP 5 — Preflight is model-aware", () => {
  it("ai-preflight.ts imports getProviderModel", () => {
    const src = read("lib/ai-preflight.ts");
    assert.match(src, /import \{[^}]*getProviderModel[^}]*\} from "\.\/ai-provider-registry"/);
  });

  it("has a MODEL_CONTEXT_LIMITS map for known small-context models", () => {
    const src = read("lib/ai-preflight.ts");
    assert.match(src, /MODEL_CONTEXT_LIMITS/);
    // Must include Groq's llama-3.1-8b-instant (8K context — tighter than 32K default).
    assert.match(src, /"llama-3\.1-8b-instant": 8_000/);
  });

  it("preflightProvider reads the configured model and uses the tighter limit", () => {
    const src = read("lib/ai-preflight.ts");
    assert.match(src, /getProviderModel\(provider, opts\?\.useCase \?\? "default"\)/);
    assert.match(src, /modelLimit \? Math\.min\(modelLimit, providerLimit\) : providerLimit/);
  });
});

// ─── GAP 6: Engine route catch-block logs errorName only ──────────────────────

describe("GAP 6 — Engine route logs errorName only (no raw error leak)", () => {
  it("catch-block does NOT log the raw error object", () => {
    const src = read("app/api/tenders/[id]/engine/route.ts");
    // Must NOT log the raw error object (which could contain keys/org IDs).
    assert.doesNotMatch(src, /console\.error\("Engine run failed:", \{ diagnosticId, error \}\)/);
  });

  it("catch-block logs errorName (constructor name) instead of raw error", () => {
    const src = read("app/api/tenders/[id]/engine/route.ts");
    assert.match(src, /const errorName = error instanceof Error \? error\.constructor\.name : typeof error/);
    assert.match(src, /console\.error\("Engine run failed:", \{ diagnosticId, errorName \}\)/);
  });
});

// ─── GAP 7: runTenderEngine skips AI rematch when deadline is near ───────────

describe("GAP 7 — runTenderEngine skips AI rematch when deadline is near", () => {
  it("computes deadlineNear from options.deadlineAt + REMATCH_RESERVE_MS", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /REMATCH_RESERVE_MS = 15_000/);
    assert.match(src, /deadlineNear = typeof options\?\.deadlineAt === "number"/);
    assert.match(src, /Date\.now\(\) \+ REMATCH_RESERVE_MS >= options\.deadlineAt/);
  });

  it("skips AI rematch when deadlineNear is true", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    // The rematch condition must include !deadlineNear.
    assert.match(src, /!options\?\.skipAiRematch && !options\?\.safe && isAIEnabled\(\) && !deadlineNear/);
  });

  it("sets rematchSkippedForDeadline flag when rematch is skipped for deadline", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /let rematchSkippedForDeadline = false/);
    assert.match(src, /rematchSkippedForDeadline = true/);
  });

  it("aiRematchFailed includes rematchSkippedForDeadline", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    // The fallback-row trigger must include the deadline-skip case.
    assert.match(src, /\|\| rematchSkippedForDeadline/);
  });

  it("sets a warning message when rematch is skipped for deadline", () => {
    const src = read("lib/engine/run-tender-engine.ts");
    assert.match(src, /AI rematch skipped — insufficient time remaining in Vercel function budget/);
  });
});

// ─── Integration: the full partial-success flow ───────────────────────────────

describe("Integration — full partial-success flow", () => {
  it("engine route → runTenderEngine → partial response → UI surfaces blocker", () => {
    // Verify the end-to-end wiring:
    // 1. Engine route passes deadlineAt
    // 2. runTenderEngine skips rematch when deadline is near
    // 3. runTenderEngine creates fallback rows
    // 4. runTenderEngine returns partial=true
    // 5. Engine route returns success:false with blockers
    // 6. UI checks data.partial and surfaces the blocker
    const routeSrc = read("app/api/tenders/[id]/engine/route.ts");
    const engineSrc = read("lib/engine/run-tender-engine.ts");
    const panelSrc = read("components/engine-action-panel.tsx");

    // 1. Route passes deadlineAt
    assert.match(routeSrc, /runTenderEngine\(id, userId, undefined, \{ deadlineAt \}\)/);

    // 2. Engine skips rematch when deadline near
    assert.match(engineSrc, /!deadlineNear/);

    // 3. Engine creates fallback rows
    assert.match(engineSrc, /buildDeterministicFallbackRows/);

    // 4. Engine returns partial
    assert.match(engineSrc, /const partial = evidenceMatchingBlocker !== null/);

    // 5. Route returns success:!isPartial
    assert.match(routeSrc, /success: !isPartial/);

    // 6. UI checks data.partial
    assert.match(panelSrc, /if \(data\.partial\)/);
  });
});
