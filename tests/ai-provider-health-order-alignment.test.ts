// AI provider health + order alignment tests.
//
// These tests prove that every operator-facing surface (canonical order,
// /api/ai/health, dashboard provider-health panel, provider status enum,
// NoAiProviderReadyError, /api/health separation) accurately reflects the
// current canonical runtime order, owned by lib/ai-provider-catalog.cjs
// (CANONICAL_AI_PROVIDER_ORDER) and re-exported by lib/ai-provider-registry.ts:
//   Gemini → Groq → Mistral → Z.ai GLM → Cerebras → OpenRouter → OpenAI → Together → DeepSeek → Anthropic/Claude
// followed by the deterministic draft fallback as the final non-AI fallback.
//
// The documentation assertions at the bottom of this file used to pin the docs
// to Z.ai-first and to an OpenRouter ':free' requirement. The catalog had led
// with Gemini and had no ':free' rule for some time, so docs and test agreed
// with each other and disagreed with the code they described — the test was
// holding the drift in place instead of catching it. They now derive their
// expectations from CANONICAL_CHAIN.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  classifyAiError,
  recordProviderFailure,
  recordProviderSuccess,
  recordProviderPingSuccess,
  resetProviderHealth,
  getProviderRuntimeSnapshot,
  deriveProviderStatus,
} from "../lib/ai-provider-health";
import {
  CANONICAL_AI_PROVIDER_ORDER,
  getCanonicalProviderEntries,
} from "../lib/ai-provider-registry";
import { CANONICAL_AI_PROVIDER_CHAIN, CANONICAL_AI_PROVIDER_RANK } from "../lib/ai-provider-policy";

const CANONICAL_CHAIN = [
  "gemini", "groq", "mistral", "zai", "cerebras", "openrouter", "openai", "together", "deepseek", "anthropic",
] as const;

before(() => { resetProviderHealth(); });

// ─── 1. Canonical order (registry-derived) ────────────────────────────────────

describe("runtime provider order — lib/ai.ts CANONICAL_PROVIDER_CHAIN", () => {
  it("uses the canonical registry order", () => {
    assert.deepEqual([...CANONICAL_AI_PROVIDER_ORDER], [...CANONICAL_CHAIN]);
  });

  it("lib/ai.ts derives its chain from the registry (no literal order array)", () => {
    const source = readFileSync("lib/ai.ts", "utf8");
    assert.ok(!/PROVIDER_CHAINS\s*:\s*Record/.test(source));
    assert.ok(source.includes("CANONICAL_AI_PROVIDER_ORDER"));
  });

  it("Anthropic / Claude is the last AI provider in the chain", () => {
    assert.equal(CANONICAL_AI_PROVIDER_ORDER[CANONICAL_AI_PROVIDER_ORDER.length - 1], "anthropic");
  });
});

// ─── 2. policy mirrors the registry chain ─────────────────────────────────────

describe("lib/ai-provider-policy.ts mirrors the runtime chain", () => {
  it("CANONICAL_AI_PROVIDER_CHAIN matches the registry order", () => {
    assert.deepEqual([...CANONICAL_AI_PROVIDER_CHAIN], [...CANONICAL_CHAIN]);
  });

  it("CANONICAL_AI_PROVIDER_RANK assigns gemini=1 ... anthropic=10", () => {
    CANONICAL_CHAIN.forEach((p, i) => {
      assert.equal(CANONICAL_AI_PROVIDER_RANK[p], i + 1, `${p} rank should be ${i + 1}`);
    });
  });
});

// ─── 3. /api/ai/health reports the registry-derived order ─────────────────────

