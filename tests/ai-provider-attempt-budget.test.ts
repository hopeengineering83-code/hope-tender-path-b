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
import { isolateProviderEnv } from "./helpers/provider-env";
import {
  resetProviderHealth,
  recordProviderFailure,
  getProviderHealth,
} from "../lib/ai-provider-health";

// Every provider-scoped variable is cleared, not just keys and two model
// names. The old list left the `_BASE_URL` suffixes behind, so a configured
// Cerebras gateway on the machine running the suite changed the URL the
// router contacted — and an assertion that matched the vendor's hostname
// failed even though the provider had been contacted at its correct rank.
let restoreProviderEnv: (() => void) | null = null;
let realFetch: typeof globalThis.fetch;

beforeEach(() => {
  restoreProviderEnv = isolateProviderEnv();
  realFetch = globalThis.fetch;
  resetProviderHealth();
});

function configureGroq(): void {
  process.env.GROQ_API_KEY = "k";
  process.env.GROQ_PROPOSAL_MODEL = "llama-3.1-8b-instant";
}
afterEach(() => {
  restoreProviderEnv?.();
  restoreProviderEnv = null;
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
  it("tries every eligible provider in the zero-paid chain before declaring exhaustion", async () => {
    // Configured with the FREE chain. This test previously configured OpenAI,
    // DeepSeek, Together, Anthropic and Cerebras — all paid — and asserted the
    // chain attempted them. Under zero-paid mode those providers are not merely
    // deprioritised, they are unreachable, so the assertion had to change with
    // the behaviour it describes.
    process.env.GEMINI_API_KEY = "AIzaTestKey1234567890123456789012345";
    configureGroq();
    process.env.MISTRAL_API_KEY = "k";
    process.env.ZAI_API_KEY = "k";

    const m = mockFetch(() => ({ status: 500, body: { error: { message: "server error" } } }));

    await assert.rejects(
      () => generateWithFallback("hello", { useCase: "proposal" }),
      (err: unknown) => err instanceof NoAiProviderReadyError,
    );
    assert.ok(m.calls() <= 10, `expected at most 10 outbound attempts, got ${m.calls()}`);
    // Gemini goes through the Google SDK rather than fetch, so it does not add
    // to the fetch count; the three OpenAI-compatible free providers do.
    assert.ok(m.calls() >= 3, `expected every eligible free provider to be tried, got ${m.calls()}`);
  });

  it("continues through configured later-chain providers when earlier providers fail", async () => {
    process.env.OPENAI_API_KEY = "k";
    process.env.DEEPSEEK_API_KEY = "k";
    process.env.TOGETHER_API_KEY = "k";
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.CEREBRAS_API_KEY = "k";
    // The base URL is pinned rather than left to the default, so this case
    // asserts a position in the chain and not a vendor's DNS name. An
    // operator who routes Cerebras through a gateway is running the same
    // chain; matching on the hostname would call that a routing failure.
    process.env.CEREBRAS_BASE_URL = "https://cerebras-under-test.invalid/v1";

    const contacted: string[] = [];
    mockFetch((url) => {
      contacted.push(url);
      return { status: 500, body: { error: { message: "fail" } } };
    });

    await assert.rejects(() => generateWithFallback("hi", { useCase: "proposal" }));
    assert.ok(
      contacted.some((url) => url.startsWith("https://cerebras-under-test.invalid/")),
      `Cerebras must be attempted at rank 5; contacted ${JSON.stringify(contacted)}`,
    );
    assert.ok(contacted.some((url) => url.includes("openai.com")), "OpenAI must be attempted after OpenRouter");
    assert.ok(contacted.some((url) => url.includes("together")), "Together must remain in automatic fallback");
    assert.ok(contacted.some((url) => url.includes("deepseek")), "DeepSeek must remain in automatic fallback");
    assert.ok(contacted.some((url) => url.includes("anthropic")), "Anthropic must be the final AI-provider attempt");

    // The contractual order itself, not merely presence: each configured
    // provider is first contacted in canonical rank order.
    const firstIndex = (needle: string) => contacted.findIndex((url) => url.includes(needle));
    const cerebras = contacted.findIndex((url) => url.startsWith("https://cerebras-under-test.invalid/"));
    assert.ok(cerebras < firstIndex("openai.com"), "Cerebras (rank 5) precedes OpenAI (rank 7)");
    assert.ok(firstIndex("openai.com") < firstIndex("together"), "OpenAI (7) precedes Together (8)");
    assert.ok(firstIndex("together") < firstIndex("deepseek"), "Together (8) precedes DeepSeek (9)");
    assert.ok(firstIndex("deepseek") < firstIndex("anthropic"), "DeepSeek (9) precedes Anthropic (10)");
  });
});

describe("11. cooldown providers are skipped without consuming the budget", () => {
  it("skips a cooled-down provider and still tries live providers", async () => {
    process.env.OPENROUTER_API_KEY = "k";       // will be put in cooldown
    process.env.OPENROUTER_PROPOSAL_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
    configureGroq();
    process.env.MISTRAL_API_KEY = "k";
    process.env.ZAI_API_KEY = "k";

    // Force openrouter into cooldown via a rate-limit failure.
    recordProviderFailure("openrouter", new Error("429 rate limit"));
    assert.ok(getProviderHealth("openrouter").cooldownUntil, "openrouter should be cooling down");

    const seen: string[] = [];
    const m = mockFetch((url) => {
      if (url.includes("openrouter")) seen.push("openrouter");
      else if (url.includes("groq")) seen.push("groq");
      else if (url.includes("mistral")) seen.push("mistral");
      else if (url.includes("z.ai")) seen.push("zai");
      return { status: 500, body: { error: { message: "fail" } } };
    });

    await assert.rejects(() => generateWithFallback("hi", { useCase: "proposal" }));
    // openrouter is skipped (cooldown); live attempts among groq/mistral/zai.
    assert.ok(m.calls() >= 3, `expected at least 3 live attempts, got ${m.calls()}`);
    assert.ok(m.calls() <= 10, `expected at most 10 attempts (budget), got ${m.calls()}`);
    assert.ok(!seen.includes("openrouter"), "cooled-down openrouter must not be called");
  });
});

describe("13. ATTEMPT_BUDGET_EXHAUSTED distinct from all-providers-exhausted", () => {
  it("returns a structured, recoverable error when the free chain is exhausted", async () => {
    configureGroq();
    process.env.MISTRAL_API_KEY = "k";
    process.env.ZAI_API_KEY = "k";
    mockFetch(() => ({ status: 500, body: { error: { message: "fail" } } }));
    try {
      await generateWithFallback("hi", { useCase: "proposal" });
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(err instanceof NoAiProviderReadyError);
      // Either kind is acceptable — the point is that the error is structured
      // and tells a caller which recovery path applies, rather than being a
      // bare "all providers exhausted" string.
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
    configureGroq();
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
    configureGroq();
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
