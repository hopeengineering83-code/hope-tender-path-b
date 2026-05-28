// Tests for the sequential chunking + JSON repair changes introduced to
// analyzeWithAI / analyzeOneChunk. All tests are pure unit tests (no DB, no
// real network calls) — they exercise the logic directly.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

// ─── Trailing-comma JSON repair ───────────────────────────────────────────────
// Mirrors the repair step added inside analyzeOneChunk (the same regex).

function repairTrailingCommas(text: string): string {
  return text.replace(/,(\s*[}\]])/g, "$1");
}

describe("trailing-comma JSON repair (mirrors analyzeOneChunk logic)", () => {
  it("repairs a trailing comma before }", () => {
    const raw = '{"summary": "ok", "requirements": [],}';
    const repaired = repairTrailingCommas(raw);
    assert.doesNotThrow(() => JSON.parse(repaired));
    const parsed = JSON.parse(repaired) as { summary: string };
    assert.equal(parsed.summary, "ok");
  });

  it("repairs a trailing comma before ]", () => {
    const raw = '{"exactFileNaming": ["file1.pdf", "file2.pdf",]}';
    const repaired = repairTrailingCommas(raw);
    assert.doesNotThrow(() => JSON.parse(repaired));
    const parsed = JSON.parse(repaired) as { exactFileNaming: string[] };
    assert.equal(parsed.exactFileNaming.length, 2);
  });

  it("repairs nested trailing commas", () => {
    const raw = '{"requirements": [{"title": "T1",},],}';
    const repaired = repairTrailingCommas(raw);
    assert.doesNotThrow(() => JSON.parse(repaired));
  });

  it("does not modify already-valid JSON", () => {
    const valid = '{"summary": "ok", "requirements": []}';
    assert.equal(repairTrailingCommas(valid), valid);
  });

  it("does not modify empty object or array", () => {
    assert.equal(repairTrailingCommas("{}"), "{}");
    assert.equal(repairTrailingCommas("[]"), "[]");
  });

  it("removes trailing comma with surrounding whitespace", () => {
    const raw = '{"a": 1,\n  }';
    const repaired = repairTrailingCommas(raw);
    assert.doesNotThrow(() => JSON.parse(repaired));
  });

  it("returns valid JSON even when a value string contains a comma", () => {
    // String value "hello, world" must not be affected — the comma is
    // followed by a space and then a double-quote, not } or ]
    const raw = '{"note": "hello, world", "x": 1,}';
    const repaired = repairTrailingCommas(raw);
    const parsed = JSON.parse(repaired) as { note: string; x: number };
    assert.equal(parsed.note, "hello, world");
    assert.equal(parsed.x, 1);
  });
});

// ─── Fence stripping ──────────────────────────────────────────────────────────
// Mirrors the first clean step in analyzeOneChunk.

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

describe("markdown fence stripping (mirrors analyzeOneChunk first step)", () => {
  it("strips ```json ... ``` fences", () => {
    const raw = "```json\n{\"a\":1}\n```";
    assert.equal(stripFences(raw), '{"a":1}');
  });

  it("strips ``` ... ``` fences without language tag", () => {
    const raw = "```\n{\"a\":1}\n```";
    assert.equal(stripFences(raw), '{"a":1}');
  });

  it("does not modify plain JSON", () => {
    const raw = '{"a":1}';
    assert.equal(stripFences(raw), raw);
  });
});

// ─── Sequential chunk failure accumulation ───────────────────────────────────
// Tests the error accumulation logic added to analyzeWithAI (pure logic, no AI
// calls). We exercise the failure-accumulation algorithm in isolation.

function collectChunkResults<T>(
  results: Array<{ ok: true; value: T } | { ok: false; error: string }>,
): { successes: T[]; failures: string[] } {
  const successes: T[] = [];
  const failures: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.ok) {
      successes.push(r.value);
    } else {
      failures.push(`chunk ${i + 1}: ${r.error}`);
    }
  }
  return { successes, failures };
}

describe("sequential chunk failure accumulation", () => {
  it("collects all successes when all chunks pass", () => {
    const results = [
      { ok: true as const, value: "a" },
      { ok: true as const, value: "b" },
      { ok: true as const, value: "c" },
    ];
    const { successes, failures } = collectChunkResults(results);
    assert.deepEqual(successes, ["a", "b", "c"]);
    assert.equal(failures.length, 0);
  });

  it("collects partial successes when some chunks fail", () => {
    const results = [
      { ok: true as const, value: "a" },
      { ok: false as const, error: "rate limited" },
      { ok: true as const, value: "c" },
    ];
    const { successes, failures } = collectChunkResults(results);
    assert.deepEqual(successes, ["a", "c"]);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /chunk 2/);
    assert.match(failures[0], /rate limited/);
  });

  it("returns all failures when every chunk fails", () => {
    const results = [
      { ok: false as const, error: "err1" },
      { ok: false as const, error: "err2" },
    ];
    const { successes, failures } = collectChunkResults(results);
    assert.equal(successes.length, 0);
    assert.equal(failures.length, 2);
  });

  it("preserves chunk index in failure messages", () => {
    const results = [
      { ok: false as const, error: "timeout" },
      { ok: true as const, value: "ok" },
      { ok: false as const, error: "malformed json" },
    ];
    const { failures } = collectChunkResults(results);
    assert.match(failures[0], /chunk 1/);
    assert.match(failures[1], /chunk 3/);
  });
});
