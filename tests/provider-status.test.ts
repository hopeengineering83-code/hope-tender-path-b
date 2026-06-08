import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AI_PROVIDER_ORDER, getSafeProviderStatus, hasAnyProviderConfigured } from "../lib/security/provider-status";

describe("safe provider status", () => {
  it("keeps Anthropic last in provider order", () => {
    assert.equal(AI_PROVIDER_ORDER.at(-1)?.provider, "Anthropic");
    assert.equal(AI_PROVIDER_ORDER.at(-1)?.order, 8);
  });

  it("reports configured/not configured without exposing values", () => {
    const status = getSafeProviderStatus({ GEMINI_API_KEY: "real-value-not-returned", OPENAI_API_KEY: undefined });
    const gemini = status.find((item) => item.provider === "Gemini");
    assert.equal(gemini?.configured, true);
    assert.deepEqual(Object.keys(gemini ?? {}).sort(), ["configured", "envName", "order", "provider"].sort());
    assert.equal(JSON.stringify(status).includes("real-value-not-returned"), false);
  });

  it("detects whether any provider is configured", () => {
    assert.equal(hasAnyProviderConfigured({}), false);
    assert.equal(hasAnyProviderConfigured({ GROQ_API_KEY: "present" }), true);
  });
});
