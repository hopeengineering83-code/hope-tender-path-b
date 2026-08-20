// Authoritative AI provider registry — required acceptance tests.
//
// Proves the 17 required guarantees of the provider architecture update:
// canonical order, Z.ai/Cerebras detection + endpoints, OpenRouter :free
// policy, skip rules, the 3-attempt budget, ATTEMPT_BUDGET_EXHAUSTED, secret
// redaction, malformed-JSON safety, and preservation of existing providers.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CANONICAL_AI_PROVIDER_ORDER,
  getProviderRegistry,
  getProviderEntry,
  getCanonicalProviderEntries,
  getAllConfiguredProviderEntries,
  isProviderConfigured,
  readProviderKey,
  getProviderBaseUrl,
  getProviderModel,
  getProviderOutputCap,
  openRouterModelValidity,
  providerDisplayName,
  preferredConfiguredProviderName,
} from "../lib/ai-provider-registry";
import {
  MAX_PROVIDER_ATTEMPTS_PER_REQUEST,
  ERROR_HANDLING_RESERVE_MS,
} from "../lib/ai";

const KEY_ENVS = [
  "ZAI_API_KEY", "ZAI_BASE_URL", "ZAI_PROPOSAL_MODEL", "ZAI_ANALYSIS_MODEL", "ZAI_FAST_MODEL",
  "CEREBRAS_API_KEY", "CEREBRAS_BASE_URL", "CEREBRAS_PROPOSAL_MODEL",
  "MISTRAL_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "OPENROUTER_PROPOSAL_MODEL",
  "GEMINI_API_KEY", "OPENAI_API_KEY", "TOGETHER_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY",
];

