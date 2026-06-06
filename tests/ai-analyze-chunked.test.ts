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

// ─── Route error sanitizer ────────────────────────────────────────────────────
// Mirrors the catch-block key-redaction in app/api/tenders/[id]/ai-analyze/route.ts

function sanitizeRouteError(raw: string): string {
  return raw
    .replace(/sk-[a-zA-Z0-9_-]{10,}/g, "[KEY_REDACTED]")
    .replace(/AIza[a-zA-Z0-9_-]{30,}/g, "[KEY_REDACTED]")
    .replace(/Bearer\s+[a-zA-Z0-9._-]{10,}/gi, "Bearer [REDACTED]")
    .slice(0, 300);
}

describe("route error sanitizer (mirrors catch-block redaction in ai-analyze route)", () => {
  it("redacts sk- Anthropic/OpenAI API keys", () => {
    const out = sanitizeRouteError("error: invalid key sk-ant-api03-testkey1234567890ABCD");
    assert.ok(!out.includes("testkey1234567890"));
    assert.ok(out.includes("[KEY_REDACTED]"));
  });

  it("redacts Gemini AIza keys", () => {
    const out = sanitizeRouteError("bad request: AIzaSyD_verylongfakekeyfortestingpurposesXXXX");
    assert.ok(!out.includes("verylongfakekeyfortestingpurposes"));
    assert.ok(out.includes("[KEY_REDACTED]"));
  });

  it("redacts Bearer tokens", () => {
    const out = sanitizeRouteError("401: Bearer eyJhbGciOiJIUzI1NiJ9.testPayload1234567890");
    assert.ok(!out.includes("eyJhbGciOiJIUzI1NiJ9"));
    assert.ok(out.includes("Bearer [REDACTED]"));
  });

  it("passes through messages without keys", () => {
    const msg = "rate limit exceeded, please wait";
    assert.equal(sanitizeRouteError(msg), msg);
  });

  it("truncates output to 300 chars", () => {
    const out = sanitizeRouteError("x".repeat(400));
    assert.equal(out.length, 300);
  });
});

// ─── Deadline-check arithmetic ────────────────────────────────────────────────
// Mirrors the guard inside analyzeWithAI: Date.now() + CHUNK_DEADLINE_MARGIN_MS > deadlineAt

describe("deadline-check arithmetic (mirrors analyzeWithAI guard)", () => {
  const CHUNK_DEADLINE_MARGIN_MS = 8_000;

  it("does not stop when deadline is comfortably in the future", () => {
    const deadlineAt = Date.now() + 48_000;
    const wouldStop = Date.now() + CHUNK_DEADLINE_MARGIN_MS > deadlineAt;
    assert.equal(wouldStop, false);
  });

  it("stops when deadline has already passed", () => {
    const deadlineAt = Date.now() - 1;
    const wouldStop = Date.now() + CHUNK_DEADLINE_MARGIN_MS > deadlineAt;
    assert.equal(wouldStop, true);
  });

  it("stops when remaining time is less than the margin", () => {
    const deadlineAt = Date.now() + 5_000; // 5s left, but margin is 8s
    const wouldStop = Date.now() + CHUNK_DEADLINE_MARGIN_MS > deadlineAt;
    assert.equal(wouldStop, true);
  });
});

// ─── cleanMessage security (mirrors analysis-fallback-diagnostics.ts) ─────────

