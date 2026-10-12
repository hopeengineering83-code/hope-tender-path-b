import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { getProviderModel } from "../lib/ai-provider-registry";
import { resolveModelProfile } from "../lib/ai-model-profiles";

/**
 * THE DEFECT, read verbatim off the owner's Preview diagnostics.
 * --------------------------------------------------------------
 *   anthropic CONFIGURED analyze=False
 *     model=claude-sonnet-4-5,claude-opus-4-1,claude-3-5-sonnet-latest,claude-3-5-haiku-latest
 *     analysis: MALFORMED_RESPONSE -- empty response
 *
 * Anthropic's model env var is ANTHROPIC_PROPOSAL_MODELS -- plural, and
 * deliberately comma-separated, because the proposal path splits it and walks
 * the models in order. The registry maps only `proposalModel` for Anthropic,
 * so every OTHER use case fell through to the branch that borrows the proposal
 * env and returned the whole list as one model name.
 *
 * Two consequences, both silent:
 *
 *   1. No API resolves that string, so the last provider in the canonical
 *      chain could never answer an AI Analyze. The reason surfaced to the
 *      operator as "empty response" -- indistinguishable from a model that
 *      genuinely replied with nothing.
 *   2. It was quiet. Anthropic's family rule is anchored on `claude-`, so the
 *      joined string still matched it and the capability profile reported a
 *      normal 200K context. The limits looked healthy while the identifier
 *      being dispatched could never resolve.
 */

const LIST = "claude-sonnet-4-5,claude-opus-4-1,claude-3-5-sonnet-latest,claude-3-5-haiku-latest";

describe("a comma-separated model list never becomes a model name", () => {
  it("resolves one model for analysis when the proposal env holds a list", () => {
    const env = { NODE_ENV: "test", ANTHROPIC_PROPOSAL_MODELS: LIST } as NodeJS.ProcessEnv;
    const model = getProviderModel("anthropic", "extraction", env);
    assert.equal(model, "claude-sonnet-4-5");
    assert.doesNotMatch(model, /,/, "a model identifier must never contain a comma");
  });

  it("resolves one model for every use case, not just analysis", () => {
    const env = { NODE_ENV: "test", ANTHROPIC_PROPOSAL_MODELS: LIST } as NodeJS.ProcessEnv;
    for (const useCase of ["proposal", "extraction", "fast", "default", "validation", "reasoning"] as const) {
      const model = getProviderModel("anthropic", useCase, env);
      assert.doesNotMatch(model, /,/, `${useCase} resolved a list: ${model}`);
      assert.ok(model.length > 0, `${useCase} resolved empty`);
    }
  });

  it("resolves to a model the profile table can name exactly", () => {
    // NOT a claim that the joined string degraded the limits -- it did not.
    // Anthropic's family rule is anchored on `claude-`, so the joined string
    // matched it and reported the same 200K context. That is precisely what
    // made this defect quiet: the limits looked right while the identifier
    // being dispatched could never resolve. What matters is that the resolved
    // model is one name.
    const env = { NODE_ENV: "test", ANTHROPIC_PROPOSAL_MODELS: LIST } as NodeJS.ProcessEnv;
    const model = getProviderModel("anthropic", "extraction", env);
    const profile = resolveModelProfile("anthropic", model);
    assert.equal(profile.model, model);
    assert.doesNotMatch(profile.model, /,/);
    assert.ok(profile.contextTokens > 0);
  });

  it("leaves a single-model value exactly as configured", () => {
    // The policy is that model identifiers are used exactly as configured and
    // never silently replaced. Trimming a list to its head must not become
    // rewriting of an ordinary value.
    for (const [provider, envName, value] of [
      ["openai", "OPENAI_ANALYSIS_MODEL", "gpt-4o"],
      ["gemini", "GEMINI_ANALYSIS_MODEL", "gemini-3.5-flash"],
      ["groq", "GROQ_ANALYSIS_MODEL", "openai/gpt-oss-120b"],
      ["mistral", "MISTRAL_ANALYSIS_MODEL", "mistral-small-latest"],
      ["deepseek", "DEEPSEEK_ANALYSIS_MODEL", "deepseek-chat"],
    ] as const) {
      const env = { NODE_ENV: "test", [envName]: value } as NodeJS.ProcessEnv;
      assert.equal(getProviderModel(provider, "extraction", env), value);
    }
  });

  it("a model containing a slash is untouched — only commas separate", () => {
    // openai/gpt-oss-120b must survive intact; the separator is the comma.
    const env = { NODE_ENV: "test", GROQ_PROPOSAL_MODEL: "openai/gpt-oss-120b" } as NodeJS.ProcessEnv;
    assert.equal(getProviderModel("groq", "extraction", env), "openai/gpt-oss-120b");
  });

  it("falls back to the registry default when the list is empty or blank", () => {
    for (const raw of ["", "   ", ",", " , , "]) {
      const env = { NODE_ENV: "test", ANTHROPIC_PROPOSAL_MODELS: raw } as NodeJS.ProcessEnv;
      const model = getProviderModel("anthropic", "extraction", env);
      assert.equal(model, "claude-sonnet-4-5", `raw=${JSON.stringify(raw)}`);
    }
  });

  it("tolerates whitespace around the first entry", () => {
    const env = { NODE_ENV: "test", ANTHROPIC_PROPOSAL_MODELS: "  claude-opus-4-1 , claude-sonnet-4-5 " } as NodeJS.ProcessEnv;
    assert.equal(getProviderModel("anthropic", "extraction", env), "claude-opus-4-1");
  });
});
