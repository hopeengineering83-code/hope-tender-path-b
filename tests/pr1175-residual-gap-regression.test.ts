import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const count = (source: string, pattern: string | RegExp) =>
  typeof pattern === 'string'
    ? source.split(pattern).length - 1
    : (source.match(pattern) ?? []).length;

describe('PR 1175 residual workflow/action gaps', () => {
  it('shows one visible primary next action and collapses the full workflow step list', () => {
    const src = read('components/next-action-panel.tsx');
    assert.equal(count(src, 'View all workflow steps'), 1);
    assert.ok(
      src.includes('href={actionTarget}'),
      'primary next-action link must target the canonical action owner'
    );
    assert.ok(src.includes('<details'), 'all workflow steps must be collapsed by default');
    assert.ok(
      !src.includes('aria-label="Tender workflow shortcuts"'),
      'always-visible workflow shortcut pills must not remain'
    );
  });

  it('places NextActionPanel before Stage 1 and before secondary action centers', () => {
    const src = read('app/dashboard/tenders/[id]/page.tsx');
    assert.ok(
      src.indexOf('<NextActionPanel') < src.indexOf('<TenderWorkflowActionCenter'),
      'NextActionPanel must be before secondary workflow controls'
    );
    assert.ok(
      src.indexOf('<NextActionPanel') < src.indexOf('<WorkflowStage'),
      'NextActionPanel must appear before Stage 1'
    );
  });

  it('keeps exactly two normal engine actions and one shared running state', () => {
    const src = read('components/engine-action-panel.tsx');
    assert.equal(
      count(src, 'Run Safe Mode — Recommended'),
      2,
      'one button label plus one explanatory mention is expected'
    );
    assert.equal(count(src, 'Run Full AI in Background'), 1);
    assert.ok(!src.includes('Run full mode anyway'));
    assert.ok(!src.includes('Skip AI Rematch'));
    assert.equal(
      count(src, 'useState(false)'),
      1,
      'engine panel should keep one shared running boolean'
    );
    assert.equal(
      count(src, "{running || isPending ? 'Running…'"),
      0,
      'both engine action buttons must not independently render identical Running labels'
    );
    assert.equal(
      count(src, 'Engine running…'),
      1,
      'engine panel must render one shared running affordance while a run is active'
    );
  });

  it('centralizes Safe Mode parameter parity for all safe-mode paths', () => {
    const src = read('components/engine-action-panel.tsx');
    assert.ok(src.includes('CANONICAL_SAFE_MODE_PARAMS'));
    assert.ok(src.includes("safe: 'true'"));
    assert.ok(src.includes("skipAiRematch: 'true'"));
    assert.equal(count(src, /runEngineAsync\(false, canonicalSafeModeParams\(\)\)/g), 2);
    assert.equal(count(src, /runEngineAsync\(false, \{ safe:/g), 0);
    assert.equal(count(src, /runEngineAsync\(false, \{ skipAiRematch:/g), 0);
  });

  it('has no stale Recovery Command Center below guidance', () => {
    for (const file of [
      'components/engine-action-panel.tsx',
      'components/export-readiness-panel.tsx',
    ]) {
      const src = read(file);
      assert.ok(
        !/Recovery Command Center below/i.test(src),
        `${file} must not mention Recovery Command Center below`
      );
      assert.ok(
        !/Recovery Command Center and readiness panels below/i.test(src),
        `${file} must not use stale below guidance`
      );
    }
    assert.ok(read('components/engine-action-panel.tsx').includes('Next Required Action above'));
  });

  it('shows one primary Export Readiness repair and collapses secondary tools', () => {
    const src = read('components/export-readiness-panel.tsx');
    assert.equal(count(src, /\{primaryRepair && \(/g), 1);
    assert.equal(count(src, 'View Advanced'), 1);
    assert.ok(src.includes('id="export-advanced-repairs"'));
    assert.ok(
      !src.includes('Generate missing planned docs</button>'),
      'Export Readiness must not own duplicate missing-plan POST action'
    );
    assert.ok(
      !src.includes('Retry AI Analysis</button>'),
      'Export Readiness must not own duplicate AI Analyze POST action'
    );
    assert.ok(
      !src.includes('Approve fallback analysis (manual review)</button>'),
      'Export Readiness must not own duplicate fallback approval POST action'
    );
  });

  it('does not duplicate canonical mutation routes from Export Readiness', () => {
    const src = read('components/export-readiness-panel.tsx');
    for (const route of [
      '/generate-missing-plan-files',
      '/auto-finalize',
      '/ai-analyze',
      '/approve-analysis',
    ]) {
      assert.equal(
        count(src, route),
        0,
        `Export Readiness must link to canonical owner instead of POSTing ${route}`
      );
    }
    assert.ok(src.includes('href="#ai-analyze-section"'));
    assert.ok(!src.includes('data-canonical-owner="#ai-analyze-section"'));
    assert.ok(src.includes("href: '#generated-documents'"));
  });


  it('requires genuine reviewer notes for every manual approval path', () => {
    const exportPanel = read('components/export-readiness-panel.tsx');
    const advisoryRoute = read('app/api/tenders/[id]/advisory-resolutions/route.ts');
    const reviewPanel = read('components/document-review-panel.tsx');
    const documentRoute = read('app/api/tenders/[id]/documents/[docId]/route.ts');

    assert.ok(exportPanel.includes('Reviewer note required before advisory resolution'));
    assert.ok(exportPanel.includes('advisoryNote.length < 10'));
    assert.ok(exportPanel.includes('JSON.stringify({ code, resolution, note })'));
    assert.ok(advisoryRoute.includes('REVIEWER_NOTE_REQUIRED'));
    assert.ok(advisoryRoute.includes('note.length < 10'));

    assert.ok(reviewPanel.includes('Reviewer note required for approval / ready-for-export actions'));
    assert.ok(reviewPanel.includes('actionNote.trim().length < 10'));
    assert.ok(documentRoute.includes('REVIEWER_NOTE_REQUIRED'));
    assert.ok(documentRoute.includes('newStatus === "APPROVED" || newStatus === "READY_FOR_EXPORT"'));
  });

  it('uses distinct semantic icons for unrelated advanced repair actions', () => {
    const src = read('components/export-readiness-panel.tsx');
    for (const icon of [
      'CheckCircleIcon',
      'PaperclipIcon',
      'LightbulbIcon',
      'UploadIcon',
      'BanIcon',
      'WarningIcon',
      'CrossIcon',
    ]) {
      assert.ok(src.includes(`<${icon} />`), `${icon} must be used as a semantic action icon`);
    }
  });

  it('keeps desktop/tablet/mobile navigation free of duplicate Quick Engine Access shortcuts', () => {
    const dashboard = read('app/dashboard/page.tsx');
    const tender = read('app/dashboard/tenders/[id]/page.tsx');
    assert.ok(!dashboard.includes('Quick Engine Access'));
    assert.equal(count(dashboard, 'Open Tender Workspace'), 1);
    assert.ok(tender.includes('Tender workflow stages'));
    assert.ok(tender.includes('Each major action appears once'));
  });
});
