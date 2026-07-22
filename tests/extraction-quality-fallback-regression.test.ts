import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync('lib/extract-text.ts', 'utf8');

describe('extraction fallback quality', () => {
  it('has a DOCX XML fallback when mammoth returns too little text', () => {
    assert.ok(src.includes('async function extractDocxXmlFallback'));
    assert.ok(src.includes('JSZip.loadAsync(buffer)'));
    assert.ok(src.includes('word/document.xml'));
    assert.ok(src.includes('if (raw.length > 20) return raw'));
    assert.ok(src.includes('return await extractDocxXmlFallback(buffer)'));
  });
});
