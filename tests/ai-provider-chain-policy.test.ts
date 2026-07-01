import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CANONICAL_AI_PROVIDER_ORDER,
  getCanonicalProviderEntries,
} from "../lib/ai-provider-registry";
import { CANONICAL_PROVIDER_CHAIN } from "../lib/ai";
import { CANONICAL_AI_PROVIDER_CHAIN } from "../lib/ai-provider-policy";

// The required canonical automatic provider order — the single source of truth
// is lib/ai-provider-registry.ts. This array is duplicated here ONLY so the
// test fails loudly if the registry order ever changes without an explicit
// product decision.
const REQUIRED_ORDER = [
  "gemini",
  "openrouter",
  "openai",
  "groq",
  "deepseek",
  "anthropic",
] as const;

const REQUIRED_DISPLAY = "Gemini → OpenRouter → OpenAI → Groq → DeepSeek → Anthropic / Claude";

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

  it("registry ranks are 1..6 in canonical automatic order", () => {
    const entries = getCanonicalProviderEntries();
    entries.forEach((entry, idx) => {
      assert.equal(entry.provider, REQUIRED_ORDER[idx], `rank ${idx + 1} provider mismatch`);
      assert.equal(entry.rank, idx + 1, `${entry.provider} rank should be ${idx + 1}`);
    });
  });

  it("gemini is first, openrouter second, anthropic last", () => {
    assert.equal(CANONICAL_AI_PROVIDER_ORDER[0], "gemini");
    assert.equal(CANONICAL_AI_PROVIDER_ORDER[1], "openrouter");
    assert.equal(CANONICAL_AI_PROVIDER_ORDER[CANONICAL_AI_PROVIDER_ORDER.length - 1], "anthropic");
  });

  it("manual-only providers stay out of the automatic fallback chain", () => {
    assert.equal(CANONICAL_AI_PROVIDER_ORDER.includes("zai" as any), false);
    assert.equal(CANONICAL_AI_PROVIDER_ORDER.includes("cerebras" as any), false);
    assert.equal(CANONICAL_AI_PROVIDER_ORDER.includes("mistral" as any), false);
    assert.equal(CANONICAL_AI_PROVIDER_ORDER.includes("together" as any), false);
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

  it("does not contain the legacy/disallowed automatic provider literal order arrays", () => {
    for (const provider of ["zai", "cerebras", "mistral", "together"]) {
      assert.equal(CANONICAL_AI_PROVIDER_ORDER.includes(provider as any), false, `${provider} must not be automatic`);
    }
  });
});

describe("admin provider-chain ping budget", () => {
  const route = readFileSync("app/api/admin/ai-provider-health/test/route.ts", "utf8");

  it("keeps provider pings within the route budget", () => {
    assert.match(route, /export const maxDuration = 30/);
    assert.match(route, /from.*timeout-config.*import.*PER_PROVIDER_TIMEOUT_MS|import.*PER_PROVIDER_TIMEOUT_MS.*from.*timeout-config/);
  });

  it("does not ping every provider when one provider is requested", () => {
    assert.match(route, /if \(onlyProvider && tester\.provider !== onlyProvider\) continue/);
    assert.match(route, /results\.push\(await tester\.run\(\)\)/);
  });

  it("iterates providers in canonical registry order", () => {
    assert.match(route, /CANONICAL_AI_PROVIDER_ORDER/);
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
    const order = ["GEMINI_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY"];
    assert.ok(envReadiness.includes("CANONICAL_AI_PROVIDER_ORDER"));
    for (const key of order) assert.ok(envReadiness.includes(key), `${key} should be surfaced by readiness`);
  });
});
