import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AI_PROVIDER_ORDER, getSafeProviderStatus, hasAnyProviderConfigured } from "../lib/security/provider-status";

describe("safe provider status", () => {
  it("keeps Anthropic last in provider order", () => {
    assert.equal(AI_PROVIDER_ORDER.at(-1)?.provider, "Anthropic / Claude");
    assert.equal(AI_PROVIDER_ORDER.at(-1)?.order, 10);
  });

  it("uses the canonical runtime order (Gemini first, Anthropic last)", () => {
    // Derived from the registry (lib/ai-provider-registry.ts). Reordering is a
    // breaking change that requires an explicit product decision in the registry.
    assert.deepEqual(
      AI_PROVIDER_ORDER.map((p) => p.provider),
      ["Gemini", "Groq", "Mistral", "Z.ai GLM", "Cerebras", "OpenRouter", "OpenAI", "Together", "DeepSeek", "Anthropic / Claude"],
    );
    assert.deepEqual(
      AI_PROVIDER_ORDER.map((p) => p.order),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
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
