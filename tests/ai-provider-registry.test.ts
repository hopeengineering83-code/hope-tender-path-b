import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getProviderBaseUrl,
  getProviderModel,
  isProviderConfigured,
  getProviderEntry,
  getCanonicalProviderEntries,
  CANONICAL_AI_PROVIDER_ORDER,
  preferredConfiguredProviderName,
  getProviderOutputCap,
  getProviderRegistry,
  providerDisplayName,
  openRouterModelValidity,
} from "../lib/ai-provider-registry";
import { MAX_PROVIDER_ATTEMPTS_PER_REQUEST, ERROR_HANDLING_RESERVE_MS } from "../lib/ai";
import { PROVIDER_API_KEY_ENV } from "../lib/ai-provider-catalog.cjs";
import { readProviderKey } from "../lib/ai-provider-registry";

describe("1. canonical provider order", () => {
  it("is exactly zai → cerebras → mistral → groq → openrouter → gemini → openai → together → deepseek → anthropic", () => {
    assert.deepEqual([...CANONICAL_AI_PROVIDER_ORDER], [
      "zai",
      "cerebras",
      "mistral",
      "groq",
      "openrouter",
      "gemini",
      "openai",
      "together",
      "deepseek",
      "anthropic",
    ]);
  });
});

describe("2. no other automatic provider order exists", () => {
  it("lib/ai.ts derives chains from the registry (no literal order array)", () => {
    const src = readFileSync("lib/ai.ts", "utf8");
    assert.ok(!src.includes('["zai", "cerebras"'), "lib/ai.ts should not hardcode provider order");
    assert.ok(src.includes("CANONICAL_AI_PROVIDER_ORDER"), "lib/ai.ts should use registry order");
  });

  it("policy + health + DB persistence + provider-status derive from the registry", () => {
    const files = [
      "lib/ai-provider-health.ts",
      "lib/ai-provider-health-db.ts",
      "app/api/ai/health/route.ts",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      assert.ok(!src.includes('["zai", "cerebras"'), `${f} should not hardcode provider order`);
    }
  });
});

describe("3+4. provider detection from API keys", () => {
  it("Z.ai is detected from ZAI_API_KEY", () => {
    const old = process.env.ZAI_API_KEY;
    process.env.ZAI_API_KEY = "test-key";
    assert.equal(isProviderConfigured("zai"), true);
    assert.equal(readProviderKey("zai"), "test-key");
    if (old) process.env.ZAI_API_KEY = old; else delete process.env.ZAI_API_KEY;
  });

  it("Cerebras is detected from CEREBRAS_API_KEY", () => {
    const old = process.env.CEREBRAS_API_KEY;
    process.env.CEREBRAS_API_KEY = "csk-test-key";
    assert.equal(isProviderConfigured("cerebras"), true);
    assert.equal(readProviderKey("cerebras"), "csk-test-key");
    if (old) process.env.CEREBRAS_API_KEY = old; else delete process.env.CEREBRAS_API_KEY;
  });
});

describe("5. zai + cerebras appear in health surfaces", () => {
  it("health route + AI health panel build from the registry (include all 10)", () => {
    const entries = getCanonicalProviderEntries().map((e) => e.provider);
    assert.ok(entries.includes("zai") && entries.includes("cerebras"));
    assert.ok(readFileSync("app/api/ai/health/route.ts", "utf8").includes("getCanonicalProviderEntries"));
    assert.ok(readFileSync("components/ai-health-panel.tsx", "utf8").includes("getCanonicalProviderEntries"));
  });
});