describe("/api/ai/health reports the canonical runtime order", () => {
  const source = readFileSync("app/api/ai/health/route.ts", "utf8");

  it("builds provider objects + fallback order from the registry", () => {
    assert.match(source, /getCanonicalProviderEntries/);
    assert.match(source, /fallbackOrder:\s*allProviderNames/);
    assert.match(source, /fallbackRank:\s*entry\.rank/);
  });

  it("advertises the registry-generated fallback chain string", () => {
    assert.match(source, /CANONICAL_AI_FALLBACK_CHAIN_DISPLAY/);
  });

  it("surfaces a structured noAiProviderReady signal", () => {
    assert.match(source, /noAiProviderReady\b/);
    assert.match(source, /noAiProviderReadyCode:\s*noAiProviderReady\s*\?\s*"NO_AI_PROVIDER_READY"/);
  });

  it("derives the preferred provider from the registry", () => {
    assert.match(source, /preferredConfiguredProviderName/);
  });

  it("includes the deterministic non-AI fallback entry", () => {
    assert.match(source, /deterministic:\s*\{[\s\S]*?isAi:\s*false/);
  });

  it("surfaces inactive / skipped / attempted activity flags and lastProviderUsed", () => {
    assert.match(source, /inactive:/);
    assert.match(source, /skipped:/);
    assert.match(source, /attempted:/);
    assert.match(source, /lastProviderUsed/);
  });
});

// ─── 4. Dashboard provider-health UI follows the registry order ───────────────

describe("dashboard provider-health UI follows the canonical order", () => {
  const source = readFileSync("components/ai-health-panel.tsx", "utf8");

  it("AI_FALLBACK_CHAIN string describes the ACTIVE chain, generated from the registry", () => {
    assert.match(source, /automaticChainDisplay\(\)/);
    assert.doesNotMatch(source, /isZeroPaidMode\(\)/);
    assert.match(source, /deterministic draft fallback/);
    assert.match(source, /NOT an AI provider/);
  });

  it("builds the provider cards from the canonical registry entries", () => {
    assert.match(source, /getCanonicalProviderEntries/);
    assert.match(source, /label:\s*entry\.displayName/);
  });

  it("deterministic card is a non-AI final fallback", () => {
    assert.match(source, /key:\s*"deterministic"[\s\S]*?isAi:\s*false/);
    assert.match(source, /if\s*\(!p\.isAi\)/);
  });

  it("pill presentation covers EVERY status, with no fall-through", () => {
    // The ternary ladder this replaced handled six of fifteen statuses and let
    // the rest land on "Unknown — not yet verified", so a provider whose
    // ANALYSIS capability had just been proven displayed as unverified. The
    // Record<AiProviderStatus, …> typing now makes an unhandled status a
    // compile error rather than a silent wrong label.
    assert.match(source, /const STATUS_PRESENTATION: Record<AiProviderStatus, StatusPresentation>/);
    for (const state of [
      "GENERATION_VERIFIED", "ANALYSIS_VERIFIED", "CONNECTIVITY_VERIFIED",
      "RATE_LIMITED", "PROVIDER_OVERLOAD", "BILLING_BLOCKED", "AUTH_FAILED",
      "MODEL_UNAVAILABLE", "CONFIGURATION_INVALID", "NOT_CONFIGURED",
      "CONFIGURED", "TIMEOUT", "NETWORK_ERROR", "PROVIDER_ERROR",
      "MALFORMED_RESPONSE", "COOLING_DOWN", "UNKNOWN",
    ]) {
      assert.match(source, new RegExp(`\\n  ${state}: \\{`), `${state} must have its own presentation row`);
    }
  });

  it("shows BILLING_BLOCKED as its own state, not a generic 'unavailable'", () => {
    // Billing stays a distinct state on the card: collapsing it into
    // "Unavailable" hides which provider refused and why. What changed is the
    // WORDING — the label used to say "excluded from automatic use", which
    // described the withdrawn cost policy and told an operator the provider was
    // gone for good. It is now a cooldown, so the label says so.
    assert.match(source, /Billing refused — cooling down, will be retried/);
    assert.doesNotMatch(
      source,
      /excluded from automatic use/,
      "no provider is excluded; the label must not imply one is",
    );
  });

  it("does not paint CONNECTIVITY_VERIFIED as healthy", () => {
    // Reaching a provider proves the key and the route, not that it can return
    // the structured analysis the workflow depends on.
    assert.match(source, /CONNECTIVITY_VERIFIED: \{[\s\S]*?healthy: false/);
  });
});

// ─── 5. Provider-health status enum + deriveProviderStatus ───────────────────

describe("AiProviderStatus enum + deriveProviderStatus()", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const entry of getCanonicalProviderEntries()) delete process.env[entry.env.apiKey];
    delete process.env.OPENROUTER_PROPOSAL_MODEL;
    resetProviderHealth();
  });
  afterEach(() => {
    for (const key of Object.keys(originalEnv)) process.env[key] = originalEnv[key] as string | undefined;
    resetProviderHealth();
  });

  it("returns not_configured when the env var is missing", () => {
    assert.equal(deriveProviderStatus("zai"), "NOT_CONFIGURED");
    assert.equal(deriveProviderStatus("cerebras"), "NOT_CONFIGURED");
    assert.equal(deriveProviderStatus("anthropic"), "NOT_CONFIGURED");
  });

  it("returns configured when the key is present but no success and no failure recorded", () => {
    process.env.MISTRAL_API_KEY = "sk-test-mistral-configured-only";
    assert.equal(deriveProviderStatus("mistral"), "CONFIGURED");
    assert.equal(getProviderRuntimeSnapshot("mistral").status, "CONFIGURED");
  });

  it("returns connectivity vs generation verified appropriately", () => {
    process.env.GROQ_API_KEY = "gsk-test-groq";
    recordProviderPingSuccess("groq");
    assert.equal(deriveProviderStatus("groq"), "CONNECTIVITY_VERIFIED");
    recordProviderSuccess("groq");
    assert.equal(deriveProviderStatus("groq"), "GENERATION_VERIFIED");
    assert.equal(getProviderRuntimeSnapshot("groq").runtimeVerified, true);
  });

  // These use FREE providers. They previously used openai / together / deepseek,
  // which now resolve to BILLING_BLOCKED before any failure category is
  // consulted — the money gate outranks health, so the health status they were
  // written to check was no longer reachable through them.
  it("returns rate_limited after a RATE_LIMIT failure", () => {
    process.env.GROQ_API_KEY = "gsk-test-groq";
    recordProviderFailure("groq", new Error("HTTP 429 Too Many Requests"));
    assert.equal(deriveProviderStatus("groq"), "RATE_LIMITED");
    assert.equal(getProviderRuntimeSnapshot("groq").rateLimited, true);
  });

  it("returns AUTH_FAILED after an AUTH failure", () => {
    // AUTH_FAILED, not UNAUTHORIZED: "unauthorized" is also what an ownership
    // check says about a USER, and the two were being read as the same thing.
    process.env.GEMINI_API_KEY = "AIzaFakeKey1234567890123456789012345";
    recordProviderFailure("gemini", new Error("HTTP 403 Forbidden — API key not valid"));
    assert.equal(deriveProviderStatus("gemini"), "AUTH_FAILED");
  });

  it("returns timeout after a TIMEOUT failure", () => {
    process.env.MISTRAL_API_KEY = "mistral-test";
    recordProviderFailure("mistral", new Error("Request timed out after 30s"));
    assert.equal(deriveProviderStatus("mistral"), "TIMEOUT");
  });

  it("returns PROVIDER_OVERLOAD for a capacity failure, distinct from a rate limit", () => {
    // Capacity is not our usage and is not their bug. Collapsing it into
    // RATE_LIMITED told an operator to slow down when the correct action was to
    // do nothing at all — the same request works moments later.
    process.env.ZAI_API_KEY = "zai-test";
    recordProviderFailure("zai", new Error("The model is currently overloaded, please retry shortly"));
    assert.equal(deriveProviderStatus("zai"), "PROVIDER_OVERLOAD");
  });

  it("maps MODEL_UNAVAILABLE, BILLING, and NETWORK to distinct statuses", () => {
    process.env.ZAI_API_KEY = "zai-test";
    recordProviderFailure("zai", new Error("HTTP 404 model not found: glm-nonexistent"));
    assert.equal(deriveProviderStatus("zai"), "MODEL_UNAVAILABLE");

    resetProviderHealth();
    process.env.ZAI_API_KEY = "zai-test";
    recordProviderFailure("zai", new Error("HTTP 402 Insufficient balance"));
    assert.equal(deriveProviderStatus("zai"), "BILLING_BLOCKED");

    resetProviderHealth();
    process.env.ZAI_API_KEY = "zai-test";
    recordProviderFailure("zai", new Error("fetch failed: ECONNRESET"));
    assert.equal(deriveProviderStatus("zai"), "NETWORK_ERROR");
  });

  it("returns unknown after an UNKNOWN-category failure", () => {
    process.env.MISTRAL_API_KEY = "mistral-test";
    recordProviderFailure("mistral", new Error("some weird failure"));
    assert.equal(deriveProviderStatus("mistral"), "UNKNOWN");
  });

  it("OpenRouter accepts exact configured model identifiers", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.OPENROUTER_PROPOSAL_MODEL = "openai/gpt-4o-mini";
    assert.equal(deriveProviderStatus("openrouter"), "CONFIGURED");
    process.env.OPENROUTER_PROPOSAL_MODEL = "openrouter/auto";
    assert.equal(deriveProviderStatus("openrouter"), "CONFIGURED");
  });
});

