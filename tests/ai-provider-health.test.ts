import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  resetProviderHealth,
  recordProviderSuccess,
  recordProviderFailure,
  getProviderRuntimeSnapshot,
  getProviderStateSnapshot,
  restoreProviderState,
} from "../lib/ai-provider-health";

describe("provider health logic", () => {
  beforeEach(() => {
    resetProviderHealth();
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.GEMINI_API_KEY = "AIza-test";
  });

  it("newly initialized provider with key is available", () => {
    assert.equal(getProviderRuntimeSnapshot("openai").available, true);
  });

  it("successful call clears failure state", () => {
    recordProviderFailure("openai", new Error("Rate limit"));
    assert.equal(getProviderRuntimeSnapshot("openai").available, false);
    recordProviderSuccess("openai");
    assert.equal(getProviderRuntimeSnapshot("openai").available, true);
    assert.equal(getProviderRuntimeSnapshot("openai").consecutiveFailures, 0);
  });

  it("multiple failures increase backoff", () => {
    const now = Date.now();
    recordProviderFailure("openai", new Error("Rate limit"));
    const snap1 = getProviderStateSnapshot("openai");
    assert.ok(snap1);
    const cooldown1 = snap1.cooldownUntil! - now;

    recordProviderFailure("openai", new Error("Rate limit"));
    const snap2 = getProviderStateSnapshot("openai");
    assert.ok(snap2);
    const cooldown2 = snap2.cooldownUntil! - now;

    assert.ok(cooldown2 > cooldown1, "Second cooldown should be longer than first");
  });
});

describe("cross-instance restore merging", () => {
  it("DB cooldown remains authoritative when memory says provider is available", () => {
    resetProviderHealth();
    process.env.OPENAI_API_KEY = "sk-test";
    recordProviderSuccess("openai");
    assert.equal(getProviderRuntimeSnapshot("openai").available, true);

    const now = Date.now();
    restoreProviderState("openai", {
      lastSuccessAt: null,
      lastPingSucceededAt: null,
      lastGenerationSucceededAt: null,
      lastAnalysisSucceededAt: null,
      lastFailureAt: now - 1_000,
      lastFailureCategory: "RATE_LIMIT",
      lastFailureMessage: "HTTP 429 Too Many Requests",
      consecutiveFailures: 2,
      cooldownUntil: now + 60_000,
    });

    const runtime = getProviderRuntimeSnapshot("openai");
    assert.equal(runtime.coolingDown, true);
    assert.equal(runtime.rateLimited, true);
    assert.equal(runtime.available, false);
  });
});

describe("/api/ai/health DB restore contract", () => {
  it("restores DB health before response and degrades to a warning instead of crashing", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/api/ai/health/route.ts", "utf8");
    assert.match(source, /restoreProviderHealthBeforeResponse/);
    assert.match(source, /providerHealthRestoreWarning/);
    assert.match(source, /using in-memory provider health for this response/);
  });
});

describe("provider health DB persistence order", () => {
  it("derives the persistence iteration order from the canonical registry", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/ai-provider-health-db.ts", "utf8");
    // ALL_PROVIDERS now derives from CANONICAL_AI_PROVIDER_ORDER (single source).
    assert.match(source, /ALL_PROVIDERS[\s\S]*?=\s*CANONICAL_AI_PROVIDER_ORDER/);
    const { CANONICAL_AI_PROVIDER_ORDER } = await import("../lib/ai-provider-registry");
    assert.deepEqual([...CANONICAL_AI_PROVIDER_ORDER], ["zai", "cerebras", "mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"]);
  });
});