describe("6. Z.ai general endpoint + configured model", () => {
  it("uses the general Z.ai endpoint and configured/default model", () => {
    const oldProp = process.env.ZAI_PROPOSAL_MODEL;
    const oldAn = process.env.ZAI_ANALYSIS_MODEL;
    const oldFast = process.env.ZAI_FAST_MODEL;
    const oldBase = process.env.ZAI_BASE_URL;

    delete process.env.ZAI_PROPOSAL_MODEL;
    delete process.env.ZAI_ANALYSIS_MODEL;
    delete process.env.ZAI_FAST_MODEL;
    assert.equal(getProviderBaseUrl("zai"), "https://api.z.ai/api/paas/v4");
    assert.equal(getProviderModel("zai", "proposal"), "glm-4-flash");

    process.env.ZAI_BASE_URL = "https://api.z.ai/api/paas/v4/custom";
    process.env.ZAI_ANALYSIS_MODEL = "glm-4.5-flash";
    assert.equal(getProviderBaseUrl("zai"), "https://api.z.ai/api/paas/v4/custom");
    assert.equal(getProviderModel("zai", "extraction"), "glm-4-flash",
      "glm-4.5-flash override must fall back to glm-4-flash (allowlist guard)");

    if (oldProp) process.env.ZAI_PROPOSAL_MODEL = oldProp; else delete process.env.ZAI_PROPOSAL_MODEL;
    if (oldAn) process.env.ZAI_ANALYSIS_MODEL = oldAn; else delete process.env.ZAI_ANALYSIS_MODEL;
    if (oldFast) process.env.ZAI_FAST_MODEL = oldFast; else delete process.env.ZAI_FAST_MODEL;
    if (oldBase) process.env.ZAI_BASE_URL = oldBase; else delete process.env.ZAI_BASE_URL;
  });

  it("rejects bare 'glm-4' as a Z.ai model override (HTTP 400 'Unknown Model')", () => {
    const old = process.env.ZAI_PROPOSAL_MODEL;
    process.env.ZAI_PROPOSAL_MODEL = "glm-4";
    assert.equal(getProviderModel("zai", "proposal"), "glm-4-flash",
      "bare 'glm-4' override must fall back to glm-4-flash (allowlist guard)");
    if (old) process.env.ZAI_PROPOSAL_MODEL = old; else delete process.env.ZAI_PROPOSAL_MODEL;
  });

  it("rejects ANY value not in the allowlist (positive allowlist, not rejection set)", () => {
    const old = process.env.ZAI_PROPOSAL_MODEL;
    for (const bad of ["gpt-4", "claude-3", "glm-4.7-flash"]) {
      process.env.ZAI_PROPOSAL_MODEL = bad;
      assert.equal(getProviderModel("zai", "proposal"), "glm-4-flash",
        `'${bad}' override must fall back to glm-4-flash (positive allowlist)`);
    }
    if (old) process.env.ZAI_PROPOSAL_MODEL = old; else delete process.env.ZAI_PROPOSAL_MODEL;
  });

  it("accepts a valid explicit Z.ai model override (glm-4-flash)", () => {
    const old = process.env.ZAI_PROPOSAL_MODEL;
    process.env.ZAI_PROPOSAL_MODEL = "glm-4-flash";
    assert.equal(getProviderModel("zai", "proposal"), "glm-4-flash");
    if (old) process.env.ZAI_PROPOSAL_MODEL = old; else delete process.env.ZAI_PROPOSAL_MODEL;
  });

  it("accepts glm-4-flash case-insensitively", () => {
    const old = process.env.ZAI_PROPOSAL_MODEL;
    process.env.ZAI_PROPOSAL_MODEL = "GLM-4-FLASH";
    assert.equal(getProviderModel("zai", "proposal"), "GLM-4-FLASH",
      "allowlist match must be case-insensitive but preserve original casing");
    if (old) process.env.ZAI_PROPOSAL_MODEL = old; else delete process.env.ZAI_PROPOSAL_MODEL;
  });

  it("is NOT a Coding Plan endpoint", () => {
    assert.ok(!getProviderBaseUrl("zai")!.includes("coding"));
  });

  it("uses conservative output caps (analysis 8000 / proposal 4000 / fast 1200)", () => {
    assert.equal(getProviderOutputCap("zai", "extraction"), 8000);
    assert.equal(getProviderOutputCap("zai", "proposal"), 4000);
    assert.equal(getProviderOutputCap("zai", "fast"), 1200);
  });
});

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
    assert.equal(getProviderOutputCap("cerebras", "proposal"), 4000);
    assert.equal(getProviderOutputCap("cerebras", "fast"), 1200);
  });
});

