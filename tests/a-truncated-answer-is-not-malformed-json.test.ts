// 2026-09-22, Preview: AI Analyze recorded "zai: malformed JSON or empty
// structured response" after ~65s. glm-4.7-flash thinks before answering and
// its thinking is billed against the same max_tokens as the answer, so the
// extraction JSON was cut off at the 8,000-token budget.
//
// Two things are pinned here:
//   1. A JSON-mode answer that stopped at the budget is reported as TRUNCATED,
//      naming the budget — not as malformed output.
//   2. Z.ai structured-extraction requests disable thinking, so the whole
//      budget goes to the answer; prose requests keep the model default.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { describeTruncatedStructuredAnswer, zaiRequestExtras } from "../lib/ai";

describe("a truncated structured answer is named as truncated", () => {
  it("names the budget when a JSON answer stops at finish_reason=length", () => {
    const why = describeTruncatedStructuredAnswer(
      { finish_reason: "length", message: { content: '{"summary":"x","requirements":[{"t', reasoning_content: "thinking..." } },
      '{"summary":"x","requirements":[{"t',
      8000,
      true,
    );
    assert.ok(why);
    assert.match(why!, /max_tokens=8000/);
    assert.match(why!, /truncated/);
    assert.match(why!, /reasoning/);
  });

  it("says nothing about a complete answer", () => {
    assert.equal(describeTruncatedStructuredAnswer({ finish_reason: "stop" }, "{}", 8000, true), null);
  });

  it("does not judge prose answers, which may legitimately end at the budget", () => {
    assert.equal(describeTruncatedStructuredAnswer({ finish_reason: "length" }, "Some prose", 8000, false), null);
  });
});

describe("Z.ai extraction spends its budget on the answer", () => {
  it("disables thinking for structured (JSON) requests", () => {
    assert.deepEqual(zaiRequestExtras(true), { thinking: { type: "disabled" } });
  });

  it("leaves prose requests on the model default", () => {
    assert.equal(zaiRequestExtras(false), undefined);
  });

  it("is wired into the Z.ai adapter", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/ai.ts", "utf8");
    const adapter = source.slice(source.indexOf("async function generateWithZai("), source.indexOf("async function generateWithCerebras("));
    assert.match(adapter, /extraBody: zaiRequestExtras\(wantJson\)/);
  });
});