function cleanFallbackMessage(value?: string | null): string {
  return (value ?? "")
    .replace(/sk-[^\s"']{8,}/g, "[REDACTED]")
    .replace(/AIza[A-Za-z0-9_-]{30,}/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, "Bearer [REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

describe("cleanMessage redaction (mirrors analysis-fallback-diagnostics.ts)", () => {
  it("redacts sk- keys", () => {
    const out = cleanFallbackMessage("fail: sk-ant-key12345678");
    assert.ok(!out.includes("key12345678"));
    assert.ok(out.includes("[REDACTED]"));
  });

  it("redacts Gemini AIza keys (new in this PR)", () => {
    const out = cleanFallbackMessage("fail: AIzaSyDxxx_xxxxxxxxxxxxxxxxxxxxxxxxxx12");
    assert.ok(out.includes("[REDACTED]"));
    assert.ok(!out.includes("AIzaSyDxxx"));
  });

  it("redacts Bearer tokens (new in this PR)", () => {
    const out = cleanFallbackMessage("fail: Bearer mytoken1234567890abcdefgh");
    assert.ok(out.includes("Bearer [REDACTED]"));
    assert.ok(!out.includes("mytoken1234567890"));
  });

  it("passes through safe messages unchanged", () => {
    const out = cleanFallbackMessage("rate limit exceeded");
    assert.equal(out, "rate limit exceeded");
  });
});

// ─── Schema sanitizer (mirrors tryParseAndSanitize inside analyzeOneChunk) ──────
// These tests verify that the sanitizer converts malformed-but-parseable JSON
// into a safe AIAnalysisResult rather than throwing or returning null.

type AIAnalysisResultLike = {
  summary: string;
  requirements: unknown[];
  exactFileNaming: string[];
  exactFileOrder: string[];
  evaluationMethodology: string;
  submissionNotes: string;
};

function tryParseAndSanitize(raw: string): AIAnalysisResultLike | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      requirements: Array.isArray(parsed.requirements) ? parsed.requirements.filter((r: unknown) => r && typeof r === "object") : [],
      exactFileNaming: Array.isArray(parsed.exactFileNaming) ? parsed.exactFileNaming.filter((s: unknown) => typeof s === "string") : [],
      exactFileOrder: Array.isArray(parsed.exactFileOrder) ? parsed.exactFileOrder.filter((s: unknown) => typeof s === "string") : [],
      evaluationMethodology: typeof parsed.evaluationMethodology === "string" ? parsed.evaluationMethodology : "",
      submissionNotes: typeof parsed.submissionNotes === "string" ? parsed.submissionNotes : "",
    };
  } catch {
    return null;
  }
}

describe("schema sanitizer (mirrors tryParseAndSanitize inside analyzeOneChunk)", () => {
  it("returns null for unparseable input", () => {
    assert.equal(tryParseAndSanitize("{not valid json"), null);
  });

  it("returns null for non-object values", () => {
    assert.equal(tryParseAndSanitize('"just a string"'), null);
    assert.equal(tryParseAndSanitize("42"), null);
    assert.equal(tryParseAndSanitize("null"), null);
  });

  it("normalises null requirements to empty array", () => {
    const result = tryParseAndSanitize('{"requirements": null, "summary": "ok"}');
    assert.ok(result !== null);
    assert.deepEqual(result.requirements, []);
  });

  it("normalises missing fields to empty strings/arrays", () => {
    const result = tryParseAndSanitize('{"summary": "test"}');
    assert.ok(result !== null);
    assert.equal(result.summary, "test");
    assert.deepEqual(result.requirements, []);
    assert.deepEqual(result.exactFileNaming, []);
    assert.equal(result.evaluationMethodology, "");
    assert.equal(result.submissionNotes, "");
  });

  it("filters out non-object items from requirements array", () => {
    const result = tryParseAndSanitize('{"requirements": [{"title": "Req 1"}, null, "string", 42]}');
    assert.ok(result !== null);
    assert.equal(result.requirements.length, 1);
  });

  it("filters out non-string items from exactFileNaming", () => {
    const result = tryParseAndSanitize('{"exactFileNaming": ["file1.pdf", null, 42, "file2.pdf"]}');
    assert.ok(result !== null);
    assert.deepEqual(result.exactFileNaming, ["file1.pdf", "file2.pdf"]);
  });

  it("passes a well-formed result through unchanged", () => {
    const result = tryParseAndSanitize(JSON.stringify({
      summary: "Test tender",
      requirements: [{ title: "Req 1", description: "desc" }],
      exactFileNaming: ["tech_proposal.pdf"],
      exactFileOrder: ["tech_proposal.pdf"],
      evaluationMethodology: "Technical 70%",
      submissionNotes: "By email",
    }));
    assert.ok(result !== null);
    assert.equal(result.summary, "Test tender");
    assert.equal(result.requirements.length, 1);
    assert.equal(result.exactFileNaming[0], "tech_proposal.pdf");
  });
});
