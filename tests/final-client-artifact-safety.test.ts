import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_TRACE_PATTERNS } from '../lib/engine/detection-patterns';
import { formatSubmissionDeadline } from '../lib/engine/benchmark-tables';
import { assessGeneratedDocumentQuality } from '../lib/engine/document-quality-gate';
import { stripInternalReviewSections } from '../lib/engine/internal-review-stripper';
import { disambiguateRepeatedHeadings } from '../lib/engine/generate-elite';

const internalSections = [
  '## Proposal Evaluator Loop\n\nPrivate evaluator simulation.',
  '## SECTION H: PROPOSAL SELF-SCORE\n\nPredicted score 98/100.',
  '## Compliance and Bid Review Strategy\n\nBid-team review notes.',
  '## Tender Proposal AI-Ready Summary\n\nPrepared for AI-assisted tender proposal generation.',
  '## Annex & Appendix Readiness Register\n\nAttach vault records later.',
].join('\n\n');

test('the final internal-section sweep removes evaluator, self-score, AI-preparation, and bid-review scaffolding', () => {
  const result = stripInternalReviewSections(
    `# Technical Proposal\n\nClient content.\n\n${internalSections}\n\n# Declaration\n\nAccurate and source-grounded.`
  );
  assert.equal(result.removedSections.length, 5);
  assert.doesNotMatch(
    result.markdown,
    /Evaluator Loop|Self-Score|Bid Review Strategy|AI-Ready|Readiness Register/i
  );
  assert.match(result.markdown, /Client content/);
  assert.match(result.markdown, /# Declaration/);
});

test('client-artifact AI trace patterns cover internal proposal-production language', () => {
  for (const phrase of [
    'Prepared for AI-assisted tender proposal generation',
    'Tender Proposal AI-Ready Summary',
    'Proposal Evaluator Loop',
    'Proposal Self-Score',
    'Compliance and Bid Review Strategy',
  ])
    assert.ok(
      AI_TRACE_PATTERNS.some((pattern) => pattern.test(phrase)),
      phrase
    );
});

test('quality gate blocks unproven continuity, phantom appendices, and truncated submission metadata', () => {
  const report = assessGeneratedDocumentQuality({
    doc: {
      name: 'Technical Proposal',
      exactFileName: 'Technical Proposal.docx',
      documentType: 'TECHNICAL_PROPOSAL',
      format: 'DOCX',
    },
    visibleText: [
      '# Technical Proposal',
      'The firm has already delivered this assignment twice.',
      'The same project team is available with zero learning curve.',
      'Credentials and testimony letters are attached in the appendices.',
      'Submission Address / Portal: No physical address or portal i',
      'This substantive methodology description is intentionally long enough for the quality assessor to inspect.',
    ].join('\n\n'),
    rawFileContent: 'bytes',
  });
  assert.equal(report.recommendedStatus, 'QUALITY_FAILED');
  assert.ok(
    report.issues.some(
      (issue) => issue.code === 'UNSUPPORTED_CLAIM_RISK' && issue.severity === 'HIGH'
    )
  );
  assert.ok(
    report.issues.some((issue) => issue.code === 'PLACEHOLDER' && issue.severity === 'HIGH')
  );
});

test('submission deadline uses grounded time and never invents midnight from a date-only value', () => {
  assert.equal(
    formatSubmissionDeadline(
      new Date('2026-08-25T00:00:00.000Z'),
      'Submission Deadline: 25 August 2026 at 5:00 PM Addis Ababa time'
    ),
    '25 August 2026 5:00 PM Addis Ababa time'
  );
  assert.equal(
    formatSubmissionDeadline(
      new Date('2026-08-25T00:00:00.000Z'),
      'Submission Deadline: August 25, 2026, 5:00 PM Addis Ababa Time'
    ),
    '25 August 2026 5:00 PM Addis Ababa Time'
  );
  assert.equal(
    formatSubmissionDeadline(new Date('2026-08-25T00:00:00.000Z'), null),
    '25 August 2026'
  );
});

test('late generated headings are disambiguated before client rendering', () => {
  const result = disambiguateRepeatedHeadings('# Technical Proposal\n\n# Technical Proposal\n\n# Technical Proposal');
  assert.equal((result.match(/^# Technical Proposal$/gm) ?? []).length, 1);
  assert.match(result, /Technical Proposal — Continued 2/);
  assert.match(result, /Technical Proposal — Continued 3/);
});
