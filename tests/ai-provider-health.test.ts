// AI provider health tracker — classification, cooldown, reset.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAiError,
  recordProviderFailure,
  recordProviderSuccess,
  isProviderCooledDown,
  getAllProviderHealth,
  getProviderRuntimeSnapshot,
  resetProviderHealth,
  restoreProviderState,
} from "../lib/ai-provider-health";

before(() => { resetProviderHealth(); });

describe("classifyAiError", () => {
  it("classifies 429 / rate-limit messages as RATE_LIMIT", () => {
    assert.equal(classifyAiError(new Error("HTTP 429 Too Many Requests")), "RATE_LIMIT");
    assert.equal(classifyAiError(new Error("Tokens per minute quota exceeded")), "RATE_LIMIT");
  });
  it("classifies 401 / 403 / API key issues as AUTH", () => {
    assert.equal(classifyAiError(new Error("Invalid API key")), "AUTH");
    assert.equal(classifyAiError(new Error("HTTP 403 Forbidden")), "AUTH");
  });
  it("classifies timeouts and aborts as TIMEOUT", () => {
    assert.equal(classifyAiError(new Error("Request timed out after 30s")), "TIMEOUT");
    assert.equal(classifyAiError(new Error("operation was aborted")), "TIMEOUT");
  });
  it("classifies model-not-found as MODEL_UNAVAILABLE", () => {
    assert.equal(classifyAiError(new Error("HTTP 404 model not found: gpt-7-turbo")), "MODEL_UNAVAILABLE");
  });
  it("classifies network errors", () => {
    assert.equal(classifyAiError(new Error("fetch failed: ECONNRESET")), "NETWORK");
    assert.equal(classifyAiError(new Error("getaddrinfo ENOTFOUND api.example.com")), "NETWORK");
  });
  it("falls back to UNKNOWN", () => {
    assert.equal(classifyAiError(new Error("Some weird failure")), "UNKNOWN");
  });
});

describe("recordProviderFailure + isProviderCooledDown", () => {
  it("puts the provider into cooldown after a RATE_LIMIT failure", () => {
    resetProviderHealth();
    const category = recordProviderFailure("anthropic", new Error("HTTP 429 Too Many Requests"));
    assert.equal(category, "RATE_LIMIT");
    assert.equal(isProviderCooledDown("anthropic"), true);
    assert.equal(isProviderCooledDown("gemini"), false);
  });
  it("redacts API keys from the stored message", () => {
    resetProviderHealth();
    recordProviderFailure("openai", new Error("Invalid API key sk-test-1234567890abcdef on call"));
    const health = getAllProviderHealth().find((h) => h.provider === "openai")!;
    assert.ok(!/sk-test-1234567890abcdef/.test(health.lastFailureMessage ?? ""));
    assert.match(health.lastFailureMessage ?? "", /REDACTED/);
  });
  it("recordProviderSuccess clears cooldown + consecutive failures", () => {
    resetProviderHealth();
    recordProviderFailure("anthropic", new Error("429"));
    recordProviderSuccess("anthropic");
    assert.equal(isProviderCooledDown("anthropic"), false);
    const h = getAllProviderHealth().find((h) => h.provider === "anthropic")!;
    assert.equal(h.consecutiveFailures, 0);
  });
});

describe("ai-provider-health admin endpoint contract", () => {
  it("requires ADMIN and exposes both GET (read) and POST (reset)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/api/admin/ai-provider-health/route.ts", "utf8");
    assert.match(source, /requireRole\(\s*"ADMIN"\s*\)/);
    assert.match(source, /export\s+async\s+function\s+GET/);
    assert.match(source, /export\s+async\s+function\s+POST/);
    assert.match(source, /resetProviderHealth/);
  });
});


describe("cross-instance restore merging", () => {
  it("DB cooldown remains authoritative when memory says provider is available", () => {
    resetProviderHealth();
    process.env.OPENAI_API_KEY = "sk-test-openai";
    recordProviderSuccess("openai");
    assert.equal(getProviderRuntimeSnapshot("openai").available, true);

    const now = Date.now();
    restoreProviderState("openai", {
      lastSuccessAt: null,
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
    assert.equal(runtime.lastFailureReason, "HTTP 429 Too Many Requests");
  });

  it("a cooled last-resort Anthropic provider does not mark available earlier providers unavailable", () => {
    resetProviderHealth();
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.GEMINI_API_KEY = "AIzaTestKeyNotUsedAtRuntime12345678901234567890";
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    recordProviderSuccess("openai");
    recordProviderSuccess("gemini");
    recordProviderFailure("anthropic", new Error("HTTP 429 Too Many Requests"));

    assert.equal(getProviderRuntimeSnapshot("anthropic").rateLimited, true);
    assert.equal(getProviderRuntimeSnapshot("openai").available, true);
    assert.equal(getProviderRuntimeSnapshot("gemini").available, true);
  });

  it("all configured providers cooling is distinguishable from a healthy chain", () => {
    resetProviderHealth();
    process.env.OPENAI_API_KEY = "sk-test-openai";
    process.env.GEMINI_API_KEY = "AIzaTestKeyNotUsedAtRuntime12345678901234567890";
    recordProviderFailure("openai", new Error("HTTP 429 Too Many Requests"));
    recordProviderFailure("gemini", new Error("HTTP 429 Too Many Requests"));

    const configured = ["openai", "gemini"] as const;
    assert.equal(configured.every((provider) => getProviderRuntimeSnapshot(provider).coolingDown), true);
    assert.equal(configured.some((provider) => getProviderRuntimeSnapshot(provider).available), false);
  });
});

describe("/api/ai/health DB restore contract", () => {
  it("restores DB health before response and degrades to a warning instead of crashing", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("app/api/ai/health/route.ts", "utf8");
    assert.match(source, /restoreProviderHealthBeforeResponse/);
    assert.match(source, /restoreHealthFromDb/);
    assert.match(source, /providerHealthRestoreWarning/);
    assert.match(source, /using in-memory provider health for this response/);
  });
});


describe("provider health DB persistence order", () => {
  it("uses the canonical runtime order (Mistral first, Anthropic last) for persistence iteration", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/ai-provider-health-db.ts", "utf8");
    const match = source.match(/ALL_PROVIDERS:\s*AiProviderName\[\]\s*=\s*\[([^\]]+)\]/);
    assert.ok(match, "ALL_PROVIDERS list must remain visible for source-level policy checks");
    const providers = Array.from(match[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    // Must mirror lib/ai.ts CANONICAL_PROVIDER_CHAIN exactly so that DB
    // snapshots, logs, and operator-facing artifacts all read in the same
    // runtime order. Anthropic stays last.
    assert.deepEqual(providers, ["mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"]);
  });
});
