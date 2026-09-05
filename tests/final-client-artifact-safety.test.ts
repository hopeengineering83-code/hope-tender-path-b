import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_TRACE_PATTERNS } from '../lib/engine/detection-patterns';
import { formatSubmissionDeadline } from '../lib/engine/benchmark-tables';
import { assessGeneratedDocumentQuality } from '../lib/engine/document-quality-gate';
import { stripInternalReviewSections } from '../lib/engine/internal-review-stripper';
import { disambiguateRepeatedHeadings } from '../lib/engine/generate-elite';
import { buildProposalIntelligence } from '../lib/engine/proposal-intelligence';
import { cleanClientName } from '../lib/engine/proposal-labels';
import { buildProposedTeamTable } from '../lib/engine/benchmark-tables';
import { buildPrincipalQualificationsSection } from '../lib/engine/principal-qualifications';
import { readFileSync } from 'node:fs';

const internalSections = [
  '## Proposal Evaluator Loop\n\nPrivate evaluator simulation.',
  '## SECTION H: PROPOSAL SELF-SCORE\n\nPredicted score 98/100.',
  '## Compliance and Bid Review Strategy\n\nBid-team review notes.',
  '## Tender Proposal AI-Ready Summary\n\nPrepared for AI-assisted tender proposal generation.',
  '## Annex & Appendix Readiness Register\n\nAttach vault records later.',
  '## Appendix Register\n\nAppendix A: documents not in the package.',
].join('\n\n');

test('the final internal-section sweep removes evaluator, self-score, AI-preparation, and bid-review scaffolding', () => {
  const result = stripInternalReviewSections(
    `# Technical Proposal\n\nClient content.\n\n${internalSections}\n\n# Declaration\n\nAccurate and source-grounded.`
  );
  assert.equal(result.removedSections.length, 6);
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

test('quality gate blocks visibly broken email-submission rows', () => {
  const report = assessGeneratedDocumentQuality({
    doc: { name: 'Technical Proposal', exactFileName: 'Technical Proposal.pdf', documentType: 'TECHNICAL_PROPOSAL', format: 'PDF' },
    visibleText: `${'# Technical Proposal\n\n'}${'Source-grounded methodology and delivery detail. '.repeat(80)}\nSubmission Email(s): edessalegn@pharoventures.com; fgetach.`,
    rawFileContent: '%PDF-bytes',
  });
  assert.ok(report.issues.some((issue) => issue.code === 'PLACEHOLDER' && issue.severity === 'HIGH'));
  assert.equal(report.recommendedStatus, 'QUALITY_FAILED');
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

test('repeated all-caps table values are not misclassified as duplicate section headings', () => {
  const report = assessGeneratedDocumentQuality({
    doc: { name: 'Technical Proposal', exactFileName: 'Technical Proposal.docx', documentType: 'TECHNICAL_PROPOSAL', format: 'DOCX' },
    visibleText: `${'# Technical Proposal\n# Executive Summary\n# Methodology\n# Work Plan\n# Team\n# Risk\n# Quality Assurance\n'}${'MANDATORY\nSCORED\n'.repeat(4)}${'Substantive source-grounded methodology and delivery detail. '.repeat(140)}`,
    rawFileContent: 'bytes',
  });
  assert.ok(!report.issues.some((issue) => issue.code === 'DUPLICATED_SECTIONS'));
});

test('email submission rules use the grounded deadline text and omit a physical portal', () => {
  const result = buildProposalIntelligence({
    tender: {
      title: 'Healthcare design', deadline: new Date('2026-08-25T00:00:00Z'),
      submissionMethod: 'Email', submissionAddress: '/ Portal: No physical address or portal i',
      description: 'Submission Deadline: August 25, 2026, 5:00 PM Addis Ababa Time\nSubmission Method: Email submission only',
    },
    company: { name: 'Hope', serviceLines: '[]', sectors: '[]' }, requirements: [], experts: [], projects: [],
  });
  assert.ok(result.submissionRules.some((rule) => /5:00 PM Addis Ababa Time/.test(rule)));
  assert.ok(!result.submissionRules.some((rule) => /portal \/ address/i.test(rule)));
});

test('flattened submission metadata cannot be swallowed by the deadline', () => {
  const result = buildProposalIntelligence({
    tender: {
      title: 'Healthcare design', submissionMethod: 'Email',
      description: 'Submission Deadline: August 25, 2026, 5:00 PM Addis Ababa Time Submission Email(s): edessalegn@pharoventures.com; fgetachew@pharoventures.com Subject: Technical Proposal for Pharo Ventures',
    },
    company: { name: 'Hope', serviceLines: '[]', sectors: '[]' }, requirements: [], experts: [], projects: [],
  });
  const deadline = result.submissionRules.find((rule) => rule.startsWith('Submission deadline:')) ?? '';
  assert.equal(deadline, 'Submission deadline: August 25, 2026, 5:00 PM Addis Ababa Time.');
  assert.doesNotMatch(deadline, /Email|@/);
});

test('a concatenated client metadata row resolves to only the procuring entity', () => {
  assert.equal(
    cleanClientName('Pharo Ventures Procuring Entity / Client Name: Pharo Ventures Legal Client Name: Pharo Ventures Project Name: Pharo Health'),
    'Pharo Ventures'
  );
});

test('the deterministic signatory block does not claim an unattached signed copy', () => {
  assert.doesNotMatch(readFileSync('lib/engine/tender-closers.ts', 'utf8'), /signed copy in submission pack/i);
});

test('reference throughlines never invent same-team continuity', () => {
  for (const file of ['lib/engine/narrative-throughline-enforcer.ts', 'lib/engine/why-us-summary.ts']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /same team proposed|same project, already delivered/i);
  }
});

test('client-facing team summaries remove irrelevant personal CV fields', () => {
  const experts = [{
    fullName: 'Daniel Example', title: 'Electrical Engineer', yearsExperience: 11,
    disciplines: '["Electrical Engineering"]', sectors: '["Healthcare"]', certifications: '[]',
    profile: 'Professional Profile Daniel Example Date of Birth 10 January 1983 Nationality Ethiopian Highest Education MSc Electrical Engineering Key Qualifications Hospital MEP design',
  }];
  const output = `${buildProposedTeamTable(experts, 'Lead coordination')}\n${buildPrincipalQualificationsSection({ experts })}`;
  assert.doesNotMatch(output, /Date of Birth|10 January 1983|Nationality Ethiopian/);
  assert.match(output, /Education MSc Electrical Engineering|Hospital MEP design/);
});