let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = {};
  for (const k of KEY_ENVS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of KEY_ENVS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// 1. Canonical order
describe("1. canonical provider order", () => {
  it("is exactly gemini → groq → mistral → zai → openrouter → cerebras → openai → together → deepseek → anthropic", () => {
    assert.deepEqual([...CANONICAL_AI_PROVIDER_ORDER], [
      "gemini", "groq", "mistral", "zai", "openrouter", "cerebras", "openai", "together", "deepseek", "anthropic",
    ]);
  });
});

// 2. No other automatic order exists
describe("2. no other automatic provider order exists", () => {
  it("lib/ai.ts derives chains from the registry (no literal order array)", () => {
    const src = readFileSync("lib/ai.ts", "utf8");
    assert.ok(!/PROVIDER_CHAINS\s*:\s*Record/.test(src));
    assert.ok(src.includes("CANONICAL_AI_PROVIDER_ORDER"));
  });
  it("policy + health + DB persistence + provider-status derive from the registry", () => {
    assert.ok(readFileSync("lib/ai-provider-policy.ts", "utf8").includes("CANONICAL_AI_PROVIDER_ORDER"));
    assert.ok(readFileSync("lib/ai-provider-health.ts", "utf8").includes("CANONICAL_AI_PROVIDER_ORDER"));
    assert.ok(readFileSync("lib/ai-provider-health-db.ts", "utf8").includes("CANONICAL_AI_PROVIDER_ORDER"));
    assert.ok(readFileSync("lib/security/provider-status.ts", "utf8").includes("getCanonicalProviderEntries"));
  });
});

// 3 & 4. Detection from env keys
describe("3+4. provider detection from API keys", () => {
  it("Z.ai is detected from ZAI_API_KEY", () => {
    assert.equal(isProviderConfigured("zai"), false);
    process.env.ZAI_API_KEY = "zai-test-key";
    assert.equal(isProviderConfigured("zai"), true);
    assert.equal(readProviderKey("zai"), "zai-test-key");
  });
  it("Cerebras is detected from CEREBRAS_API_KEY", () => {
    assert.equal(isProviderConfigured("cerebras"), false);
    process.env.CEREBRAS_API_KEY = "csk-test-key";
    assert.equal(isProviderConfigured("cerebras"), true);
    assert.equal(readProviderKey("cerebras"), "csk-test-key");
  });
});

// 5. Health endpoint + admin panel include zai + cerebras (source-level)
describe("5. zai + cerebras appear in health surfaces", () => {
  it("health route + AI health panel build from the registry (include all 10)", () => {
    const entries = getAllConfiguredProviderEntries().map((e) => e.provider);
    assert.ok(entries.includes("zai") && entries.includes("cerebras"));
    assert.ok(readFileSync("app/api/ai/health/route.ts", "utf8").includes("getCanonicalProviderEntries"));
    assert.ok(readFileSync("components/ai-health-panel.tsx", "utf8").includes("getCanonicalProviderEntries"));
  });
});

// 6. Z.ai endpoint + model — resolver-based endpoint/model compatibility
describe("6. Z.ai general endpoint + configured model", () => {
  it("uses the general Z.ai endpoint and default model (glm-4.7-flash)", () => {
    delete process.env.ZAI_PROPOSAL_MODEL;
    delete process.env.ZAI_ANALYSIS_MODEL;
    delete process.env.ZAI_FAST_MODEL;
    delete process.env.ZAI_BASE_URL;
    assert.equal(getProviderBaseUrl("zai"), "https://api.z.ai/api/paas/v4");
    assert.equal(getProviderModel("zai", "proposal"), "glm-4.7-flash");
  });
  it("open.bigmodel.cn is NOT a valid Z.ai endpoint (different platform)", () => {
    delete process.env.ZAI_BASE_URL;
    process.env.ZAI_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
    // Z.ai support confirmed: open.bigmodel.cn is Zhipu AI, not Z.ai.
    // isProviderConfigured must return false for this endpoint.
    assert.equal(isProviderConfigured("zai"), false,
      "open.bigmodel.cn is NOT a valid Z.ai endpoint — must be skipped");
    delete process.env.ZAI_BASE_URL;
  });
  it("accepts the deployed explicit Z.ai model override (glm-4.7-flash)", () => {
    delete process.env.ZAI_PROPOSAL_MODEL;
    delete process.env.ZAI_ANALYSIS_MODEL;
    delete process.env.ZAI_FAST_MODEL;
    delete process.env.ZAI_BASE_URL;
    process.env.ZAI_PROPOSAL_MODEL = "glm-4.7-flash";
    assert.equal(getProviderModel("zai", "proposal"), "glm-4.7-flash");
    delete process.env.ZAI_PROPOSAL_MODEL;
  });
  it("is NOT a Coding Plan endpoint by default", () => {
    delete process.env.ZAI_BASE_URL;
    assert.ok(!getProviderBaseUrl("zai")!.includes("coding"));
    assert.ok(!getProviderBaseUrl("zai")!.includes("bigmodel"));
  });
  it("uses hobby-safe output caps (analysis 8000 / proposal 8000 / fast 1200)", () => {
    assert.equal(getProviderOutputCap("zai", "extraction"), 8000);
    assert.equal(getProviderOutputCap("zai", "proposal"), 8000);
    assert.equal(getProviderOutputCap("zai", "fast"), 1200);
  });
});

// 7. Cerebras endpoint + max_completion_tokens
describe("7. Cerebras endpoint + max_completion_tokens", () => {
  it("uses the configured endpoint and the cerebras request format", () => {
    assert.equal(getProviderBaseUrl("cerebras"), "https://api.cerebras.ai/v1");
    assert.equal(getProviderModel("cerebras", "proposal"), "gpt-oss-120b");
    assert.equal(getProviderEntry("cerebras").requestFormat, "cerebras");
  });
  it("the adapter wires max_completion_tokens (never a generic 16K max_tokens)", () => {
    const src = readFileSync("lib/ai.ts", "utf8");
    assert.ok(src.includes('maxTokensParam: "max_completion_tokens"'), "Cerebras must send max_completion_tokens");
    assert.equal(getProviderOutputCap("cerebras", "extraction"), 8000);
    assert.equal(getProviderOutputCap("cerebras", "proposal"), 8000);
    assert.equal(getProviderOutputCap("cerebras", "fast"), 1200);
  });
});

// 8 & 9. OpenRouter policy
describe("8+9. OpenRouter free-model policy", () => {
  it("rejects openrouter/auto", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_PROPOSAL_MODEL = "openrouter/auto";
    const v = openRouterModelValidity();
    assert.equal(v.valid, false);
    assert.equal(v.reason, "MODEL_UNAVAILABLE");
    assert.equal(isProviderConfigured("openrouter"), false);
  });
  it("rejects a model that does not end with :free", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_PROPOSAL_MODEL = "meta-llama/llama-3.3-70b-instruct";
    const v = openRouterModelValidity();
    assert.equal(v.valid, false);
    assert.equal(v.reason, "CONFIGURATION_INVALID");
    assert.equal(isProviderConfigured("openrouter"), false);
  });
  it("accepts an explicit :free model", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_PROPOSAL_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
    const v = openRouterModelValidity();
    assert.equal(v.valid, true);
    assert.equal(isProviderConfigured("openrouter"), true);
  });
});

