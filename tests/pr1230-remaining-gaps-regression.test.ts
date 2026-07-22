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


  it('documents company-document access boundaries for AI Analyze and Run Engine', () => {
    const analysisContent = read('lib/engine/tender-analysis-content.ts');
    const aiAnalyze = read('app/api/tenders/[id]/ai-analyze/route.ts');
    const engine = read('lib/engine/run-tender-engine.ts');
    const compliance = read('lib/engine/compliance.ts');

    assert.ok(analysisContent.includes('COMPANY DOCUMENTS AVAILABLE'));
    assert.ok(analysisContent.includes('[digest:${textDigest}]'));
    assert.ok(aiAnalyze.includes('include: { documents: { select: { category: true, originalFileName: true, extractedText: true } } }'));
    assert.ok(engine.includes('documents: { select: { id: true, category: true, originalFileName: true, extractedText: true } }'));
    assert.ok(engine.includes('documents: company.documents'));
    assert.ok(compliance.includes('knowledge.documents'));
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


  it('does not claim background Engine bypasses Vercel with chunked worker magic', () => {
    const src = read('components/engine-action-panel.tsx');
    assert.equal(count(src, 'chunked sub-jobs'), 0);
    assert.equal(count(src, 'worker continues beyond that'), 0);
    assert.ok(src.includes('50s safety deadline'));
  });

  it('sync and background engine paths share Safe Mode and postcondition contracts', () => {
    const route = read('app/api/tenders/[id]/engine/route.ts');
    const handler = read('lib/ai-job-handlers.ts');
    assert.ok(route.includes('runTenderEngine(id, userId, undefined, { deadlineAt, safe, skipAiRematch })'));
    assert.ok(handler.includes('const deadlineAt = Date.now() + 50_000'));
    assert.ok(handler.includes('{ safe: safeMode, skipAiRematch, maxChars, deadlineAt }'));
    assert.ok(route.includes('const postconditions = await checkEnginePostconditions(id)'));
    assert.ok(handler.includes('const postconditions = await checkEnginePostconditions(ctx.tenderId)'));
    assert.ok(route.includes('code: "ENGINE_COMPLETED_WITH_BLOCKERS"'));
    assert.ok(handler.includes('code: "ENGINE_COMPLETED_WITH_BLOCKERS"'));
    assert.ok(route.includes('failedStage: "POSTCONDITION_VALIDATE"'));
    assert.ok(handler.includes('failedStage: "POSTCONDITION_VALIDATE"'));
  });

  it('continues automatic background Engine runs into source-grounded Build Plan auto-confirmation only after postconditions pass', () => {
    const handler = read('lib/ai-job-handlers.ts');
    const postconditionIndex = handler.indexOf('const postconditions = await checkEnginePostconditions(ctx.tenderId)');
    const buildPlanIndex = handler.indexOf('const buildPlanDraft = await buildDraftBuildPlan(prisma, ctx.tenderId, ctx.userId)');
    assert.ok(handler.includes('import { buildDraftBuildPlan, computeTenderBuildPlanHash, validateBuildPlanForConfirmation } from "./engine/build-plan";'));
    assert.ok(postconditionIndex >= 0 && buildPlanIndex > postconditionIndex, 'Build Plan draft must run only after Engine postconditions pass');
    assert.ok(handler.includes('validating for source-grounded auto-confirmation'));
    assert.ok(handler.includes('document generation remains separately gated'));
    assert.ok(handler.includes('SUBMISSION_PLAN_CONFIRMED'));
    assert.ok(handler.includes('auto-confirmed after background Engine postconditions'));
    assert.ok(handler.includes('buildPlanDraft: { ok: false'));
    assert.ok(handler.includes('autoConfirmed: true'));
    assert.ok(handler.includes('autoConfirmed: false'));
    assert.equal(handler.includes('enqueueJob({ userId: ctx.userId, tenderId: ctx.tenderId, jobType: "PROPOSAL_GENERATION"'), false, 'background Engine must not enqueue generation directly');
  });

  it('uses canonical Safe Mode parameters for upload-triggered automatic Engine runs', () => {
    const upload = read('lib/secure-upload-handler.ts');
    assert.ok(upload.includes('jobType: "ENGINE_RUN"'));
    assert.ok(upload.includes('input: { safe: true, skipAiRematch: true, source: "secure-upload" }'));
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

describe('PR 1230 final-package download gate', () => {
  it('keeps TenderDownloadActionsPanel inside Stage 5 final-package workflow', () => {
    const src = read('app/dashboard/tenders/[id]/page.tsx');
    const stage5 = src.indexOf('number={5}');
    const panel = src.indexOf('<TenderDownloadActionsPanel');
    const stageClose = src.indexOf('</WorkflowStage>', panel);
    assert.ok(stage5 >= 0, 'Stage 5 must exist');
    assert.ok(panel > stage5, 'download panel must be rendered after Stage 5 starts');
    assert.ok(stageClose > panel, 'download panel must be inside the Stage 5 WorkflowStage');
  });

  it('does not render direct ungated proposal/requirements/compliance download links', () => {
    const src = read('components/tender-download-actions-panel.tsx');
    assert.equal(count(src, 'download?type=proposal'), 0);
    assert.equal(count(src, 'download?type=requirements'), 0);
    assert.equal(count(src, 'download?type=compliance'), 0);
  });


  it('keeps final ZIP downloads owned by the Stage 5 final-package panel only', () => {
    const exportPanel = read('components/export-readiness-panel.tsx');
    assert.equal(count(exportPanel, 'download?type=zip'), 0);
    assert.ok(exportPanel.includes('href="#final-package-download-actions"'));
    const tenderPage = read('app/dashboard/tenders/[id]/page.tsx');
    assert.ok(tenderPage.includes('<TenderDownloadActionsPanel'));
    const downloadPanel = read('components/tender-download-actions-panel.tsx');
    assert.ok(downloadPanel.includes('href={`/api/tenders/${tenderId}/download?type=zip`}'));
  });

  it('renders no final ZIP href until final-package gates pass', () => {
    const src = read('components/tender-download-actions-panel.tsx');
    assert.ok(src.includes('finalPackageGatesPassed(model)'));
    assert.ok(src.includes('requiredCount > 0'));
    assert.ok(src.includes('model.export?.zipReady === true'));
    assert.ok(src.includes('model.export?.manifest?.ready === true'));
    assert.ok(src.includes('model.export?.requiredPdfMissing !== true'));
    assert.ok(src.includes('Download blocked — final package gates not passed'));
    assert.ok(src.includes('href={`/api/tenders/${tenderId}/download?type=zip`}'));
  });
});
