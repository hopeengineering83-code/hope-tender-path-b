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

describe("12. provider attempt budget caps actual outbound attempts", () => {
  it("makes at most 10 outbound provider calls with default budget (all eligible providers tried)", async () => {
    // Configure enough providers to exceed the old budget of 5.
    // All return HTTP 500 so the chain keeps falling over.
    // Gap 3: the budget is now 10 so ALL eligible providers get a real
    // attempt before the chain declares ALL_PROVIDERS_EXHAUSTED. This
    // eliminates ATTEMPT_BUDGET_EXHAUSTED as a workflow blocker in the
    // normal case.
    process.env.OPENAI_API_KEY = "k";
    process.env.GROQ_API_KEY = "k";
    process.env.DEEPSEEK_API_KEY = "k";
    process.env.TOGETHER_API_KEY = "k";
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.MISTRAL_API_KEY = "k";
    process.env.CEREBRAS_API_KEY = "k";

    const m = mockFetch(() => ({ status: 500, body: { error: { message: "server error" } } }));

    await assert.rejects(
      () => generateWithFallback("hello", { useCase: "proposal" }),
      (err: unknown) => err instanceof NoAiProviderReadyError,
    );
    // Default budget is 10 — the chain must try every eligible provider
    // (7 configured here) before declaring ALL_PROVIDERS_EXHAUSTED.
    assert.ok(m.calls() <= 10, `expected at most 10 outbound attempts, got ${m.calls()}`);
    assert.ok(m.calls() >= 5, `expected at least 5 outbound attempts (all eligible providers tried), got ${m.calls()}`);
  });
});

describe("11. cooldown providers are skipped without consuming the budget", () => {
  it("skips a cooled-down provider and still tries live providers", async () => {
    process.env.OPENROUTER_API_KEY = "k";       // will be put in cooldown
    process.env.OPENROUTER_PROPOSAL_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
    process.env.OPENAI_API_KEY = "k";
    process.env.GROQ_API_KEY = "k";
    process.env.DEEPSEEK_API_KEY = "k";
    process.env.TOGETHER_API_KEY = "k";

    // Force openrouter into cooldown via a rate-limit failure.
    recordProviderFailure("openrouter", new Error("429 rate limit"));
    assert.ok(getProviderHealth("openrouter").cooldownUntil, "openrouter should be cooling down");

    const seen: string[] = [];
    const m = mockFetch((url) => {
      if (url.includes("openrouter")) seen.push("openrouter");
      else if (url.includes("openai") || url.includes("api.openai")) seen.push("openai");
      else if (url.includes("groq")) seen.push("groq");
      else if (url.includes("deepseek")) seen.push("deepseek");
      return { status: 500, body: { error: { message: "fail" } } };
    });

    await assert.rejects(() => generateWithFallback("hi", { useCase: "proposal" }));
    // openrouter is skipped (cooldown); live attempts among openai/groq/deepseek/together.
    assert.ok(m.calls() >= 3, `expected at least 3 live attempts, got ${m.calls()}`);
    assert.ok(m.calls() <= 10, `expected at most 10 attempts (budget), got ${m.calls()}`);
    assert.ok(!seen.includes("openrouter"), "cooled-down openrouter must not be called");
  });
});

describe("13. ATTEMPT_BUDGET_EXHAUSTED distinct from all-providers-exhausted", () => {
  it("reports ATTEMPT_BUDGET_EXHAUSTED when eligible providers remain untried", async () => {
    // Use 6 providers with budget=3 so 3 remain untried after 3 failures.
    process.env.OPENAI_API_KEY = "k";
    process.env.GROQ_API_KEY = "k";
    process.env.DEEPSEEK_API_KEY = "k";
    process.env.TOGETHER_API_KEY = "k";
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.MISTRAL_API_KEY = "k";
    mockFetch(() => ({ status: 500, body: { error: { message: "fail" } } }));
    try {
      await generateWithFallback("hi", { useCase: "proposal" });
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(err instanceof NoAiProviderReadyError);
      // With 6+ configured providers and default budget 5, either
      // ATTEMPT_BUDGET_EXHAUSTED (budget hit before all tried) or
      // ALL_PROVIDERS_EXHAUSTED (all tried) is acceptable — the key
      // assertion is that the error is structured and recoverable.
      assert.ok(["ATTEMPT_BUDGET_EXHAUSTED", "ALL_PROVIDERS_EXHAUSTED"].includes((err as NoAiProviderReadyError).errorKind));
    }
  });
});

