import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CANONICAL_AI_PROVIDER_ORDER,
  getCanonicalProviderEntries,
  getProviderEntry,
} from "../lib/ai-provider-registry";
import { CANONICAL_PROVIDER_CHAIN } from "../lib/ai";
import { CANONICAL_AI_PROVIDER_CHAIN } from "../lib/ai-provider-policy";

// The required canonical automatic provider order — the single source of truth
// is lib/ai-provider-registry.ts. This array is duplicated here ONLY so the
// test fails loudly if the registry order ever changes without an explicit
// product decision.
const REQUIRED_ORDER = [
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
] as const;

const REQUIRED_DISPLAY = "Z.ai GLM → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic / Claude";

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

  it("zai is first, cerebras second, anthropic is rank 10 and the last AI provider", () => {
    assert.equal(CANONICAL_AI_PROVIDER_ORDER[0], "zai");
    assert.equal(CANONICAL_AI_PROVIDER_ORDER[1], "cerebras");
    assert.equal(CANONICAL_AI_PROVIDER_ORDER[CANONICAL_AI_PROVIDER_ORDER.length - 1], "anthropic");
    const anthropic = getProviderEntry("anthropic");
    assert.equal(anthropic.rank, 10);
    assert.equal(anthropic.emergencyOnly, true);
  });

  it("no canonical AI provider is manual-only or removed from automatic fallback", () => {
    const entries = getCanonicalProviderEntries();
    assert.equal(entries.length, 10);
    assert.deepEqual(entries.map((entry) => entry.provider), [...REQUIRED_ORDER]);
    for (const provider of ["zai", "cerebras", "mistral", "together"] as const) {
      assert.equal(getProviderEntry(provider).emergencyOnly, false, `${provider} must stay automatic, not emergency/manual-only`);
    }
  });

  it("the inactive providers remain supported after OpenRouter in the required order", () => {
    const afterOpenRouter = REQUIRED_ORDER.slice(REQUIRED_ORDER.indexOf("openrouter") + 1);
    assert.deepEqual([...afterOpenRouter], ["gemini", "openai", "together", "deepseek", "anthropic"]);
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
    assert.ok(aiSource.includes("providerToProposalSource"), "proposal source labeling must include all canonical providers");
  });

  it("does not contain the legacy 'mistral'-first literal order array", () => {
    assert.ok(
      !/\[\s*"mistral"\s*,\s*"groq"\s*,\s*"openrouter"/.test(aiSource),
      "legacy mistral→groq→openrouter literal order array must not exist in lib/ai.ts",
    );
  });

  it("proposal, refinement, and section generation all route through generateWithFallback", () => {
    for (const fnName of ["generateBenchmarkProposalWithAI", "critiqueProposalWithAI", "rewriteProposalWithCritique", "refineProposalWithAI", "generateOneSection"]) {
      const idx = aiSource.indexOf(`function ${fnName}`) >= 0 ? aiSource.indexOf(`function ${fnName}`) : aiSource.indexOf(`async function ${fnName}`) >= 0 ? aiSource.indexOf(`async function ${fnName}`) : aiSource.indexOf(`export async function ${fnName}`);
      assert.ok(idx >= 0, `${fnName} must exist`);
      const nextExport = aiSource.indexOf("export async function", idx + 1);
      const nextPrivate = aiSource.indexOf("async function", idx + 1);
      const candidates = [nextExport, nextPrivate].filter((n) => n > idx);
      const end = candidates.length > 0 ? Math.min(...candidates) : idx + 8000;
      const body = aiSource.slice(idx, end);
      assert.ok(body.includes("generateWithFallback") || body.includes("generateProposalTextViaCanonicalChain"), `${fnName} must use the canonical provider chain`);
    }
  });

  it("retired repair artifact cannot write a stale provider chain back into source", () => {
    const artifact = readFileSync("scripts/repair-ai-policy-artifact.mjs", "utf8");
    assert.ok(artifact.includes("Retired repair artifact"));
    assert.ok(artifact.includes("verification only"));
    assert.doesNotMatch(artifact, /writeFileSync|cpSync|replaceBetween/);
    assert.doesNotMatch(artifact, /Mistral — first tier|Gemini — first tier|OpenAI — second tier/);
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
    const order = ["ZAI_API_KEY", "CEREBRAS_API_KEY", "MISTRAL_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "TOGETHER_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY"];
    const positions = order.map((k) => envReadiness.indexOf(`status("${k}"`));
    for (let i = 1; i < positions.length; i++) {
      assert.ok(positions[i] > positions[i - 1], `${order[i]} must appear after ${order[i - 1]} in readiness`);
    }
  });
});
