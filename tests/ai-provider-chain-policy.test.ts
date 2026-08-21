import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CANONICAL_AI_PROVIDER_ORDER,
  getCanonicalProviderEntries,
} from "../lib/ai-provider-registry";
import { CANONICAL_PROVIDER_CHAIN } from "../lib/ai";
import {
  CANONICAL_AI_PROVIDER_CHAIN,
  CANONICAL_AI_PROVIDER_ENV_LIST,
  CANONICAL_AI_PROVIDER_ENV_NAMES,
} from "../lib/ai-provider-policy";
import {
  CANONICAL_AI_PROVIDER_ENV_LIST as ENV_LIST_FROM_ENV_MODULE,
  CANONICAL_AI_PROVIDER_ENV_NAMES as ENV_NAMES_FROM_ENV_MODULE,
} from "../lib/ai-provider-env";

// The required canonical automatic provider order — the single source of truth
// is lib/ai-provider-registry.ts. This array is duplicated here ONLY so the
// test fails loudly if the registry order ever changes without an explicit
// product decision.
const REQUIRED_ORDER = [
  "gemini",
  "groq",
  "mistral",
  "zai",
  "cerebras",
  "openrouter",
  "openai",
  "together",
  "deepseek",
  "anthropic",
] as const;

const REQUIRED_DISPLAY = "Gemini → Groq → Mistral → Z.ai GLM → Cerebras → OpenRouter → OpenAI → Together → DeepSeek → Anthropic / Claude";

describe("AI provider chain policy — canonical order", () => {
  it("registry CANONICAL_AI_PROVIDER_ORDER is exactly the required order", () => {
    assert.deepEqual([...CANONICAL_AI_PROVIDER_ORDER], [...REQUIRED_ORDER]);
  });

  it("lib/ai.ts CANONICAL_PROVIDER_CHAIN derives from the registry order", () => {
    assert.deepEqual([...CANONICAL_PROVIDER_CHAIN], [...REQUIRED_ORDER]);
  });

  it("lib/ai-provider-policy.ts mirrors the registry order", () => {
    assert.deepEqual([...CANONICAL_AI_PROVIDER_CHAIN], [...REQUIRED_ORDER]);
  });

  it("registry ranks are 1..10 in canonical order", () => {
    const entries = getCanonicalProviderEntries();
    entries.forEach((entry, idx) => {
      assert.equal(entry.provider, REQUIRED_ORDER[idx], `rank ${idx + 1} provider mismatch`);
      assert.equal(entry.rank, idx + 1, `${entry.provider} rank should be ${idx + 1}`);
    });
  });

  it("gemini is first, anthropic is last", () => {
    assert.equal(CANONICAL_AI_PROVIDER_ORDER[0], "gemini");
    assert.equal(CANONICAL_AI_PROVIDER_ORDER[1], "groq");
    assert.equal(CANONICAL_AI_PROVIDER_ORDER[CANONICAL_AI_PROVIDER_ORDER.length - 1], "anthropic");
  });

  it("the inactive providers remain supported after OpenRouter in the required order", () => {
    assert.deepEqual([...CANONICAL_AI_PROVIDER_ORDER], [...REQUIRED_ORDER]);
  });

  it("display-name chain matches the required display order", () => {
    const display = getCanonicalProviderEntries().map((e) => e.displayName).join(" → ");
    assert.equal(display, REQUIRED_DISPLAY);
  });
});

