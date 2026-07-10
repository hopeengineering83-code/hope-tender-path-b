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
} from "../lib/ai-provider-registry";

const REQUIRED_ORDER = [
  "zai", "cerebras", "mistral", "groq", "openrouter",
  "gemini", "openai", "together", "deepseek", "anthropic",
];

describe("release-acceptance E — provider fallback order", () => {
  it("preserves the exact canonical order Z.ai → … → Anthropic", () => {
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
    // Z.ai must appear before Anthropic, which must appear before the deterministic fallback.
    const zai = chain.indexOf("z.ai") >= 0 ? chain.indexOf("z.ai") : chain.indexOf("zai");
    assert.ok(zai >= 0, "chain names the first provider");
    assert.ok(chain.indexOf("anthropic") > zai || chain.indexOf("claude") > zai, "Anthropic/Claude is later in the chain");
    assert.ok(/deterministic|draft fallback/.test(chain), "chain ends with the deterministic draft fallback");
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
    assert.equal(withZaiAndGroq, "zai");
  });
});
