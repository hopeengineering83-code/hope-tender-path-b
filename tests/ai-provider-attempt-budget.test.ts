// Behavioral tests for the Vercel-Hobby attempt budget, cooldown skipping,
// secret redaction, and malformed-JSON safety. These mock global.fetch so no
// real network calls are made.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  generateWithFallback,
  analyzeOneChunkWithRetry,
  NoAiProviderReadyError,
} from "../lib/ai";
import {
  resetProviderHealth,
  recordProviderFailure,
  getProviderHealth,
} from "../lib/ai-provider-health";

const KEYS = ["ZAI_API_KEY", "CEREBRAS_API_KEY", "MISTRAL_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "OPENROUTER_PROPOSAL_MODEL", "GEMINI_API_KEY", "OPENAI_API_KEY", "TOGETHER_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY"];
let saved: Record<string, string | undefined> = {};
let realFetch: typeof globalThis.fetch;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  realFetch = globalThis.fetch;
  resetProviderHealth();
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  globalThis.fetch = realFetch;
  resetProviderHealth();
});

function mockFetch(handler: (url: string, init: RequestInit) => { status: number; body: any }) {
  let calls = 0;
  globalThis.fetch = (async (input: any, init: any) => {
    calls++;
    const url = typeof input === "string" ? input : input.url;
    const { status, body } = handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    } as Response;
  }) as typeof globalThis.fetch;
  return { calls: () => calls };
}

describe("12. only three actual outbound attempts occur per request", () => {
  it("makes at most 3 outbound provider calls even when 5+ are configured", async () => {
    // Configure 6 OpenAI-compatible providers; all return HTTP 500 so the chain
    // keeps falling over. The budget must cap actual fetches at 3.
    process.env.ZAI_API_KEY = "k";
    process.env.CEREBRAS_API_KEY = "k";
    process.env.MISTRAL_API_KEY = "k";
    process.env.GROQ_API_KEY = "k";
    process.env.OPENAI_API_KEY = "k";
    process.env.TOGETHER_API_KEY = "k";

    const m = mockFetch(() => ({ status: 500, body: { error: { message: "server error" } } }));

    await assert.rejects(
      () => generateWithFallback("hello", { useCase: "proposal" }),
      (err: unknown) => err instanceof NoAiProviderReadyError,
    );
    assert.equal(m.calls(), 3, `expected exactly 3 outbound attempts, got ${m.calls()}`);
  });
});

describe("11. cooldown providers are skipped without consuming the budget", () => {
  it("skips a cooled-down provider and still tries 3 live providers", async () => {
    process.env.ZAI_API_KEY = "k";       // will be put in cooldown
    process.env.CEREBRAS_API_KEY = "k";
    process.env.MISTRAL_API_KEY = "k";
    process.env.GROQ_API_KEY = "k";
    process.env.OPENAI_API_KEY = "k";

    // Force zai into cooldown via a rate-limit failure.
    recordProviderFailure("zai", new Error("429 rate limit"));
    assert.ok(getProviderHealth("zai").cooldownUntil, "zai should be cooling down");

    const seen: string[] = [];
    const m = mockFetch((url) => {
      if (url.includes("z.ai")) seen.push("zai");
      else if (url.includes("cerebras")) seen.push("cerebras");
      else if (url.includes("mistral")) seen.push("mistral");
      else if (url.includes("groq")) seen.push("groq");
      else if (url.includes("openai")) seen.push("openai");
      return { status: 500, body: { error: { message: "fail" } } };
    });

    await assert.rejects(() => generateWithFallback("hi", { useCase: "proposal" }));
    // zai is skipped (cooldown); 3 live attempts among cerebras/mistral/groq.
    assert.equal(m.calls(), 3);
    assert.ok(!seen.includes("zai"), "cooled-down zai must not be called");
  });
});

describe("13. ATTEMPT_BUDGET_EXHAUSTED distinct from all-providers-exhausted", () => {
  it("reports ATTEMPT_BUDGET_EXHAUSTED when eligible providers remain untried", async () => {
    process.env.ZAI_API_KEY = "k";
    process.env.CEREBRAS_API_KEY = "k";
    process.env.MISTRAL_API_KEY = "k";
    process.env.GROQ_API_KEY = "k";
    process.env.OPENAI_API_KEY = "k";
    mockFetch(() => ({ status: 500, body: { error: { message: "fail" } } }));
    try {
      await generateWithFallback("hi", { useCase: "proposal" });
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(err instanceof NoAiProviderReadyError);
      assert.equal((err as NoAiProviderReadyError).errorKind, "ATTEMPT_BUDGET_EXHAUSTED");
    }
  });
});

describe("14. API keys and raw provider bodies are redacted", () => {
  it("never leaks the API key or raw body into the structured error", async () => {
    process.env.ZAI_API_KEY = "sk-secret-zai-key-1234567890";
    // Body echoes a key-shaped secret; it must be redacted in any surfaced text.
    mockFetch(() => ({ status: 400, body: "error sk-secret-zai-key-1234567890 invalid max_tokens" }));
    try {
      await generateWithFallback("hi", { useCase: "proposal" });
      assert.fail("should have thrown");
    } catch (err) {
      const serialized = JSON.stringify((err as NoAiProviderReadyError).failureDetails) + (err as Error).message;
      assert.ok(!serialized.includes("sk-secret-zai-key-1234567890"), "API key must be redacted");
    }
    const health = getProviderHealth("zai");
    assert.ok(!(health.lastFailureMessage ?? "").includes("sk-secret-zai-key-1234567890"), "stored failure message must be redacted");
  });
});

describe("15. invalid JSON from Z.ai or Cerebras cannot promote requirements", () => {
  it("analyzeOneChunkWithRetry throws on malformed JSON (no requirements returned)", async () => {
    process.env.ZAI_API_KEY = "k";
    // Z.ai returns prose, not JSON. Validation must reject it — no requirements.
    mockFetch(() => ({ status: 200, body: { choices: [{ message: { content: "Sure! Here is a friendly summary with no JSON at all." } }] } }));
    await assert.rejects(
      () => analyzeOneChunkWithRetry("Tender content ".repeat(50), 0, 1),
      /malformed JSON|no JSON/i,
    );
  });

  it("a result lacking valid structured fields cannot be promoted", async () => {
    process.env.CEREBRAS_API_KEY = "k";
    // Returns JSON-looking but structurally invalid (requirements not an array).
    mockFetch(() => ({ status: 200, body: { choices: [{ message: { content: '{"summary": 123, "requirements": "nope"}' } }] } }));
    // Either it throws (malformed) or returns a sanitized empty requirements set —
    // in both cases no invalid requirement data is promoted.
    try {
      const result = await analyzeOneChunkWithRetry("Tender content ".repeat(50), 0, 1);
      assert.ok(Array.isArray(result.requirements));
      assert.equal(result.requirements.length, 0, "no invalid requirements may be promoted");
    } catch (err) {
      assert.match((err as Error).message, /malformed JSON|no JSON/i);
    }
  });
});