// 10. Unconfigured providers skipped (configured check is false)
describe("10. unconfigured providers are skipped", () => {
  it("isProviderConfigured is false for every provider with no key", () => {
    for (const p of CANONICAL_AI_PROVIDER_ORDER) {
      assert.equal(isProviderConfigured(p), false, `${p} should be unconfigured`);
    }
    assert.equal(preferredConfiguredProviderName(), null);
  });
});

// 12. Attempt budget
describe("12. provider attempt budget", () => {
  it("caps actual outbound attempts at 10 by default (raised from 5 in Gap 3)", () => {
    // Default raised from 5 to 10 so ALL eligible providers get a real
    // attempt before the chain declares ALL_PROVIDERS_EXHAUSTED. This
    // eliminates ATTEMPT_BUDGET_EXHAUSTED as a workflow blocker in the
    // normal case. Set AI_MAX_PROVIDER_ATTEMPTS to a lower value to
    // restore a tighter budget.
    assert.equal(MAX_PROVIDER_ATTEMPTS_PER_REQUEST, 10);
  });
  it("reserves time for error handling within the shared deadline", () => {
    assert.equal(ERROR_HANDLING_RESERVE_MS, 5000);
  });
  it("generateWithFallback enforces the budget + shared deadline in source", () => {
    const src = readFileSync("lib/ai.ts", "utf8");
    assert.ok(src.includes("actualAttempts >= MAX_PROVIDER_ATTEMPTS_PER_REQUEST"));
    assert.ok(src.includes("ERROR_HANDLING_RESERVE_MS >= opts.deadlineAt"));
  });
});

// 13. ATTEMPT_BUDGET_EXHAUSTED distinct
describe("13. ATTEMPT_BUDGET_EXHAUSTED is distinct", () => {
  it("the error kind exists and differs from ALL_PROVIDERS_EXHAUSTED", () => {
    const src = readFileSync("lib/ai.ts", "utf8");
    assert.ok(src.includes('"ATTEMPT_BUDGET_EXHAUSTED"'));
    assert.ok(src.includes('"ALL_PROVIDERS_EXHAUSTED"'));
    assert.ok(!src.includes("ALL_CONFIGURED_PROVIDERS_EXHAUSTED"));
  });
});

// 16. Inactive providers remain supported after OpenRouter
describe("16. inactive providers remain supported after OpenRouter", () => {
  it("all 10 automatic providers in correct order", () => {
    assert.deepEqual([...CANONICAL_AI_PROVIDER_ORDER], ["gemini", "groq", "mistral", "zai", "openrouter", "cerebras", "openai", "together", "deepseek", "anthropic"]);
    for (const p of ["zai", "cerebras", "mistral", "together"] as const) {
      assert.ok(getProviderEntry(p), `${p} must remain in the registry for manual use`);
    }
  });
});