// ─── 6. NoAiProviderReadyError — structured error contract ───────────────────

describe("NoAiProviderReadyError — structured error contract", () => {
  const source = readFileSync("lib/ai.ts", "utf8");

  it("exports a NoAiProviderReadyError class with the structured fields", () => {
    assert.match(source, /export class NoAiProviderReadyError extends Error/);
    assert.match(source, /readonly code = "NO_AI_PROVIDER_READY" as const/);
    assert.match(source, /readonly errorKind: NoAiProviderReadyErrorKind/);
  });

  it("includes ATTEMPT_BUDGET_EXHAUSTED as a distinct error kind", () => {
    assert.match(source, /export type NoAiProviderReadyErrorKind\s*=/);
    assert.match(source, /"NO_PROVIDER_CONFIGURED"/);
    assert.match(source, /"ALL_PROVIDERS_COOLING"/);
    assert.match(source, /"ALL_PROVIDERS_EXHAUSTED"/);
    assert.match(source, /"ATTEMPT_BUDGET_EXHAUSTED"/);
    assert.doesNotMatch(source, /ALL_CONFIGURED_PROVIDERS_EXHAUSTED/);
  });

  it("generateWithFallback throws NoAiProviderReadyError instead of a bare Error", () => {
    const block = source.match(/export async function generateWithFallback[\s\S]*?\n\}/)![0];
    assert.match(block, /throw new NoAiProviderReadyError\(/);
  });

  it("preserves the AI_PROVIDERS_RATE_LIMITED message prefix for legacy diagnostics", () => {
    assert.match(source, /AI_PROVIDERS_RATE_LIMITED:/);
  });
});

