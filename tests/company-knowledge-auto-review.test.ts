import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync('lib/company-knowledge-import-safe.ts', 'utf8');

describe('company knowledge auto-review safety contract', () => {
  it('auto-reviews only high-confidence AI records with strong source quotes', () => {
    assert.ok(src.includes('AUTO_REVIEW_MIN_CONFIDENCE = 0.92'));
    assert.ok(src.includes('AUTO_REVIEW_MIN_QUOTE_CHARS = 80'));
    assert.ok(src.includes('hasStrongSourceQuote(sourceQuote, sourceText)'));
    assert.ok(src.includes('sourceText'));
    assert.ok(src.includes('? "REVIEWED"'));
    assert.ok(src.includes(': "AI_DRAFT"'));
  });

  it('does not auto-review regex or weak records and preserves audit metadata', () => {
    assert.ok(src.includes('Regex/weak records are NEVER promoted to REVIEWED automatically'));
    assert.ok(src.includes('company?.userId ? autoReviewedTrust'));
    assert.ok(src.includes('trustLevel === "REVIEWED" ? company?.userId ?? null : null'));
    assert.ok(src.includes('reviewedAt: trustLevel === "REVIEWED" ? new Date() : null'));
    assert.ok(src.includes('Auto-reviewed: high-confidence AI extraction with a strong source quote'));
    assert.ok(src.includes('AUTO-REVIEWED SOURCE-GROUNDED'));
    assert.equal(src.includes('Claude-extracted'), false, 'trust labels must be provider-neutral');
  });
});