describe("8+9. OpenRouter free-model policy", () => {
  it("rejects openrouter/auto", () => {
    const oldK = process.env.OPENROUTER_API_KEY;
    const oldM = process.env.OPENROUTER_PROPOSAL_MODEL;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_PROPOSAL_MODEL = "openrouter/auto";
    const v = openRouterModelValidity();
    assert.equal(v.valid, false);
    assert.equal(v.reason, "MODEL_UNAVAILABLE");
    assert.equal(isProviderConfigured("openrouter"), false);
    if (oldK) process.env.OPENROUTER_API_KEY = oldK; else delete process.env.OPENROUTER_API_KEY;
    if (oldM) process.env.OPENROUTER_PROPOSAL_MODEL = oldM; else delete process.env.OPENROUTER_PROPOSAL_MODEL;
  });
  it("rejects a model that does not end with :free", () => {
    const oldK = process.env.OPENROUTER_API_KEY;
    const oldM = process.env.OPENROUTER_PROPOSAL_MODEL;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_PROPOSAL_MODEL = "meta-llama/llama-3.3-70b-instruct";
    const v = openRouterModelValidity();
    assert.equal(v.valid, false);
    assert.equal(v.reason, "CONFIGURATION_INVALID");
    assert.equal(isProviderConfigured("openrouter"), false);
    if (oldK) process.env.OPENROUTER_API_KEY = oldK; else delete process.env.OPENROUTER_API_KEY;
    if (oldM) process.env.OPENROUTER_PROPOSAL_MODEL = oldM; else delete process.env.OPENROUTER_PROPOSAL_MODEL;
  });
  it("accepts an explicit :free model", () => {
    const oldK = process.env.OPENROUTER_API_KEY;
    const oldM = process.env.OPENROUTER_PROPOSAL_MODEL;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_PROPOSAL_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
    const v = openRouterModelValidity();
    assert.equal(v.valid, true);
    assert.equal(isProviderConfigured("openrouter"), true);
    if (oldK) process.env.OPENROUTER_API_KEY = oldK; else delete process.env.OPENROUTER_API_KEY;
    if (oldM) process.env.OPENROUTER_PROPOSAL_MODEL = oldM; else delete process.env.OPENROUTER_PROPOSAL_MODEL;
  });
});

describe("10. unconfigured providers are skipped", () => {
  it("isProviderConfigured is false for every provider with no key", () => {
    const snapshots: Record<string, string | undefined> = {};
    for (const k of Object.values(PROVIDER_API_KEY_ENV)) {
        snapshots[k] = process.env[k];
        delete process.env[k];
    }

    try {
        for (const p of CANONICAL_AI_PROVIDER_ORDER) {
          assert.equal(isProviderConfigured(p), false, `${p} should be unconfigured`);
        }
        assert.equal(preferredConfiguredProviderName(), null);
    } finally {
        for (const [k, v] of Object.entries(snapshots)) {
            if (v) process.env[k] = v; else delete process.env[k];
        }
    }
  });
});

describe("12. provider attempt budget", () => {
  it("caps actual outbound attempts at 3 by default", () => {
    assert.equal(MAX_PROVIDER_ATTEMPTS_PER_REQUEST, 3);
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

describe("13. ATTEMPT_BUDGET_EXHAUSTED is distinct", () => {
  it("the error kind exists and differs from ALL_PROVIDERS_EXHAUSTED", () => {
    const src = readFileSync("lib/ai.ts", "utf8");
    assert.ok(src.includes('"ATTEMPT_BUDGET_EXHAUSTED"'));
    assert.ok(src.includes('"ALL_PROVIDERS_EXHAUSTED"'));
  });
});

describe("16. inactive providers remain supported after OpenRouter", () => {
  it("gemini → openai → together → deepseek → anthropic follow OpenRouter", () => {
    const order = [...CANONICAL_AI_PROVIDER_ORDER];
    assert.deepEqual(order.slice(order.indexOf("openrouter") + 1), [
      "gemini", "openai", "together", "deepseek", "anthropic",
    ]);
  });
});

describe("17. existing Mistral/Groq/OpenRouter remain intact", () => {
  it("Mistral keeps its endpoint + models", () => {
    assert.equal(getProviderBaseUrl("mistral"), "https://api.mistral.ai/v1");
    assert.equal(getProviderModel("mistral", "proposal"), "mistral-large-latest");
    assert.equal(getProviderModel("mistral", "fast"), "ministral-8b-latest");
  });
  it("Groq keeps its endpoint + model", () => {
    assert.equal(getProviderBaseUrl("groq"), "https://api.groq.com/openai/v1");
    assert.equal(getProviderModel("groq", "proposal"), "llama-3.3-70b-versatile");
  });
  it("OpenRouter keeps fifth rank among the working providers", () => {
    assert.equal(getProviderEntry("openrouter").rank, 5);
    assert.equal(providerDisplayName("openrouter"), "OpenRouter");
  });
});

describe("emergency-only provider flag", () => {
  it("only anthropic is emergency-only", () => {
    for (const entry of getCanonicalProviderEntries()) {
      assert.equal(entry.emergencyOnly, entry.provider === "anthropic", `${entry.provider} emergencyOnly mismatch`);
    }
  });
});

describe("structured JSON support flag", () => {
  it("zai + cerebras support structured JSON; gemini + anthropic do not", () => {
    assert.equal(getProviderEntry("zai").supportsStructuredJson, true);
    assert.equal(getProviderEntry("cerebras").supportsStructuredJson, true);
    assert.equal(getProviderEntry("gemini").supportsStructuredJson, false);
    assert.equal(getProviderEntry("anthropic").supportsStructuredJson, false);
  });
});

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
