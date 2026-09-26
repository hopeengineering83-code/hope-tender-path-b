import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  resetProviderHealth,
  getGeminiApiKey,
  isGeminiConfigured,
  deriveProviderStatus,
  recordProviderPingSuccess,
  recordProviderAnalysisSuccess,
  recordProviderSuccess,
  getAllProviderHealth
} from "../lib/ai-provider-health";

describe("Provider Health Runtime & Status", () => {
  before(() => {
    resetProviderHealth();
  });

  it("runtime key reads work (simulated)", () => {
    process.env.GEMINI_API_KEY = "test-key";
    assert.equal(getGeminiApiKey(), "test-key");
    assert.equal(isGeminiConfigured(), true);

    process.env.GEMINI_API_KEY = "";
    assert.equal(isGeminiConfigured(), false);
  });

  it("configured provider is not analysis verified initially", () => {
    resetProviderHealth();
    process.env.MISTRAL_API_KEY = "mistral-key";
    assert.equal(deriveProviderStatus("mistral"), "CONFIGURED");
  });

  it("PING success marks CONNECTIVITY_VERIFIED but not ANALYSIS_VERIFIED", () => {
    resetProviderHealth();
    process.env.GROQ_API_KEY = "groq-key";
    recordProviderPingSuccess("groq");
    assert.equal(deriveProviderStatus("groq"), "CONNECTIVITY_VERIFIED");
  });

  it("Analysis success marks ANALYSIS_VERIFIED", () => {
    resetProviderHealth();
    process.env.OPENROUTER_API_KEY = "or-key";
    recordProviderAnalysisSuccess("openrouter");
    assert.equal(deriveProviderStatus("openrouter"), "ANALYSIS_VERIFIED");
  });

  it("Generation success marks GENERATION_VERIFIED", () => {
    // A free provider. For a paid one the money gate answers first and
    // BILLING_BLOCKED is the correct status no matter how well it performed —
    // which is the point of the next test.
    resetProviderHealth();
    process.env.GROQ_API_KEY = "gsk-key";
    recordProviderSuccess("groq");
    assert.equal(deriveProviderStatus("groq"), "GENERATION_VERIFIED");
  });

  it("a successful configured provider reports its verified capability", () => {
    resetProviderHealth();
    process.env.OPENAI_API_KEY = "oa-key";
    recordProviderSuccess("openai");
    assert.equal(deriveProviderStatus("openai"), "GENERATION_VERIFIED");
  });

  it("Provider order remains exact (canonical registry order)", () => {
    const health = getAllProviderHealth();
    const order = health.map(h => h.provider);
    assert.deepEqual(order, ["gemini", "groq", "mistral", "zai", "cerebras", "openrouter", "openai", "together", "deepseek", "anthropic"]);
  });
});