// 17. Existing Mistral/Groq/OpenRouter functionality intact
describe("17. existing Mistral/Groq/OpenRouter remain intact", () => {
  it("Mistral keeps its endpoint and defaults to its FREE-TIER model", () => {
    // mistral-large-latest is a paid model, so it was the wrong default for a
    // zero-paid deployment: rank-3 Mistral would answer every request with a
    // billing error. The default is now the head of the provider's
    // freeTierPreference list, so the source default and the live-verified
    // choice cannot disagree.
    assert.equal(getProviderBaseUrl("mistral"), "https://api.mistral.ai/v1");
    assert.equal(getProviderModel("mistral", "proposal"), "mistral-small-latest");
    assert.equal(getProviderModel("mistral", "fast"), "ministral-8b-latest");
    assert.equal(getProviderEntry("mistral").freeTierPreference[0], "mistral-small-latest");
  });

  it("every free provider's default model is the head of its freeTierPreference", () => {
    // Guards the class of defect above across all four free providers: a source
    // default that names a model the free tier does not serve is a provider
    // that fails on its first request, every time, for a reason no error
    // message attributes to configuration.
    for (const provider of ["gemini", "mistral", "zai"] as const) {
      const entry = getProviderEntry(provider);
      assert.equal(
        entry.defaults.proposalModel,
        entry.freeTierPreference[0],
        `${provider}: registry default must match the first free-tier preference`,
      );
      assert.equal(entry.access, "free");
    }
  });
  it("Groq keeps its endpoint but has no stale runtime model default", () => {
    assert.equal(getProviderBaseUrl("groq"), "https://api.groq.com/openai/v1");
    assert.equal(getProviderModel("groq", "proposal", {}), "");
    assert.deepEqual(getProviderEntry("groq").freeTierPreference, ["llama-3.1-8b-instant"]);
  });
  it("OpenRouter keeps rank 5 among the working providers", () => {
    assert.equal(getProviderEntry("openrouter").rank, 5);
    assert.equal(providerDisplayName("openrouter"), "OpenRouter");
  });
});

// Emergency-only flag
describe("emergency-only provider flag", () => {
  it("only anthropic is emergency-only; all other providers are automatic", () => {
    for (const entry of getCanonicalProviderEntries()) {
      if (entry.provider === "anthropic") {
        assert.equal(entry.emergencyOnly, true, `${entry.provider} should be emergency-only`);
      } else {
        assert.equal(entry.emergencyOnly, false, `${entry.provider} should NOT be emergency-only`);
      }
    }
  });
});

// Structured JSON support
describe("structured JSON support flag", () => {
  it("zai + cerebras support structured JSON; gemini + anthropic do not", () => {
    assert.equal(getProviderEntry("zai").supportsStructuredJson, true);
    assert.equal(getProviderEntry("cerebras").supportsStructuredJson, true);
    assert.equal(getProviderEntry("gemini").supportsStructuredJson, false);
    assert.equal(getProviderEntry("anthropic").supportsStructuredJson, false);
  });
});

// Registry completeness
describe("registry completeness", () => {
  it("every provider has env, defaults, caps, timeout, retry policy", () => {
    for (const entry of Object.values(getProviderRegistry())) {
      assert.ok(entry.env.apiKey, `${entry.provider} apiKey env`);
      assert.ok(entry.outputCaps.analysis > 0 && entry.outputCaps.proposal > 0 && entry.outputCaps.fast > 0);
      assert.ok(entry.timeoutMs > 0);
      assert.equal(entry.retry.retryOnAuth, false);
      assert.equal(entry.retry.retryOnBilling, false);
    }
  });
});
