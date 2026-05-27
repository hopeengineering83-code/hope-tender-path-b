// AI provider health tracker — classification, cooldown, reset.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAiError,
  recordProviderFailure,
  recordProviderSuccess,
  isProviderCooledDown,
  getAllProviderHealth,
  resetProviderHealth,
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
