import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const count = (source: string, pattern: string | RegExp) =>
  typeof pattern === 'string'
    ? source.split(pattern).length - 1
    : (source.match(pattern) ?? []).length;

describe('PR 1230 remaining gap fixes', () => {
  it('maps canonical Next Required Actions to real recovery panels and never falls back to tender files for unknowns', () => {
    const src = read('components/next-action-panel.tsx');
    assert.ok(src.includes("EDIT_TENDER_METADATA: '#tender-edit-form'"));
    assert.ok(src.includes("FINALIZE_REQUIRED_PDF: '#generated-documents'"));
    assert.ok(src.includes('function targetFromCanonicalAction(action: string): string | null'));
    assert.ok(src.includes('return ACTION_TARGETS[action] ?? null'));
    assert.ok(src.includes('No shortcut is available for this action yet'));
    assert.equal(count(src, "?? '#tender-files'"), 0, 'unknown actions must not fall back to tender files');
  });

  it('engine route supports real async ENGINE_RUN queueing with Safe Mode parameters', () => {
    const src = read('app/api/tenders/[id]/engine/route.ts');
    assert.ok(src.includes('enqueueJob'));
    assert.ok(src.includes('findActiveEngineRunForTender'));
    assert.ok(src.includes('const asyncRun = isTrue(searchParams.get("async"))'));
    assert.ok(src.includes('const safe = isTrue(searchParams.get("safe"))'));
    assert.ok(src.includes('const skipAiRematch = isTrue(searchParams.get("skipAiRematch"))'));
    assert.ok(src.includes('jobType: "ENGINE_RUN"'));
    assert.ok(src.includes('input: { safe, skipAiRematch, source: "engine-route" }'));
    assert.ok(src.includes('{ status: 202 }'));
  });

  it('sync and background engine paths share Safe Mode and postcondition contracts', () => {
    const route = read('app/api/tenders/[id]/engine/route.ts');
    const handler = read('lib/ai-job-handlers.ts');
    assert.ok(route.includes('runTenderEngine(id, userId, undefined, { deadlineAt, safe, skipAiRematch })'));
    assert.ok(handler.includes('{ safe: safeMode, skipAiRematch, maxChars }'));
    assert.ok(route.includes('const postconditions = await checkEnginePostconditions(id)'));
    assert.ok(handler.includes('const postconditions = await checkEnginePostconditions(ctx.tenderId)'));
    assert.ok(route.includes('code: "ENGINE_COMPLETED_WITH_BLOCKERS"'));
    assert.ok(handler.includes('code: "ENGINE_COMPLETED_WITH_BLOCKERS"'));
    assert.ok(route.includes('failedStage: "POSTCONDITION_VALIDATE"'));
    assert.ok(handler.includes('failedStage: "POSTCONDITION_VALIDATE"'));
  });

  it('AI job list route recognizes ENGINE_RUN status polling filters', () => {
    const src = read('app/api/ai-jobs/route.ts');
    assert.ok(src.includes('"ENGINE_RUN"'));
    assert.ok(src.includes('"AI_ANALYZE"'));
  });

  it('preserves minimal visible action constraints', () => {
    const next = read('components/next-action-panel.tsx');
    const engine = read('components/engine-action-panel.tsx');
    const exportPanel = read('components/export-readiness-panel.tsx');
    assert.equal(count(next, 'View all workflow steps'), 1);
    assert.equal(count(engine, 'Run Full AI in Background'), 1);
    assert.ok(engine.includes('Run Safe Mode — Recommended'));
    assert.equal(count(exportPanel, /\{primaryRepair && \(/g), 1);
    assert.equal(count(exportPanel, 'Advanced Repairs'), 1);
  });
});
