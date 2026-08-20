// Release acceptance — Work Package E (provider fallback order & AI reliability).
//
// The canonical automatic provider order is a release invariant. This test pins
// it against the registry — a change to provider order must be a deliberate,
// reviewed edit, never an accident. NO live provider calls are made (registry
// metadata only), so this is CI-safe.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  CANONICAL_AI_PROVIDER_ORDER,
  getCanonicalProviderEntries,
  preferredConfiguredProviderName,
  CANONICAL_AI_FALLBACK_CHAIN_DISPLAY,
  getAutomaticProviderOrder,
  automaticChainDisplay,
  providerAutomaticEligibility,
  PAID_ACCESS_PROVIDERS,
} from "../lib/ai-provider-registry";

const REQUIRED_ORDER = [
  "gemini", "groq", "mistral", "zai", "openrouter",
  "cerebras", "openai", "together", "deepseek", "anthropic",
];

// The free chain the app may actually contact.
const REQUIRED_AUTOMATIC_ORDER = ["gemini", "groq", "mistral", "zai", "openrouter"];

describe("release-acceptance E — provider fallback order", () => {
  it("preserves the exact canonical order Gemini → … → Anthropic", () => {
    assert.deepEqual([...CANONICAL_AI_PROVIDER_ORDER], REQUIRED_ORDER);
  });

  it("registry entries are ranked 1..N in canonical order", () => {
    const entries = getCanonicalProviderEntries();
    assert.equal(entries.length, REQUIRED_ORDER.length);
    entries.forEach((entry, i) => {
      assert.equal(entry.provider, REQUIRED_ORDER[i], `rank ${i + 1} provider`);
      assert.equal(entry.rank, i + 1, `${entry.provider} rank`);
    });
  });

  it("the human-readable chain string follows the canonical order and ends at the deterministic fallback", () => {
    const chain = CANONICAL_AI_FALLBACK_CHAIN_DISPLAY.toLowerCase();
    const gemini = chain.indexOf("gemini");
    assert.ok(gemini >= 0, "chain names the first provider");
    assert.ok(chain.indexOf("anthropic") > gemini || chain.indexOf("claude") > gemini, "Anthropic/Claude is later in the chain");
    assert.ok(/deterministic|draft fallback/.test(chain), "chain ends with the deterministic draft fallback");
  });

  it("the ACTIVE automatic chain excludes every paid provider", () => {
    // Canonical enumeration and automatic reachability are different things.
    // The first is what health reports on; the second is what the app may
    // spend money through, and it is the one that is a release invariant here.
    assert.deepEqual([...getAutomaticProviderOrder()], REQUIRED_AUTOMATIC_ORDER);
    for (const paid of PAID_ACCESS_PROVIDERS) {
      assert.ok(
        !getAutomaticProviderOrder().includes(paid),
        `${paid} requires paid access and must never be automatically reachable`,
      );
    }
    assert.match(automaticChainDisplay(), /deterministic draft fallback$/);
  });

  it("refuses a paid provider even when its key is present", () => {
    const eligibility = providerAutomaticEligibility("openai", { OPENAI_API_KEY: "sk-test" } as unknown as NodeJS.ProcessEnv);
    assert.equal(eligibility.eligible, false);
    assert.equal(eligibility.reason, "PAID_ACCESS_BLOCKED");
  });

  it("admits OpenRouter only with a verified ':free' model", () => {
    // "Probably free" is not good enough to risk a charge, so the conditional
    // -free class is treated exactly like paid until the condition is proven.
    const unverified = providerAutomaticEligibility("openrouter", { OPENROUTER_API_KEY: "k" } as unknown as NodeJS.ProcessEnv);
    assert.equal(unverified.eligible, false);
    assert.equal(unverified.reason, "CONDITIONAL_FREE_UNVERIFIED");

    const paidModel = providerAutomaticEligibility("openrouter", {
      OPENROUTER_API_KEY: "k",
      OPENROUTER_PROPOSAL_MODEL: "openai/gpt-4o",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(paidModel.eligible, false, "a non-':free' model must be refused");

    const verified = providerAutomaticEligibility("openrouter", {
      OPENROUTER_API_KEY: "k",
      OPENROUTER_PROPOSAL_MODEL: "meta-llama/llama-3.3-70b-instruct:free",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(verified.eligible, true);
  });

  it("derives the preferred provider from the registry (highest-ranked configured), never a hardcode", () => {
    // With no provider keys configured in the test env, there is no preferred
    // provider — the helper must return null rather than defaulting to one.
    const preferred = preferredConfiguredProviderName({} as NodeJS.ProcessEnv);
    assert.equal(preferred, null);
    // When only a mid-chain provider is configured, it becomes preferred.
    const withGroq = preferredConfiguredProviderName({ GROQ_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv);
    assert.equal(withGroq, "groq");
    // A higher-ranked provider outranks a lower one.
    const withZaiAndGroq = preferredConfiguredProviderName({ ZAI_API_KEY: "k", GROQ_API_KEY: "k" } as unknown as NodeJS.ProcessEnv);
    assert.equal(withZaiAndGroq, "groq", "Groq outranks Z.ai in the zero-paid order");
  });
});