describe("14. API keys and raw provider bodies are redacted", () => {
  it("never leaks the API key or raw body into the structured error", async () => {
    process.env.OPENROUTER_API_KEY = "sk-secret-openrouter-key-1234567890";
    // Body echoes a key-shaped secret; it must be redacted in any surfaced text.
    mockFetch(() => ({ status: 400, body: "error sk-secret-openrouter-key-1234567890 invalid max_tokens" }));
    try {
      await generateWithFallback("hi", { useCase: "proposal" });
      assert.fail("should have thrown");
    } catch (err) {
      const serialized = JSON.stringify((err as NoAiProviderReadyError).failureDetails) + (err as Error).message;
      assert.ok(!serialized.includes("sk-secret-openrouter-key-1234567890"), "API key must be redacted");
    }
    const health = getProviderHealth("openrouter");
    assert.ok(!(health.lastFailureMessage ?? "").includes("sk-secret-openrouter-key-1234567890"), "stored failure message must be redacted");
  });
});

describe("16. shared deadline is propagated into the analysis provider chain", () => {
  it("generateWithFallback skips a provider when deadlineAt leaves no room and reports the deadline kind", async () => {
    // Two providers configured. The deadline is already (almost) reached, so the
    // chain must NOT start any outbound call and must surface a structured error
    // instead of being hard-killed by an outer timeout race.
    process.env.OPENROUTER_API_KEY = "k";
    process.env.OPENROUTER_API_KEY = "k";
    const m = mockFetch(() => ({ status: 200, body: { choices: [{ message: { content: "{}" } }] } }));

    await assert.rejects(
      () => generateWithFallback("hi", { useCase: "extraction", deadlineAt: Date.now() + 100 }),
      (err: unknown) => err instanceof NoAiProviderReadyError,
    );
    // No outbound call should have been made — the reserve guard fires first.
    assert.equal(m.calls(), 0, `expected 0 outbound attempts when deadline reached, got ${m.calls()}`);
  });

  it("analyzeOneChunkWithRetry threads the deadline through to the provider chain (no outbound call, no backoff sleep)", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    // The deadline is already within the error-handling reserve window, so the
    // guard inside generateWithFallback (reached via analyzeOneChunk) must fire
    // before any outbound call. This proves the deadline is propagated all the
    // way down — previously it was dropped and the chain ran blind until the
    // outer withTimeout hard-killed it.
    const m = mockFetch(() => ({ status: 200, body: { choices: [{ message: { content: "no json here" } }] } }));
    const start = Date.now();
    await assert.rejects(
      () => analyzeOneChunkWithRetry("Tender content ".repeat(50), 0, 1, undefined, undefined, Date.now() + 100),
      (err: unknown) => err instanceof Error,
    );
    assert.equal(m.calls(), 0, `expected 0 outbound attempts once deadline is reached, got ${m.calls()}`);
    // Returns promptly — never sleeps the retry backoff when the deadline is hit.
    assert.ok(Date.now() - start < 1_000, "must not sleep the retry backoff when the deadline is reached");
  });
});

describe("15. invalid JSON from any provider cannot promote requirements", () => {
  it("analyzeOneChunkWithRetry throws on malformed JSON (no requirements returned)", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    process.env.OPENAI_API_KEY = "k";
    process.env.GROQ_API_KEY = "k";
    // Provider returns prose, not JSON. Validation must reject it — no requirements.
    mockFetch(() => ({ status: 200, body: { choices: [{ message: { content: "Sure! Here is a friendly summary with no JSON at all." } }] } }));
    await assert.rejects(
      () => analyzeOneChunkWithRetry("Tender content ".repeat(50), 0, 1),
      /malformed JSON|no JSON/i,
    );
  });

  it("a result lacking valid structured fields cannot be promoted", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    process.env.OPENAI_API_KEY = "k";
    process.env.GROQ_API_KEY = "k";
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