// ─── 8. /api/health app/database health remains separate from AI health ──────

describe("/api/health app/database health remains separate from AI provider health", () => {
  const health = readFileSync("lib/liveness.ts", "utf8");
  const route = readFileSync("app/api/health/route.ts", "utf8");

  it("/api/health route delegates to livenessResponse()", () => {
    assert.match(route, /livenessResponse/);
  });

  it("livenessResponse checks only DB tables, never AI provider keys", () => {
    for (const entry of getCanonicalProviderEntries()) {
      assert.doesNotMatch(health, new RegExp(entry.env.apiKey), `liveness must not reference ${entry.env.apiKey}`);
    }
    assert.match(health, /AiJob/);
  });
});

// ─── 9. docs/ai-provider-order.md reflects the runtime order ─────────────────

describe("docs/ai-provider-order.md reflects the runtime order", () => {
  const doc = readFileSync("docs/ai-provider-order.md", "utf8");

  it("lists every provider at its canonical rank", () => {
    const DISPLAY: Record<string, string> = {
      gemini: "Gemini", groq: "Groq", mistral: "Mistral", zai: "Z.ai GLM",
      cerebras: "Cerebras", openrouter: "OpenRouter", openai: "OpenAI",
      together: "Together", deepseek: "DeepSeek", anthropic: "Anthropic / Claude",
    };
    CANONICAL_CHAIN.forEach((provider, index) => {
      assert.match(
        doc,
        new RegExp(`^${index + 1}\\. ${DISPLAY[provider].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m"),
        `docs/ai-provider-order.md should list ${provider} at rank ${index + 1}`,
      );
    });
  });

  it("lists Anthropic / Claude as the tenth (last AI) provider", () => {
    assert.match(doc, /^10\. Anthropic \/ Claude/m);
  });

  it("lists deterministic draft fallback as the eleventh (final non-AI) step", () => {
    assert.match(doc, /^11\. Deterministic draft fallback/m);
    assert.match(doc, /NOT an AI provider/i);
  });

  it("documents the attempt budget and states that OpenRouter has no ':free' requirement", () => {
    assert.match(doc, /ATTEMPT_BUDGET_EXHAUSTED/);
    assert.match(doc, /no `?:free`? suffix requirement/i);
  });
});

// ─── 10. .env.example + scripts/check-env.mjs labels ──────────────────────────

describe(".env.example tier labels reflect the runtime order", () => {
  const env = readFileSync(".env.example", "utf8");

  it("header comment lists the canonical automatic order (Gemini first)", () => {
    assert.match(env, /Gemini → Groq → Mistral → Z\.ai → Cerebras → OpenRouter → OpenAI → Together → DeepSeek → Anthropic/);
  });

  it("documents that all 10 providers are automatic", () => {
    assert.match(env, /All 10 AI providers are automatic/);
  });

  it("includes ZAI and CEREBRAS env vars", () => {
    assert.match(env, /ZAI_API_KEY/);
    assert.match(env, /CEREBRAS_API_KEY/);
    assert.match(env, /max_completion_tokens/);
  });

  it("states that OpenRouter has no ':free' requirement", () => {
    assert.match(env, /does not require a ':free' suffix/);
  });
});

describe("scripts/check-env.mjs describes the ACTIVE chain, generated not restated", () => {
  const src = readFileSync("scripts/check-env.mjs", "utf8");

  it("generates rank and role instead of hardcoding them per provider", () => {
    // This used to pin ten literal "Rank N automatic provider" strings plus a
    // hardcoded chain constant — eleven places the order was written down
    // again. They went stale together, and the build log then confidently told
    // the operator that Z.ai was rank 1 in a chain that no longer existed.
    assert.match(src, /function roleOf\(envName\)/);
    assert.doesNotMatch(src, /Rank \d+ automatic provider in the canonical chain/,
      "no description may hardcode its own rank");
    const generated = src.match(/\$\{roleOf\("[A-Z_]+"\)\}/g);
    assert.ok(generated && generated.length === 10, `all 10 descriptions must generate their role, got ${generated?.length ?? 0}`);
  });

  it("derives the chain text from the catalog, not a local literal", () => {
    assert.match(src, /catalog\.automaticProviderOrder\(process\.env\)/);
    assert.doesNotMatch(src, /catalog\.isZeroPaidMode\(process\.env\)/);
    assert.doesNotMatch(src, /const CANONICAL_CHAIN = "Z\.ai/);
  });

  it("actually prints the current full automatic order", () => {
    // Runs the real script rather than reading its source: the point of
    // generating this text is that its OUTPUT is right, and only executing it
    // proves that.
    // Hermetic env: every provider key cleared, then exactly one set. Inheriting
    // process.env made the assertion depend on whatever an earlier describe in
    // this file had left behind — with OPENROUTER_API_KEY set, the script stops
    // warning about it individually and the name survives only in the aggregate
    // key list, which prints later than the description being asserted on.
    const hermeticEnv: NodeJS.ProcessEnv = { ...process.env };
    for (const entry of getCanonicalProviderEntries()) delete hermeticEnv[entry.env.apiKey];
    delete hermeticEnv.OPENROUTER_PROPOSAL_MODEL;
    hermeticEnv.GEMINI_API_KEY = "AIzaTestKeyNotUsedAtRuntime12345678901234567890";

    const result = spawnSync(process.execPath, ["scripts/check-env.mjs"], {
      encoding: "utf8",
      env: hermeticEnv,
    });
    const output = `${result.stdout}${result.stderr}`;

    assert.match(output, /Gemini → Groq → Mistral → Z\.ai GLM → Cerebras → OpenRouter → OpenAI → Together → DeepSeek → Anthropic \/ Claude → deterministic draft fallback/);
    assert.match(output, /GROQ_API_KEY[\s\S]*?Rank 2 provider/);
    assert.match(output, /CEREBRAS_API_KEY[\s\S]*?Rank 5 provider/);
    assert.match(output, /OPENROUTER_API_KEY[\s\S]*?Rank 6 provider/);
  });
});

// ─── 11. lib/ai-provider-health-db.ts ALL_PROVIDERS mirrors the runtime chain ─

describe("lib/ai-provider-health-db.ts ALL_PROVIDERS mirrors the runtime chain", () => {
  const source = readFileSync("lib/ai-provider-health-db.ts", "utf8");
  it("derives ALL_PROVIDERS from the registry order", () => {
    assert.match(source, /ALL_PROVIDERS[\s\S]*?=\s*CANONICAL_AI_PROVIDER_ORDER/);
  });
});

// ─── 12. lib/security/provider-status.ts AI_PROVIDER_ORDER mirrors the chain ──

describe("lib/security/provider-status.ts AI_PROVIDER_ORDER mirrors the runtime chain", () => {
  const source = readFileSync("lib/security/provider-status.ts", "utf8");
  it("derives AI_PROVIDER_ORDER from the registry", () => {
    assert.match(source, /getCanonicalProviderEntries/);
  });
});

// ─── 13. classifyAiError is robust (used by deriveProviderStatus) ─────────────

describe("classifyAiError — input classification that deriveProviderStatus depends on", () => {
  it("classifies 429 as RATE_LIMIT", () => {
    assert.equal(classifyAiError(new Error("HTTP 429 Too Many Requests")), "RATE_LIMIT");
  });
  it("classifies 401/403/invalid-key as AUTH", () => {
    assert.equal(classifyAiError(new Error("Invalid API key")), "AUTH");
    assert.equal(classifyAiError(new Error("HTTP 403 Forbidden")), "AUTH");
  });
  it("classifies timeouts as TIMEOUT", () => {
    assert.equal(classifyAiError(new Error("Request timed out")), "TIMEOUT");
  });
  it("classifies 404 model-not-found as MODEL_UNAVAILABLE", () => {
    assert.equal(classifyAiError(new Error("HTTP 404 model not found")), "MODEL_UNAVAILABLE");
  });
  it("classifies network errors as NETWORK", () => {
    assert.equal(classifyAiError(new Error("fetch failed: ECONNRESET")), "NETWORK");
  });
  it("falls back to UNKNOWN", () => {
    assert.equal(classifyAiError(new Error("weird failure")), "UNKNOWN");
  });
});

// ─── 14. AiProviderStatus enum is exported and complete ──────────────────────

describe("AiProviderStatus enum is exported and complete", () => {
  const source = readFileSync("lib/ai-provider-health.ts", "utf8");

  it("exports the AiProviderStatus type with all states including the new ones", () => {
    assert.match(source, /export type AiProviderStatus\s*=/);
    for (const state of [
      "NOT_CONFIGURED", "CONFIGURED", "CONNECTIVITY_VERIFIED", "ANALYSIS_VERIFIED",
      "GENERATION_VERIFIED", "RATE_LIMITED", "AUTH_FAILED", "TIMEOUT",
      "BILLING_BLOCKED", "MODEL_UNAVAILABLE", "PROVIDER_OVERLOAD", "PROVIDER_ERROR",
      "NETWORK_ERROR", "MALFORMED_RESPONSE", "CONFIGURATION_INVALID", "UNKNOWN",
    ]) {
      assert.match(source, new RegExp(`\\| "${state}"`));
    }
  });

  it("exports deriveProviderStatus + getProviderRuntimeSnapshot returns the derived status", () => {
    assert.match(source, /export function deriveProviderStatus/);
    assert.match(source, /const status = deriveProviderStatus\(provider\)/);
  });
});

// ─── 15. configured != healthy ───────────────────────────────────────────────

describe("configured != healthy — the status enum distinguishes key-only from runtime-verified", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    for (const entry of getCanonicalProviderEntries()) delete process.env[entry.env.apiKey];
    resetProviderHealth();
  });
  afterEach(() => {
    for (const key of Object.keys(originalEnv)) process.env[key] = originalEnv[key] as string | undefined;
    resetProviderHealth();
  });

  it("a provider with only an API key is NOT runtime_verified", () => {
    process.env.ZAI_API_KEY = "zai-configured-only";
    const snap = getProviderRuntimeSnapshot("zai");
    assert.equal(snap.status, "CONFIGURED");
    assert.equal(snap.runtimeVerified, false);
  });

  it("a provider with an API key + real success IS runtime_verified", () => {
    // A free provider: for a paid one the money gate answers first, and
    // BILLING_BLOCKED is the correct status however well it performed.
    process.env.GROQ_API_KEY = "gsk-test";
    recordProviderSuccess("groq");
    const snap = getProviderRuntimeSnapshot("groq");
    assert.equal(snap.status, "GENERATION_VERIFIED");
    assert.equal(snap.runtimeVerified, true);
    assert.equal(snap.analysisUsable, true);
  });

  it("connectivity alone is runtime-verified but NOT usable for AI Analyze", () => {
    process.env.MISTRAL_API_KEY = "mistral-test";
    recordProviderPingSuccess("mistral");
    const snap = getProviderRuntimeSnapshot("mistral");
    assert.equal(snap.status, "CONNECTIVITY_VERIFIED");
    assert.equal(snap.runtimeVerified, true);
    assert.equal(snap.analysisUsable, false, "a ping does not prove structured-output capability");
  });
});
