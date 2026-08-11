import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeBidStrategy, type BidStrategyInput } from '../lib/engine/bid-strategy';
import {
  deriveControlSuggestions,
  type SuggestionDerivationInput,
} from '../lib/engine/tender-control-suggestions';
import { operatorMatchReason } from '../components/matching-selected-evidence-panel';

const read = (path: string) => readFileSync(path, 'utf8');

function strategyFixture(): BidStrategyInput {
  const requirements = Array.from({ length: 4 }, (_, index) => ({
    title: `Mandatory ${index + 1}`,
    description: 'Relevant technical experience and delivery methodology',
    requirementType: 'METHODOLOGY',
    priority: 'MANDATORY',
  }));
  return {
    tender: {
      id: '2-full-2-partial',
      title: 'Evidence-limited competitive tender',
      requirements,
      complianceGaps: [],
      expertMatches: [],
      projectMatches: [
        {
          score: 1,
          isSelected: true,
          project: {
            name: 'Comparable delivery',
            trustLevel: 'SOURCE_VERIFIED',
            sector: 'Services',
            serviceAreas: '["delivery"]',
          },
        },
      ],
      evaluationMethodology:
        'Technical capability, relevant experience, methodology, and delivery quality are evaluated.',
      analysisSource: 'AI_VERIFIED',
      evidenceCoverageRatio: 0.5,
      evidenceProgressRatio: 0.75,
    },
    company: {
      name: 'Source-backed company',
      sectors: '["Services"]',
      serviceLines: '["delivery"]',
      expertCount: 8,
      projectCount: 8,
      legalRecordCount: 1,
      financialRecordCount: 1,
    },
  };
}

function controlsFixture(): SuggestionDerivationInput {
  return {
    canonicalDecision: {
      nextRequiredAction: 'LINK_VAULT_EVIDENCE',
      nextRequiredActionLabel: 'Source evidence required',
      nextRequiredActionReason:
        '2/4 mandatory requirements are release-qualified; 2 have partial evidence.',
    },
    metadataStatus: { criticalMissing: ['deadline'] },
    analysisStatus: { source: 'AI_VERIFIED' },
    sourceReferenceStatus: { ungroundedMandatoryCount: 0, totalMandatoryCount: 4 },
    planStatus: { hasExplicitPlan: true, totalRequired: 5, totalMissing: 5, totalOutsidePlan: 0 },
    evidenceStatus: { totalRequirements: 4, requirementsWithLinkedEvidence: 4 },
    counts: { finalExportCandidates: 0, qualityFailedCandidates: 0, outsidePlanRows: 0 },
    providerStatus: { hasAnyProvider: true, hasCooledDownProvider: false },
  };
}

describe('final remaining-gap architecture', () => {
  it('upload surfaces own extraction only and never advertise or create AI_ANALYZE', () => {
    const uploadSources = [
      'app/dashboard/tenders/new/page.tsx',
      'components/tender-source-files-panel.tsx',
      'lib/tender-upload-first.ts',
      'lib/secure-upload-handler.ts',
      'app/api/tenders/upload-first/route.ts',
      'app/api/upload/route.ts',
    ]
      .map(read)
      .join('\n');
    assert.doesNotMatch(
      uploadSources,
      /AI_ANALYZE_QUEUED|automatically queues AI analysis|analysis will follow automatically|All records are auto-approved/
    );
    assert.doesNotMatch(
      read('lib/tender-upload-first.ts') + read('lib/secure-upload-handler.ts'),
      /createAnalysisJob\(\{/
    );
    assert.match(
      read('lib/ai-jobs/tender-extraction-service.ts'),
      /EXTRACTION_COMPLETE_MANUAL_AI_ANALYZE_REQUIRED/
    );
    assert.match(read('app/api/tenders/[id]/manual-ai-analyze/route.ts'), /createAnalysisJob\(\{/);
    assert.match(read('app/api/tenders/[id]/manual-ai-analyze/route.ts'), /manualAuthority:/);
  });

  it('canonical workflow supplies exactly one current Tender Control', () => {
    const controls = deriveControlSuggestions(controlsFixture());
    assert.equal(controls.length, 1);
    assert.equal(controls[0]?.title, 'Source evidence required');
    assert.doesNotMatch(
      JSON.stringify(controls),
      /Generate Docs|Generate missing planned|Generate or attach|approve fallback|Repair all empty|Confirm reviewed/i
    );
    const route = read('app/api/tenders/[id]/controls/route.ts');
    assert.match(route, /getCanonicalTenderWorkflowDecision/);
    assert.doesNotMatch(route, /prisma\.tender\.update/);
  });

  it('2 FULL plus 2 PARTIAL produces evidence-limited strategy, not BID HARD', () => {
    const strategy = computeBidStrategy(strategyFixture());
    assert.equal(strategy.dimensionScores.complianceReadiness, 55);
    assert.ok(strategy.winProbability <= 64);
    assert.notEqual(strategy.recommendation, 'BID_HARD');
  });

  it('matching labels relevance and sanitizes scoring internals', () => {
    const panel = read('components/matching-selected-evidence-panel.tsx');
    assert.match(panel, /Match relevance/);
    assert.match(
      panel,
      /Relevance score only — requirement coverage and release readiness are measured separately/
    );
    assert.doesNotMatch(panel, /Linked · \{Math\.round/);
    assert.equal(
      operatorMatchReason({
        id: 'x',
        name: 'x',
        subtitle: null,
        score: 1,
        rationale: 'embedding lexical-cycle-22 provider token similarity',
        isSelected: true,
        trustLevel: 'SOURCE_VERIFIED',
      }),
      'Relevant source-verified company evidence'
    );
  });

  it('coverage separates release qualification from partial progress', () => {
    const panel = read('components/requirement-coverage-panel.tsx');
    assert.match(panel, /Release-qualified coverage:/);
    assert.match(panel, /Progress including partial evidence:/);
    assert.match(panel, /Partial evidence exists/);
    assert.doesNotMatch(panel, /unresolved requirements are genuine gaps or stale evidence/);
  });

  it('release status promotes only the canonical current blocker', () => {
    const panel = read('components/generation-action-panel.tsx');
    assert.match(panel, /canonicalCurrentBlocker/);
    assert.match(panel, /Current blocker/);
    assert.doesNotMatch(panel, />Pending items</);
  });

  it('Vault normal UX is simple and implementation details are collapsed', () => {
    const vault = read('components/company-vault-verification-page.tsx');
    assert.match(vault, /Verified records are usable automatically/);
    assert.match(vault, /Needs source or Invalid \/ stale/);
    assert.match(
      vault,
      /<summary className="cursor-pointer font-semibold">Technical details<\/summary>/
    );
  });
});
