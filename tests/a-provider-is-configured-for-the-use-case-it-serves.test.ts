// A provider is configured for a request when the model slot THAT request uses
// is configured. Requiring every slot skipped Groq for AI Analyze when only
// GROQ_ANALYSIS_MODEL was set, and skipped Z.ai for proposal writing when only
// its fast model was invalid; checking the proposal slot alone skipped
// OpenRouter when only OPENROUTER_ANALYSIS_MODEL was set. Equally, a slot that
// is not configured must not be treated as configured because another one is.
// The chain order itself is not touched.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { isProviderConfigured, providerAutomaticEligibility, getAutomaticProviderOrder } from "../lib/ai-provider-registry";
import { isAnyProviderEligible } from "../lib/ai-analyze/retry-service";
import { planAnalysisChunks } from "../lib/ai";
import { runCapabilityTest } from "../lib/ai-provider-capability-test";

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
const USE_CASES = ["extraction", "proposal", "fast"] as const;
const configuredFor = (provider: Parameters<typeof isProviderConfigured>[0], e: NodeJS.ProcessEnv) =>
  Object.fromEntries(USE_CASES.map((u) => [u, isProviderConfigured(provider, e, u)]));

describe("a provider is configured for exactly the use cases its models serve", () => {
  it("Groq with only an analysis model: AI Analyze yes, proposal and fast no", () => {
    assert.deepEqual(configuredFor("groq", env({ GROQ_API_KEY: "k", GROQ_ANALYSIS_MODEL: "llama-3.3-70b-versatile" })), { extraction: true, proposal: false, fast: false });
  });
  it("Groq with only a fast model is not configured for AI Analyze", () => {
    assert.deepEqual(configuredFor("groq", env({ GROQ_API_KEY: "k", GROQ_FAST_MODEL: "llama-3.1-8b-instant" })), { extraction: false, proposal: false, fast: true });
  });
  it("Groq with a proposal model serves every use case (the others fall back to it)", () => {
    assert.deepEqual(configuredFor("groq", env({ GROQ_API_KEY: "k", GROQ_PROPOSAL_MODEL: "llama-3.3-70b-versatile" })), { extraction: true, proposal: true, fast: true });
  });
  it("OpenRouter with only an analysis model: AI Analyze yes, proposal no", () => {
    const e = env({ OPENROUTER_API_KEY: "k", OPENROUTER_ANALYSIS_MODEL: "meta-llama/llama-3.3-70b-instruct:free" });
    assert.deepEqual(configuredFor("openrouter", e), { extraction: true, proposal: false, fast: false });
    assert.notEqual(providerAutomaticEligibility("openrouter", e, "extraction").reason, "NOT_CONFIGURED");
    assert.equal(providerAutomaticEligibility("openrouter", e, "proposal").reason, "NOT_CONFIGURED");
  });
  it("Z.ai with a valid proposal model and an invalid fast model still writes proposals", () => {
    const e = env({ ZAI_API_KEY: "k", ZAI_PROPOSAL_MODEL: "glm-4.7-flash", ZAI_ANALYSIS_MODEL: "glm-4.7-flash", ZAI_FAST_MODEL: "gpt-4o-mini" });
    assert.deepEqual(configuredFor("zai", e), { extraction: true, proposal: true, fast: false });
    assert.equal(providerAutomaticEligibility("zai", e, "proposal").eligible, true);
  });
  it("no key is no provider, whatever models are set", () => {
    for (const p of ["groq", "openrouter", "zai"] as const) {
      const e = env({ GROQ_ANALYSIS_MODEL: "m", OPENROUTER_ANALYSIS_MODEL: "m", ZAI_ANALYSIS_MODEL: "glm-4.7-flash" });
      assert.deepEqual(configuredFor(p, e), { extraction: false, proposal: false, fast: false }, p);
    }
  });
  it("the canonical ten-provider order is unchanged", () => {
    assert.deepEqual([...getAutomaticProviderOrder()], ["gemini", "groq", "mistral", "zai", "cerebras", "openrouter", "openai", "together", "deepseek", "anthropic"]);
  });
});

describe("every caller asks about the use case it will run", () => {
  const groqFastOnly = env({ GROQ_API_KEY: "k", GROQ_FAST_MODEL: "llama-3.1-8b-instant" });
  const groqAnalysisOnly = env({ GROQ_API_KEY: "k", GROQ_ANALYSIS_MODEL: "llama-3.3-70b-versatile" });

  it("AI Analyze chunk planning counts only providers configured for analysis", () => {
    assert.ok(!planAnalysisChunks("Tender text.", groqFastOnly).configuredProviders.includes("groq"), "a fast-only Groq cannot analyze");
    assert.ok(planAnalysisChunks("Tender text.", groqAnalysisOnly).configuredProviders.includes("groq"), "an analysis-only Groq can");
  });
  it("the AI Analyze retry gate asks about the retry's own use case", () => {
    assert.equal(isAnyProviderEligible("extraction", groqAnalysisOnly), true);
    assert.equal(isAnyProviderEligible("extraction", groqFastOnly), false);
  });
  it("a capability test of a use case the provider is not configured for is skipped as not configured, never sent with no model", async () => {
    const result = await runCapabilityTest("groq", "generation", { env: groqAnalysisOnly });
    assert.equal(result.status, "skipped");
    assert.equal(result.category, null, "not a configuration error: the proposal slot is simply not configured");
    assert.equal(result.model, null);
  });
  it("the analysis-usable list checks the analysis slot", () => {
    assert.match(readFileSync("lib/ai-provider-health.ts", "utf8"), /export function analysisUsableProviders[\s\S]*?providerAutomaticEligibility\(provider, process\.env, "extraction"\)/);
  });
});