describe("no other automatic provider order exists in the repository", () => {
  // Source-level guard: lib/ai.ts must NOT contain a second hardcoded provider
  // order array. Every use case derives its sequence from the registry order.
  const aiSource = readFileSync("lib/ai.ts", "utf8");

  it("lib/ai.ts does not declare a literal provider-order array", () => {
    assert.ok(!/PROVIDER_CHAINS\s*:\s*Record/.test(aiSource), "PROVIDER_CHAINS literal map must not exist");
    assert.ok(aiSource.includes("CANONICAL_AI_PROVIDER_ORDER"), "lib/ai.ts must derive order from the registry");
    assert.ok(aiSource.includes("providerChainForUseCase"), "lib/ai.ts must use providerChainForUseCase()");
  });

  it("does not contain the legacy 'mistral'-first literal order array", () => {
    assert.ok(
      !/\[\s*"mistral"\s*,\s*"groq"\s*,\s*"openrouter"/.test(aiSource),
      "legacy mistral→groq→openrouter literal order array must not exist in lib/ai.ts",
    );
  });
});

describe("admin provider-chain ping budget", () => {
  const route = readFileSync("app/api/admin/ai-provider-health/test/route.ts", "utf8");

  it("keeps provider tests within the route budget", () => {
    assert.match(route, /export const maxDuration = 60/);
  });

  it("tests only the requested provider when one is named", () => {
    assert.match(route, /testProviderCapabilities\(provider, \{ capabilities: \[capability\] \}\)/);
  });

  it("tests the ACTIVE chain when none is named — not every provider that has a key", () => {
    // Iterating the full canonical order here would contact paid providers.
    assert.match(route, /testAutomaticChainCapabilities\(/);
  });

  it("carries no second copy of the provider wire calls", () => {
    // This route used to build its own fetch per provider, with its own model
    // defaults — two of which contradicted the registry. Everything now
    // delegates to the capability tester, which drives the runtime adapter.
    assert.doesNotMatch(route, /api\.anthropic\.com|chat\/completions|GoogleGenerativeAI/);
  });
});

describe("AI provider status surfaces stay aligned with canonical chain", () => {
  const healthRoute = readFileSync("app/api/ai/health/route.ts", "utf8");
  const envReadiness = readFileSync("lib/ai-environment-readiness.ts", "utf8");

  it("health route + readiness derive the fallback order from the registry", () => {
    assert.ok(healthRoute.includes("getCanonicalProviderEntries"), "health route must build from the registry");
    assert.ok(healthRoute.includes("CANONICAL_AI_FALLBACK_CHAIN_DISPLAY"), "health route must use the registry-generated chain string");
    assert.ok(envReadiness.includes("CANONICAL_AI_PROVIDER_ORDER"), "readiness must iterate the registry order");
  });

  it("keeps configured-provider checks in the required canonical relative order", () => {
    const order = ["GEMINI_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "ZAI_API_KEY", "CEREBRAS_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "TOGETHER_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY"];
    const positions = order.map((k) => envReadiness.indexOf(`status("${k}"`));
    for (let i = 1; i < positions.length; i++) {
      assert.ok(positions[i] > positions[i - 1], `${order[i]} must appear after ${order[i - 1]} in readiness`);
    }
  });
});

describe("browser-safe provider env-name list", () => {
  // The browser-safe env-name list is derived from the single literal provider
  // order in lib/ai-provider-catalog.cjs. It must never re-declare the order
  // and must never read process.env at import time (so it can be bundled into
  // client code). These tests pin both guarantees.

  const REQUIRED_ENV_NAMES = [
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
    "MISTRAL_API_KEY",
    "ZAI_API_KEY",
    "CEREBRAS_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "TOGETHER_API_KEY",
    "DEEPSEEK_API_KEY",
    "ANTHROPIC_API_KEY",
  ] as const;

  it("CANONICAL_AI_PROVIDER_ENV_NAMES is exactly the required env-name order (Z.ai first, Anthropic last)", () => {
    assert.deepEqual([...CANONICAL_AI_PROVIDER_ENV_NAMES], [...REQUIRED_ENV_NAMES]);
  });

  it("CANONICAL_AI_PROVIDER_ENV_LIST is the comma-joined display form of the env-name list", () => {
    assert.equal(CANONICAL_AI_PROVIDER_ENV_LIST, REQUIRED_ENV_NAMES.join(", "));
  });

  it("re-export from ai-provider-policy matches the direct export from ai-provider-env", () => {
    // The re-export path (ai-provider-policy) and the direct path
    // (ai-provider-env) must reference the same values — no drift.
    assert.deepEqual([...CANONICAL_AI_PROVIDER_ENV_NAMES], [...ENV_NAMES_FROM_ENV_MODULE]);
    assert.equal(CANONICAL_AI_PROVIDER_ENV_LIST, ENV_LIST_FROM_ENV_MODULE);
  });

  it("lib/ai-provider-env.ts does not read process.env at module top level (browser-safe)", () => {
    const src = readFileSync("lib/ai-provider-env.ts", "utf8");
    assert.ok(
      !/^\s*process\.env/m.test(src),
      "lib/ai-provider-env.ts must not read process.env at module top level — it must remain browser-safe",
    );
    assert.ok(
      src.includes("AI_PROVIDER_API_KEY_ENVS"),
      "lib/ai-provider-env.ts must derive the list from ai-provider-catalog.cjs, not re-declare the order",
    );
  });
});
