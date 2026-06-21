// AI provider health + order alignment tests.
//
// These tests prove that every operator-facing surface (runtime chain,
// /api/ai/health, dashboard provider-health panel, provider status enum,
// NoAiProviderReadyError, /api/health separation) accurately reflects the
// current canonical runtime order:
//   Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic
// followed by the deterministic draft fallback as the final non-AI fallback.
//
// The actual runtime chain is the source of truth (lib/ai.ts
// CANONICAL_PROVIDER_CHAIN). The tests pin the related artifacts to that
// chain so a future drift is caught at CI time.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyAiError,
  recordProviderFailure,
  recordProviderSuccess,
  recordProviderPingSuccess,
  isProviderCooledDown,
  resetProviderHealth,
  getProviderRuntimeSnapshot,
  deriveProviderStatus,
  type AiProviderName,
  type AiProviderStatus,
} from "../lib/ai-provider-health";

const CANONICAL_CHAIN: AiProviderName[] = [
  "zai", "cerebras", "mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic",
];
const CANONICAL_DISPLAY = "Z.ai GLM → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic / Claude";

before(() => { resetProviderHealth(); });

// ─── 1. Runtime provider order ───────────────────────────────────────────────

describe("runtime provider order — lib/ai.ts CANONICAL_PROVIDER_CHAIN", () => {
  const source = readFileSync("lib/ai.ts", "utf8");

  it("uses the canonical order: Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic", () => {
    const match = source.match(/CANONICAL_PROVIDER_CHAIN[^=]*=\s*\[([^\]]+)\]/);
    assert.ok(match, "Missing CANONICAL_PROVIDER_CHAIN");
    const chain = Array.from(match[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    assert.deepEqual(chain, CANONICAL_CHAIN);
  });

  it("uses the same canonical order for every supported use case", () => {
    for (const useCase of ["default", "extraction", "proposal", "validation", "fast", "reasoning"]) {
      // The spread form `<useCase>: [...CANONICAL_PROVIDER_CHAIN]` is the
      // preferred form. Each use case must either spread the canonical chain
      // OR list the chain explicitly as a string array literal.
      // Use a regex (with `\s*`) so aligned multi-space colons still match.
      const spread = new RegExp(`${useCase}:\\s*\\[\\.\\.\\.CANONICAL_PROVIDER_CHAIN\\]`).test(source);
      if (spread) continue;
      const direct = source.match(new RegExp(`${useCase}:\\s*\\[([^\\]]+)\\]`));
      assert.ok(direct, `Missing ${useCase} provider chain (must use either direct list or spread)`);
      const chain = Array.from(direct[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
      assert.deepEqual(chain, CANONICAL_CHAIN, `${useCase} chain must match canonical`);
    }
  });

  it("Claude / Anthropic is the last AI provider in the chain", () => {
    const match = source.match(/CANONICAL_PROVIDER_CHAIN[^=]*=\s*\[([^\]]+)\]/);
    assert.ok(match);
    const chain = Array.from(match[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    assert.equal(chain[chain.length - 1], "anthropic");
  });
});

// ─── 2. lib/ai-provider-policy.ts mirrors the runtime chain ──────────────────

describe("lib/ai-provider-policy.ts mirrors the runtime chain", () => {
  const source = readFileSync("lib/ai-provider-policy.ts", "utf8");

  it("CANONICAL_AI_PROVIDER_CHAIN matches lib/ai.ts CANONICAL_PROVIDER_CHAIN", () => {
    const match = source.match(/CANONICAL_AI_PROVIDER_CHAIN\s*=\s*\[([\s\S]*?)\]\s*as const/);
    assert.ok(match, "Missing CANONICAL_AI_PROVIDER_CHAIN");
    const chain = Array.from(match[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    assert.deepEqual(chain, CANONICAL_CHAIN);
  });

  it("CANONICAL_AI_PROVIDER_RANK assigns Z.ai=1 ... Anthropic=10", () => {
    const match = source.match(/CANONICAL_AI_PROVIDER_RANK[\s\S]*?=\s*\{([\s\S]*?)\}/);
    assert.ok(match, "Missing CANONICAL_AI_PROVIDER_RANK");
    const inner = match[1];
    for (let i = 0; i < CANONICAL_CHAIN.length; i++) {
      assert.match(inner, new RegExp(`${CANONICAL_CHAIN[i]}:\\s*${i + 1}`));
    }
  });
});

// ─── 3. /api/ai/health reports the same order ────────────────────────────────

describe("/api/ai/health reports the canonical runtime order", () => {
  const source = readFileSync("app/api/ai/health/route.ts", "utf8");

  it("fallbackChain string lists the canonical order + deterministic draft fallback", () => {
    assert.match(source, /Z\.ai GLM → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic \/ Claude → deterministic draft fallback/);
  });

  it("fallbackChainExtraction mirrors fallbackChain", () => {
    assert.match(source, /AI_FALLBACK_CHAIN_EXTRACTION\s*=\s*AI_FALLBACK_CHAIN/);
  });

  it("allProviderNames iteration order is canonical", () => {
    const match = source.match(/allProviderNames:\s*AiProviderName\[\]\s*=\s*\[([^\]]+)\]/);
    assert.ok(match, "Missing allProviderNames");
    const order = Array.from(match[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    assert.deepEqual(order, CANONICAL_CHAIN);
  });

  it("providers object lists each provider with the correct fallbackRank in canonical order", () => {
    // The providers JSON object uses `claude` as the key for the Anthropic
    // provider (matching the runtime name `anthropic` inside AiProviderName).
    // Verify each provider has its expected fallbackRank.
    const jsonKeyByCanonical: Record<string, string> = {
      zai: "zai", cerebras: "cerebras", mistral: "mistral", groq: "groq",
      openrouter: "openrouter", gemini: "gemini",
      openai: "openai", together: "together", deepseek: "deepseek", anthropic: "claude",
    };
    for (let i = 0; i < CANONICAL_CHAIN.length; i++) {
      const provider = CANONICAL_CHAIN[i];
      const expectedRank = i + 1;
      const jsonKey = jsonKeyByCanonical[provider];
      // The provider block starts with `<jsonKey>: {` and contains
      // `fallbackRank: <n>`.
      const blockRegex = new RegExp(`${jsonKey}:\\s*\\{[\\s\\S]*?fallbackRank:\\s*${expectedRank}`);
      assert.match(source, blockRegex, `${jsonKey} (canonical ${provider}) must have fallbackRank ${expectedRank}`);
    }
  });

  it("preferredProvider picks the first CONFIGURED provider in canonical order", () => {
    // Verify the ternary ladder order matches the canonical chain.
    const ternaryOrder = [
      'zaiConfigured ? "zai"',
      'cerebrasConfigured ? "cerebras"',
      'mistralConfigured ? "mistral"',
      'groqConfigured ? "groq"',
      'openRouterConfigured ? "openrouter"',
      'geminiConfigured ? "gemini"',
      'openaiConfigured ? "openai"',
      'togetherConfigured ? "together"',
      'deepSeekConfigured ? "deepseek"',
      'claudeConfigured ? "claude"',
    ];
    let lastIdx = -1;
    for (const needle of ternaryOrder) {
      const idx = source.indexOf(needle);
      assert.ok(idx > lastIdx, `${needle} must appear after the previous canonical provider in preferredProvider ladder`);
      lastIdx = idx;
    }
  });

  it("Claude is the last AI provider in the providers object (rank 10)", () => {
    // Find the position of "fallbackRank: 10" and ensure no provider after it
    // has a lower rank.
    const lastRank10 = source.lastIndexOf("fallbackRank: 10,");
    // The deterministic entry has fallbackRank: 11 — it must come AFTER claude.
    const deterministicRank = source.indexOf("fallbackRank: 11,");
    assert.ok(lastRank10 > -1, "Claude must have fallbackRank 10");
    assert.ok(deterministicRank > lastRank10, "Deterministic draft fallback (rank 11) must come after Claude (rank 10)");
  });

  it("deterministic entry is marked isAi=false and surfaces status=unknown", () => {
    assert.match(source, /deterministic:\s*\{[\s\S]*?fallbackRank:\s*11[\s\S]*?isAi:\s*false/);
    assert.match(source, /deterministic[\s\S]*?status:\s*"UNKNOWN"/);
  });

  it("surfaces a structured noAiProviderReady signal that mirrors lib/ai.ts NoAiProviderReadyError", () => {
    assert.match(source, /noAiProviderReady\b/);
    assert.match(source, /noAiProviderReadyCode:\s*noAiProviderReady\s*\?\s*"NO_AI_PROVIDER_READY"/);
  });

  it("surfaces the unified per-provider status field for every AI provider", () => {
    // The JSON `providers` object uses `claude` as the key for the anthropic
    // provider; the underlying runtime snapshot is keyed by `anthropic`.
    const jsonKeyByCanonical: Record<string, string> = {
      zai: "zai", cerebras: "cerebras", mistral: "mistral", groq: "groq",
      openrouter: "openrouter", gemini: "gemini",
      openai: "openai", together: "together", deepseek: "deepseek", anthropic: "claude",
    };
    for (const provider of CANONICAL_CHAIN) {
      const jsonKey = jsonKeyByCanonical[provider];
      assert.match(source, new RegExp(`${jsonKey}:\\s*\\{[\\s\\S]*?status:\\s*providerRuntime\\.${provider}\\.status`));
    }
  });
});

// ─── 4. Dashboard provider-health UI follows the canonical order ─────────────

describe("dashboard provider-health UI follows the canonical order", () => {
  const source = readFileSync("components/ai-health-panel.tsx", "utf8");

  it("AI_FALLBACK_CHAIN string mentions the canonical order + deterministic draft fallback", () => {
    assert.match(source, /Z\.ai GLM → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude/);
    assert.match(source, /deterministic draft fallback/);
    assert.match(source, /Claude is the last AI provider/);
    assert.match(source, /NOT an AI provider/);
  });

  it("provider cards are listed in canonical order with correct ranks (1..10)", () => {
    // The dashboard card uses `claude` as the key for the anthropic provider.
    const jsonKeyByCanonical: Record<string, string> = {
      zai: "zai", cerebras: "cerebras", mistral: "mistral", groq: "groq",
      openrouter: "openrouter", gemini: "gemini",
      openai: "openai", together: "together", deepseek: "deepseek", anthropic: "claude",
    };
    // Find each provider card definition and verify rank + ordering.
    const positions: number[] = [];
    for (let i = 0; i < CANONICAL_CHAIN.length; i++) {
      const provider = CANONICAL_CHAIN[i];
      const expectedRank = i + 1;
      const jsonKey = jsonKeyByCanonical[provider];
      const cardRegex = new RegExp(`key:\\s*"${jsonKey}"[\\s\\S]*?rank:\\s*${expectedRank}`);
      const match = source.match(cardRegex);
      assert.ok(match, `${jsonKey} (canonical ${provider}) card with rank ${expectedRank} must exist`);
      positions.push(source.indexOf(match![0]));
    }
    // Each provider card must appear after the previous one in source order.
    for (let i = 1; i < positions.length; i++) {
      assert.ok(positions[i] > positions[i - 1], `${CANONICAL_CHAIN[i]} card must appear after ${CANONICAL_CHAIN[i - 1]} card`);
    }
  });

  it("Claude card is the last AI provider (rank 10)", () => {
    const claudeCardMatch = source.match(/key:\s*"claude"[\s\S]*?rank:\s*10/);
    assert.ok(claudeCardMatch, "Claude must be rank 10 (last AI provider)");
    const claudeCardIdx = source.indexOf(claudeCardMatch![0]);
    // The deterministic card must come after claude.
    const deterministicIdx = source.indexOf('key: "deterministic"');
    assert.ok(deterministicIdx > claudeCardIdx, "Deterministic card must come after Claude card");
  });

  it("deterministic card is rendered as a non-AI final fallback (isAi=false, rank 11)", () => {
    assert.match(source, /key:\s*"deterministic"[\s\S]*?rank:\s*11[\s\S]*?isAi:\s*false/);
    // The card rendering must branch on isAi and never show green for deterministic.
    assert.match(source, /if\s*\(!p\.isAi\)/);
    assert.match(source, /Final fallback \(non-AI\)/);
  });

  it("pill colour for AI providers uses the unified status field", () => {
    // Only runtime_verified renders a green "Available" pill. The status enum
    // is the single source of truth for pill colour.
    assert.match(source, /p\.status === "GENERATION_VERIFIED"/);
    assert.match(source, /Available \(runtime verified\)/);
    // not_configured renders as Not configured (red).
    assert.match(source, /p\.status === "NOT_CONFIGURED"[\s\S]*?Not configured/);
    // configured (key only) renders as a neutral pill — NOT green.
    assert.match(source, /p\.status === "CONFIGURED"[\s\S]*?Configured — not yet tested on this instance/);
    // rate_limited / unauthorized / timeout / unavailable all render as amber/red.
    assert.match(source, /p\.status === "RATE_LIMITED"/);
    assert.match(source, /p\.status === "UNAUTHORIZED"/);
    assert.match(source, /p\.status === "TIMEOUT"/);
    assert.match(source, /p\.status === "BILLING_BLOCKED"/);
  });

  it("preferredProvider picks the first CONFIGURED AI provider in canonical order", () => {
    // The dashboard must compute preferredProvider from `aiProviders` (which
    // excludes the deterministic fallback card).
    assert.match(source, /const aiProviders = providers\.filter\(\(p\) => p\.isAi\)/);
    assert.match(source, /const preferredProvider = aiProviders\.find\(\(p\) => p\.configured\)\?\.key \?\? "none"/);
  });

  it("mentions Claude as the last AI provider in the note", () => {
    assert.match(source, /Tenth-tier \(last\) AI provider/);
  });
});

// ─── 5. Provider-health status enum + deriveProviderStatus ───────────────────

describe("AiProviderStatus enum + deriveProviderStatus()", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all AI provider env vars before each test.
    for (const key of [
      "ZAI_API_KEY", "CEREBRAS_API_KEY",
      "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "MISTRAL_API_KEY",
      "DEEPSEEK_API_KEY", "GROQ_API_KEY", "TOGETHER_API_KEY", "OPENROUTER_API_KEY",
    ]) {
      delete process.env[key];
    }
    resetProviderHealth();
  });

  afterEach(() => {
    // Restore original env.
    for (const key of Object.keys(originalEnv)) {
      process.env[key] = originalEnv[key] as string | undefined;
    }
    resetProviderHealth();
  });

  it("returns not_configured when the env var is missing", () => {
    assert.equal(deriveProviderStatus("mistral"), "NOT_CONFIGURED");
    assert.equal(deriveProviderStatus("groq"), "NOT_CONFIGURED");
    assert.equal(deriveProviderStatus("anthropic"), "NOT_CONFIGURED");
  });

  it("returns configured when the key is present but no success and no failure recorded", () => {
    process.env.MISTRAL_API_KEY = "sk-test-mistral-configured-only";
    assert.equal(deriveProviderStatus("mistral"), "CONFIGURED");
    // Snapshot must surface the same status.
    assert.equal(getProviderRuntimeSnapshot("mistral").status, "CONFIGURED");
  });

  it("returns runtime_verified after a real generation success (recordProviderSuccess), not after a ping-only success", () => {
    process.env.GROQ_API_KEY = "gsk-test-groq";
    // Ping-only success marks connectivity but not runtime verification.
    recordProviderPingSuccess("groq");
    assert.equal(deriveProviderStatus("groq"), "CONNECTIVITY_VERIFIED");
    // Real generation success DOES flip it to runtime_verified.
    recordProviderSuccess("groq");
    assert.equal(deriveProviderStatus("groq"), "GENERATION_VERIFIED");
    assert.equal(getProviderRuntimeSnapshot("groq").status, "GENERATION_VERIFIED");
    assert.equal(getProviderRuntimeSnapshot("groq").runtimeVerified, true);
  });

  it("returns rate_limited after a RATE_LIMIT failure (provider is in cooldown)", () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    recordProviderFailure("openai", new Error("HTTP 429 Too Many Requests"));
    assert.equal(deriveProviderStatus("openai"), "RATE_LIMITED");
    assert.equal(getProviderRuntimeSnapshot("openai").status, "RATE_LIMITED");
    assert.equal(getProviderRuntimeSnapshot("openai").rateLimited, true);
    assert.equal(getProviderRuntimeSnapshot("openai").coolingDown, true);
  });

  it("returns unauthorized after an AUTH failure (401/403/invalid key)", () => {
    process.env.GEMINI_API_KEY = "AIzaFakeKey1234567890123456789012345";
    recordProviderFailure("gemini", new Error("HTTP 403 Forbidden — API key invalid"));
    assert.equal(deriveProviderStatus("gemini"), "UNAUTHORIZED");
    assert.equal(getProviderRuntimeSnapshot("gemini").status, "UNAUTHORIZED");
  });

  it("returns timeout after a TIMEOUT failure", () => {
    process.env.TOGETHER_API_KEY = "together-test";
    recordProviderFailure("together", new Error("Request timed out after 30s"));
    assert.equal(deriveProviderStatus("together"), "TIMEOUT");
    assert.equal(getProviderRuntimeSnapshot("together").status, "TIMEOUT");
  });

  it("returns unavailable after MODEL_UNAVAILABLE / BILLING / NETWORK / MALFORMED_RESPONSE failures", () => {
    process.env.DEEPSEEK_API_KEY = "dsk-test";
    recordProviderFailure("deepseek", new Error("HTTP 404 model not found: deepseek-reasoner"));
    assert.equal(deriveProviderStatus("deepseek"), "BILLING_BLOCKED");

    resetProviderHealth();
    process.env.DEEPSEEK_API_KEY = "dsk-test";
    recordProviderFailure("deepseek", new Error("HTTP 402 Insufficient balance"));
    assert.equal(deriveProviderStatus("deepseek"), "BILLING_BLOCKED");

    resetProviderHealth();
    process.env.DEEPSEEK_API_KEY = "dsk-test";
    recordProviderFailure("deepseek", new Error("fetch failed: ECONNRESET"));
    assert.equal(deriveProviderStatus("deepseek"), "BILLING_BLOCKED");
  });

  it("returns unknown after an UNKNOWN-category failure", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    recordProviderFailure("anthropic", new Error("some weird failure"));
    assert.equal(deriveProviderStatus("anthropic"), "UNKNOWN");
    assert.equal(getProviderRuntimeSnapshot("anthropic").status, "UNKNOWN");
  });

  it("configured-only provider is NOT marked as available / runtime_verified / healthy", () => {
    // The dashboard bug: showing green just because a key exists. The status
    // enum + snapshot must distinguish "CONFIGURED" from "GENERATION_VERIFIED".
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const snap = getProviderRuntimeSnapshot("openrouter");
    assert.equal(snap.status, "CONFIGURED");
    assert.equal(snap.runtimeVerified, false);
    // `available` is the legacy chain-scheduler field ("configured + not cooling")
    // — it MAY be true here, but it is NOT a health statement. The UI must use
    // `status`, not `available`.
    assert.equal(snap.available, true);
    assert.notEqual(snap.status, "GENERATION_VERIFIED");
  });
});

// ─── 6. NoAiProviderReadyError — structured error contract ───────────────────

describe("NoAiProviderReadyError — structured error contract", () => {
  const source = readFileSync("lib/ai.ts", "utf8");

  it("exports a NoAiProviderReadyError class with code/ok/useCase/providerAttempts/failureDetails/errorKind/nextAction", () => {
    assert.match(source, /export class NoAiProviderReadyError extends Error/);
    assert.match(source, /readonly code = "NO_AI_PROVIDER_READY" as const/);
    assert.match(source, /readonly ok = false as const/);
    assert.match(source, /readonly useCase: AiUseCase/);
    assert.match(source, /readonly providerAttempts: AiProviderAttempt\[\]/);
    assert.match(source, /readonly failureDetails: string\[\]/);
    assert.match(source, /readonly errorKind: NoAiProviderReadyErrorKind/);
    assert.match(source, /readonly nextAction:/);
  });

  it("exports the NoAiProviderReadyErrorKind discriminator (NO_PROVIDER_CONFIGURED | ALL_PROVIDERS_COOLING | ALL_PROVIDERS_EXHAUSTED | ATTEMPT_BUDGET_EXHAUSTED)", () => {
    assert.match(source, /export type NoAiProviderReadyErrorKind\s*=/);
    assert.match(source, /"NO_PROVIDER_CONFIGURED"/);
    assert.match(source, /"ALL_PROVIDERS_COOLING"/);
    assert.match(source, /"ALL_PROVIDERS_EXHAUSTED"/);
    assert.match(source, /"ATTEMPT_BUDGET_EXHAUSTED"/);
  });

  it("generateWithFallback throws NoAiProviderReadyError instead of a bare Error when all providers fail", () => {
    // The throw site in generateWithFallback must use NoAiProviderReadyError,
    // not the legacy bare `throw new Error(...)`.
    const generateWithFallbackBlock = source.match(/export async function generateWithFallback[\s\S]*?\n\}/);
    assert.ok(generateWithFallbackBlock, "generateWithFallback function not found");
    const block = generateWithFallbackBlock![0];
    assert.match(block, /throw new NoAiProviderReadyError\(/);
    assert.doesNotMatch(block, /throw new Error\(/, "generateWithFallback must not throw a bare Error");
  });

  it("builds per-provider attempt diagnostics inside generateWithFallback", () => {
    assert.match(source, /const providerAttempts: AiProviderAttempt\[\] = \[\]/);
    assert.match(source, /providerAttempts\.push\(/);
  });

  it("builds human-readable failureDetails for PR #775/#778 diagnostics compatibility", () => {
    // PR #775/#778 added failureDetails for actionable error messages. This
    // branch preserves that intent by populating failureDetails alongside the
    // structured providerAttempts array.
    const block = source.match(/export async function generateWithFallback[\s\S]*?\n\}/)![0];
    assert.match(block, /const failureDetails: string\[\] = \[\]/);
    assert.match(block, /failureDetails\.push\(/);
  });

  it("preserves the AI_PROVIDERS_RATE_LIMITED message prefix for legacy diagnostics", () => {
    // lib/engine/analysis-fallback-diagnostics.ts (PR #775/#778) string-matches
    // on "AI_PROVIDERS_RATE_LIMITED" to classify the error. The structured
    // NoAiProviderReadyError must preserve this prefix in its message when
    // errorKind === "ALL_PROVIDERS_COOLING" so legacy diagnostics keep working.
    assert.match(source, /AI_PROVIDERS_RATE_LIMITED:/);
  });

  it("chooses errorKind=NO_PROVIDER_CONFIGURED + nextAction=CONFIGURE_AI_KEYS when no provider is configured", () => {
    const block = source.match(/export async function generateWithFallback[\s\S]*?\n\}/)![0];
    assert.match(block, /"NO_PROVIDER_CONFIGURED"/);
    assert.match(block, /configuredCount === 0\s*\?\s*"CONFIGURE_AI_KEYS"/);
  });

  it("chooses errorKind=ALL_PROVIDERS_COOLING + nextAction=ALL_PROVIDERS_COOLING when every configured provider is cooling down", () => {
    const block = source.match(/export async function generateWithFallback[\s\S]*?\n\}/)![0];
    assert.match(block, /"ALL_PROVIDERS_COOLING"/);
    assert.match(block, /allConfiguredCooling\s*\?\s*"ALL_PROVIDERS_COOLING"/);
  });

  it("chooses errorKind=ALL_PROVIDERS_EXHAUSTED + nextAction=RETRY_AFTER_PROVIDER_FIX otherwise", () => {
    const block = source.match(/export async function generateWithFallback[\s\S]*?\n\}/)![0];
    assert.match(block, /"ALL_PROVIDERS_EXHAUSTED"/);
    assert.match(block, /"RETRY_AFTER_PROVIDER_FIX"/);
  });

  it("surfaces ATTEMPT_BUDGET_EXHAUSTED when the 3-attempt budget is the limiting factor", () => {
    // The MAX_PROVIDER_ATTEMPTS import must be present, and the budget check
    // must use it.
    assert.match(source, /import \{ MAX_PROVIDER_ATTEMPTS \} from "\.\/ai-provider-policy"/);
    assert.match(source, /MAX_ATTEMPTS = MAX_PROVIDER_ATTEMPTS/);
    assert.match(source, /"ATTEMPT_BUDGET_EXHAUSTED"/);
    assert.match(source, /budgetExhausted/);
  });
});

// ─── 7. Secret redaction — no API keys leaked via /api/ai/health ──────────────

describe("secret redaction — /api/ai/health never exposes API keys", () => {
  const source = readFileSync("app/api/ai/health/route.ts", "utf8");

  it("does not return any env var value verbatim in the response body", () => {
    // The route must NOT contain patterns like `process.env.X_API_KEY` inside
    // the JSON response object literal. It may READ env vars for booleans
    // (`present(process.env.X_API_KEY)`) but must never embed the value.
    const responseBlock = source.match(/return NextResponse\.json\(\{[\s\S]*?\}\s*\)/);
    assert.ok(responseBlock, "NextResponse.json call not found");
    const block = responseBlock![0];
    // Disallow any direct interpolation of API key env vars into the JSON body.
    for (const envVar of [
      "ZAI_API_KEY", "CEREBRAS_API_KEY",
      "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "MISTRAL_API_KEY",
      "DEEPSEEK_API_KEY", "GROQ_API_KEY", "TOGETHER_API_KEY", "OPENROUTER_API_KEY",
    ]) {
      assert.doesNotMatch(block, new RegExp(`\\$\\{process\\.env\\.${envVar}\\}`), `${envVar} value must not be interpolated into the response`);
      assert.doesNotMatch(block, new RegExp(`:\\s*process\\.env\\.${envVar}\\b`), `${envVar} value must not be returned verbatim`);
    }
  });

  it("provider error messages are already redacted by recordProviderFailure before reaching the snapshot", () => {
    const health = readFileSync("lib/ai-provider-health.ts", "utf8");
    assert.match(health, /function redactMessage/);
    assert.match(health, /sk-\[A-Za-z0-9-_\]\{8,\}/);
    assert.match(health, /Bearer\s+\[REDACTED\]/);
    // The runtime snapshot reuses the already-redacted message.
    assert.match(health, /lastSafeErrorMessage: h\.lastFailureMessage/);
  });
});

// ─── 8. /api/health app/database health remains separate from AI health ──────

describe("/api/health app/database health remains separate from AI provider health", () => {
  const health = readFileSync("lib/liveness.ts", "utf8");
  const route = readFileSync("app/api/health/route.ts", "utf8");

  it("/api/health route delegates to livenessResponse() and nothing else", () => {
    assert.match(route, /import \{ livenessResponse \} from "\.\.\/\.\.\/\.\.\/lib\/liveness"/);
    assert.match(route, /return livenessResponse\(\)/);
  });

  it("livenessResponse checks only DB tables, never AI provider keys", () => {
    // Must NOT check any AI provider env vars — DB health is independent.
    for (const envVar of [
      "ZAI_API_KEY", "CEREBRAS_API_KEY",
      "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "MISTRAL_API_KEY",
      "DEEPSEEK_API_KEY", "GROQ_API_KEY", "TOGETHER_API_KEY", "OPENROUTER_API_KEY",
    ]) {
      assert.doesNotMatch(health, new RegExp(envVar), `liveness must not reference ${envVar}`);
    }
    // Must check the critical DB tables.
    assert.match(health, /RateLimitBucket/);
    assert.match(health, /PasswordResetToken/);
    assert.match(health, /SubmissionPlanState/);
    assert.match(health, /AiAnalyzeChunk/);
    assert.match(health, /AiJob/);
  });

  it("liveness response surfaces ok + status fields independent of AI health", () => {
    assert.match(health, /ok:\s*allCriticalTablesExist/);
    assert.match(health, /status:\s*allCriticalTablesExist\s*\?\s*"healthy"\s*:\s*"degraded"/);
  });
});

// ─── 9. docs/ai-provider-order.md reflects the runtime order ─────────────────

describe("docs/ai-provider-order.md reflects the runtime order", () => {
  const doc = readFileSync("docs/ai-provider-order.md", "utf8");

  it("lists Z.ai as the first runtime provider", () => {
    // First numbered list item must be Z.ai GLM.
    assert.match(doc, /^1\. Z\.ai GLM$/m);
  });

  it("lists Claude / Anthropic as the TENTH (last AI) provider", () => {
    assert.match(doc, /^10\. Claude \/ Anthropic$/m);
  });

  it("lists deterministic draft fallback as the ELEVENTH (final non-AI) step", () => {
    assert.match(doc, /^11\. Deterministic draft fallback/m);
    assert.match(doc, /NOT an AI provider/i);
  });

  it("does NOT list Gemini as #1 or OpenAI as #2 in the runtime chain numbering", () => {
    // The numbered list must NOT have Gemini at position 1 or OpenAI at 2.
    assert.doesNotMatch(doc, /^1\. Gemini$/m);
    assert.doesNotMatch(doc, /^2\. OpenAI$/m);
    // The numbered list MUST have Z.ai GLM at 1 and Claude / Anthropic at 10.
    assert.match(doc, /^1\. Z\.ai GLM$/m);
    assert.match(doc, /^10\. Claude \/ Anthropic$/m);
  });

  it("documentation note calls out the stale phrases as stale (not as truth)", () => {
    // The doc intentionally mentions "Gemini is first" / "OpenAI is second" /
    // "Claude is preferred" / "Mistral is first" as EXAMPLES of stale wording
    // to flag for readers. It must explicitly call them stale, not endorse
    // them.
    assert.match(doc, /Older README text or comments that say "Gemini is first".*are stale/s);
  });

  it("documents the configured-vs-runtime-verified-vs-cooldown-vs-deterministic distinction", () => {
    assert.match(doc, /not_configured/);
    assert.match(doc, /configured/);
    assert.match(doc, /runtime_verified/);
    assert.match(doc, /rate_limited/);
    assert.match(doc, /unauthorized/);
    assert.match(doc, /timeout/);
    assert.match(doc, /unavailable/);
    assert.match(doc, /unknown/);
  });

  it("states that Claude / Anthropic is intentionally the last AI provider", () => {
    assert.match(doc, /Claude \/ Anthropic is intentionally the last AI provider/);
  });

  it("preferred-provider examples list Z.ai FIRST in the chain (not Mistral)", () => {
    // The first example in the preferred-provider section must be ZAI_API_KEY.
    assert.match(doc, /if `ZAI_API_KEY` is configured, preferred provider is `zai`/);
    // Z.ai example must appear BEFORE Gemini example in source order —
    // i.e. Z.ai is preferred over Gemini when both are configured.
    const zaiIdx = doc.indexOf("if `ZAI_API_KEY` is configured, preferred provider is `zai`");
    const geminiIdx = doc.indexOf("if `GEMINI_API_KEY` is configured, preferred provider is `gemini`");
    assert.ok(zaiIdx > -1 && geminiIdx > -1);
    assert.ok(zaiIdx < geminiIdx, "Z.ai example must appear before Gemini example (Z.ai is preferred)");
  });
});

// ─── 10. .env.example + scripts/check-env.mjs tier labels ─────────────────────

describe(".env.example tier labels reflect the runtime order", () => {
  const env = readFileSync(".env.example", "utf8");

  it("header comment lists the canonical order (Z.ai first)", () => {
    assert.match(env, /Z\.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic/);
  });

  it("does NOT contain the stale 'Default order: OpenAI → Gemini → Mistral' wording", () => {
    assert.doesNotMatch(env, /Default order:\s*OpenAI → Gemini → Mistral/);
  });

  it("does NOT describe Gemini as the 'primary analysis/extraction provider' or 'fourth-tier provider'", () => {
    assert.doesNotMatch(env, /Gemini is the primary analysis\/extraction provider/);
    assert.doesNotMatch(env, /Gemini is the fourth-tier provider/);
    // The new description should call Gemini the sixth-tier provider.
    assert.match(env, /Gemini is the sixth-tier provider/);
  });
});

describe("scripts/check-env.mjs tier labels reflect the runtime order", () => {
  const src = readFileSync("scripts/check-env.mjs", "utf8");

  it("ZAI_API_KEY description says FIRST-tier (preferred)", () => {
    assert.match(src, /ZAI_API_KEY[\s\S]*?FIRST-tier \(preferred\) AI provider/);
  });

  it("CEREBRAS_API_KEY description says SECOND-tier", () => {
    assert.match(src, /CEREBRAS_API_KEY[\s\S]*?SECOND-tier AI provider/);
  });

  it("MISTRAL_API_KEY description says THIRD-tier", () => {
    assert.match(src, /MISTRAL_API_KEY[\s\S]*?THIRD-tier AI provider/);
  });

  it("GROQ_API_KEY description says FOURTH-tier", () => {
    assert.match(src, /GROQ_API_KEY[\s\S]*?FOURTH-tier AI provider/);
  });

  it("OPENROUTER_API_KEY description says FIFTH-tier aggregator", () => {
    assert.match(src, /OPENROUTER_API_KEY[\s\S]*?FIFTH-tier aggregator AI provider/);
  });

  it("GEMINI_API_KEY description says SIXTH-tier (not first-tier or fourth-tier)", () => {
    assert.match(src, /GEMINI_API_KEY[\s\S]*?SIXTH-tier AI provider/);
    assert.doesNotMatch(src, /GEMINI_API_KEY[\s\S]*?First-tier provider/);
    assert.doesNotMatch(src, /GEMINI_API_KEY[\s\S]*?FOURTH-tier AI provider/);
  });

  it("OPENAI_API_KEY description says SEVENTH-tier (not second-tier or fifth-tier)", () => {
    assert.match(src, /OPENAI_API_KEY[\s\S]*?SEVENTH-tier AI provider/);
    assert.doesNotMatch(src, /OPENAI_API_KEY[\s\S]*?Second-tier provider/);
    assert.doesNotMatch(src, /OPENAI_API_KEY[\s\S]*?FIFTH-tier AI provider/);
  });

  it("TOGETHER_API_KEY description says EIGHTH-tier (not fourth-tier or sixth-tier)", () => {
    assert.match(src, /TOGETHER_API_KEY[\s\S]*?EIGHTH-tier AI provider/);
    assert.doesNotMatch(src, /TOGETHER_API_KEY[\s\S]*?Fourth-tier fallback provider/);
    assert.doesNotMatch(src, /TOGETHER_API_KEY[\s\S]*?SIXTH-tier AI provider/);
  });

  it("DEEPSEEK_API_KEY description says NINTH-tier (not fifth-tier or seventh-tier)", () => {
    assert.match(src, /DEEPSEEK_API_KEY[\s\S]*?NINTH-tier fallback AI provider/);
    assert.doesNotMatch(src, /DEEPSEEK_API_KEY[\s\S]*?Fifth-tier fallback for proposal/);
    assert.doesNotMatch(src, /DEEPSEEK_API_KEY[\s\S]*?SEVENTH-tier fallback AI provider/);
  });

  it("ANTHROPIC_API_KEY description says TENTH-tier (last) and 'keep Anthropic last'", () => {
    assert.match(src, /ANTHROPIC_API_KEY[\s\S]*?TENTH-tier \(last\) AI provider/);
    assert.match(src, /Keep Anthropic last/);
  });

  it("every provider description includes the full canonical chain string", () => {
    // Each description should restate the canonical chain so operators can
    // see the full order at a glance next to each key.
    const matches = src.match(/Z\.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic/g);
    assert.ok(matches && matches.length >= 10, `Expected at least 10 mentions of the canonical chain, got ${matches?.length ?? 0}`);
  });
});

// ─── 11. lib/ai-provider-health-db.ts ALL_PROVIDERS mirrors the runtime chain ─

describe("lib/ai-provider-health-db.ts ALL_PROVIDERS mirrors the runtime chain", () => {
  const source = readFileSync("lib/ai-provider-health-db.ts", "utf8");
  const match = source.match(/ALL_PROVIDERS:\s*AiProviderName\[\]\s*=\s*\[([^\]]+)\]/);
  assert.ok(match, "ALL_PROVIDERS list must remain visible for source-level policy checks");
  const providers = Array.from(match[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
  it("uses the canonical runtime order (Z.ai first, Anthropic last)", () => {
    assert.deepEqual(providers, CANONICAL_CHAIN);
  });
});

// ─── 12. lib/security/provider-status.ts AI_PROVIDER_ORDER mirrors the chain ──

describe("lib/security/provider-status.ts AI_PROVIDER_ORDER mirrors the runtime chain", () => {
  const source = readFileSync("lib/security/provider-status.ts", "utf8");
  const match = source.match(/AI_PROVIDER_ORDER\s*=\s*\[([\s\S]*?)\]\s*as const/);
  assert.ok(match, "Missing AI_PROVIDER_ORDER");
  const providers = Array.from(match[1].matchAll(/provider:\s*"([^"]+)"/g)).map((m) => m[1]);
  it("uses the canonical runtime order", () => {
    assert.deepEqual(providers, ["Z.ai", "Cerebras", "Mistral", "Groq", "OpenRouter", "Gemini", "OpenAI", "Together", "DeepSeek", "Anthropic"]);
  });
});

// ─── 13. classifyAiError is robust (used by deriveProviderStatus) ─────────────

describe("classifyAiError — input classification that deriveProviderStatus depends on", () => {
  it("classifies 429 as RATE_LIMIT (drives rate_limited status)", () => {
    assert.equal(classifyAiError(new Error("HTTP 429 Too Many Requests")), "RATE_LIMIT");
  });
  it("classifies 401/403/invalid-key as AUTH (drives unauthorized status)", () => {
    assert.equal(classifyAiError(new Error("Invalid API key")), "AUTH");
    assert.equal(classifyAiError(new Error("HTTP 403 Forbidden")), "AUTH");
  });
  it("classifies timeouts as TIMEOUT (drives timeout status)", () => {
    assert.equal(classifyAiError(new Error("Request timed out")), "TIMEOUT");
  });
  it("classifies 404 model-not-found as MODEL_UNAVAILABLE (drives unavailable status)", () => {
    assert.equal(classifyAiError(new Error("HTTP 404 model not found")), "MODEL_UNAVAILABLE");
  });
  it("classifies network errors as NETWORK (drives unavailable status)", () => {
    assert.equal(classifyAiError(new Error("fetch failed: ECONNRESET")), "NETWORK");
  });
  it("classifies configuration-invalid / openrouter-auto as CONFIGURATION_INVALID", () => {
    assert.equal(classifyAiError(new Error("configuration invalid: openrouter/auto")), "CONFIGURATION_INVALID");
    assert.equal(classifyAiError(new Error("model not free: gpt-4o")), "CONFIGURATION_INVALID");
  });
  it("falls back to UNKNOWN (drives unknown status)", () => {
    assert.equal(classifyAiError(new Error("weird failure")), "UNKNOWN");
  });
});

// ─── 14. lib/ai-provider-health.ts status enum is exported and complete ──────

describe("AiProviderStatus enum is exported and complete", () => {
  const source = readFileSync("lib/ai-provider-health.ts", "utf8");

  it("exports the AiProviderStatus type with all 8 states", () => {
    assert.match(source, /export type AiProviderStatus\s*=/);
    for (const state of [
      "NOT_CONFIGURED", "CONFIGURED", "GENERATION_VERIFIED",
      "RATE_LIMITED", "UNAUTHORIZED", "TIMEOUT", "BILLING_BLOCKED", "UNKNOWN",
    ]) {
      assert.match(source, new RegExp(`\\| "${state}"`));
    }
  });

  it("exports deriveProviderStatus function", () => {
    assert.match(source, /export function deriveProviderStatus/);
  });

  it("ProviderRuntimeSnapshot includes a status field", () => {
    assert.match(source, /export type ProviderRuntimeSnapshot\s*=[\s\S]*?status: AiProviderStatus/);
  });

  it("getProviderRuntimeSnapshot returns the derived status", () => {
    assert.match(source, /const status = deriveProviderStatus\(provider\)/);
    assert.match(source, /status,/);
  });
});

// ─── 15. Snapshot / api/ai/health — the unified status field is the single ───
// ─────────────────────────────────────────────────────────────────────────────
// source of truth for pill colour. Configured != healthy.

describe("configured != healthy — the status enum distinguishes key-only from runtime-verified", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of [
      "ZAI_API_KEY", "CEREBRAS_API_KEY",
      "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "MISTRAL_API_KEY",
      "DEEPSEEK_API_KEY", "GROQ_API_KEY", "TOGETHER_API_KEY", "OPENROUTER_API_KEY",
    ]) {
      delete process.env[key];
    }
    resetProviderHealth();
  });

  afterEach(() => {
    for (const key of Object.keys(originalEnv)) {
      process.env[key] = originalEnv[key] as string | undefined;
    }
    resetProviderHealth();
  });

  it("a provider with only an API key is NOT runtime_verified", () => {
    process.env.MISTRAL_API_KEY = "sk-test-mistral-configured-only";
    const snap = getProviderRuntimeSnapshot("mistral");
    assert.equal(snap.status, "CONFIGURED");
    assert.equal(snap.runtimeVerified, false);
  });

  it("a provider with an API key + real success IS runtime_verified", () => {
    process.env.GROQ_API_KEY = "gsk-test-groq";
    recordProviderSuccess("groq");
    const snap = getProviderRuntimeSnapshot("groq");
    assert.equal(snap.status, "GENERATION_VERIFIED");
    assert.equal(snap.runtimeVerified, true);
  });

  it("a provider with an API key + rate-limit failure IS rate_limited (not configured, not verified)", () => {
    process.env.OPENAI_API_KEY = "sk-test-openai";
    recordProviderFailure("openai", new Error("HTTP 429"));
    const snap = getProviderRuntimeSnapshot("openai");
    assert.equal(snap.status, "RATE_LIMITED");
    assert.notEqual(snap.status, "CONFIGURED");
    assert.notEqual(snap.status, "GENERATION_VERIFIED");
  });
});
