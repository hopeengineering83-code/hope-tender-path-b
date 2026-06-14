// AI Provider Health Tracker.
//
// Screenshot context: production showed "all providers exhausted, falling
// back to regex". The existing chain in lib/ai.ts already tries Anthropic
// → Gemini → OpenAI → Mistral → Together → DeepSeek in sequence, but without a way to:
//   - know WHICH provider failed and WHEN
//   - back off briefly after a transient rate-limit (HTTP 429) so the
//     next request doesn't immediately re-hit the same throttled provider
//   - report current provider health to an admin
//
// This module is an in-memory tracker. It is intentionally stateless
// across deployments (resets on each cold start) — persisting health
// would require a Prisma model and a runtime migration which is out of
// scope for this PR. For multi-instance Vercel deployments each function
// instance has its own tracker; the data is still useful as a
// per-instance signal because cooldowns are short (default 60s) and a
// new instance learns the failure pattern within a few requests.
//
// Usage:
//   import { recordProviderFailure, isProviderCooledDown } from "./ai-provider-health";
//
//   try {
//     return await callAnthropic(...);
//   } catch (err) {
//     recordProviderFailure("anthropic", err);
//     throw err;
//   }
//
//   // In a fanout path:
//   if (isProviderCooledDown("gemini")) {
//     // skip Gemini for now — it 429'd N seconds ago
//   }

export type AiProviderName = "anthropic" | "gemini" | "openai" | "mistral" | "deepseek" | "groq" | "together" | "openrouter";

export type AiProviderFailureCategory =
  | "RATE_LIMIT"
  | "AUTH"
  | "TIMEOUT"
  | "MODEL_UNAVAILABLE"
  | "NETWORK"
  | "MALFORMED_RESPONSE"
  | "UNKNOWN";

export type AiProviderHealth = {
  provider: AiProviderName;
  configured: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureCategory: AiProviderFailureCategory | null;
  lastFailureMessage: string | null;
  consecutiveFailures: number;
  cooldownUntil: string | null;
};

type InternalState = {
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureCategory: AiProviderFailureCategory | null;
  lastFailureMessage: string | null;
  consecutiveFailures: number;
  cooldownUntil: number | null;
};

const PROVIDER_ENV_KEY: Record<AiProviderName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  groq: "GROQ_API_KEY",
  together: "TOGETHER_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

// ─── Central DeepSeek key resolution ──────────────────────────────────────
// Official variable is DEEPSEEK_API_KEY. Two common mis-spellings are also
// accepted so a mis-named Vercel env var still activates the provider, but
// UI/help text always recommends the official name. Resolved in ONE place so
// lib/ai.ts, the health route, and the health panel agree on "configured".
export const DEEPSEEK_OFFICIAL_ENV = "DEEPSEEK_API_KEY";
const DEEPSEEK_ENV_CANDIDATES = ["DEEPSEEK_API_KEY", "DEEP_SEEK_API_KEY", "DEEPSEEK_KEY"] as const;

export function getDeepSeekApiKey(): string | undefined {
  for (const name of DEEPSEEK_ENV_CANDIDATES) {
    const value = process.env[name];
    if (value && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

export function isDeepSeekConfigured(): boolean {
  return Boolean(getDeepSeekApiKey());
}

/** True only when the OFFICIAL DEEPSEEK_API_KEY is set (not an alias). Lets the
 * UI nudge operators to rename an alias to the canonical variable. */
export function deepSeekOfficialEnvPresent(): boolean {
  const value = process.env.DEEPSEEK_API_KEY;
  return Boolean(value && value.trim().length > 0);
}

export function getDeepSeekModel(): string {
  return process.env.DEEPSEEK_PROPOSAL_MODEL || "deepseek-chat";
}

// ─── Mistral (OpenAI-compatible) ──────────────────────────────────────────
// Third-tier provider in the default/proposal/validation chains. Official
// variable MISTRAL_API_KEY. Models are overridable by use-case.
export function getMistralApiKey(): string | undefined {
  const v = process.env.MISTRAL_API_KEY;
  return v && v.trim().length > 0 ? v.trim() : undefined;
}
export function isMistralConfigured(): boolean {
  return Boolean(getMistralApiKey());
}
export function getMistralProposalModel(): string {
  return process.env.MISTRAL_PROPOSAL_MODEL || "mistral-large-latest";
}
export function getMistralAnalysisModel(): string {
  return process.env.MISTRAL_ANALYSIS_MODEL || getMistralProposalModel();
}
export function getMistralFastModel(): string {
  return process.env.MISTRAL_FAST_MODEL || "ministral-8b-latest";
}
export function getMistralBaseUrl(): string {
  const v = process.env.MISTRAL_BASE_URL;
  return (v && v.trim().length > 0 ? v.trim() : "https://api.mistral.ai/v1").replace(/\/+$/, "");
}
/** Back-compat alias for the Mistral model getter. Returns MISTRAL_PROPOSAL_MODEL env if set,
 * otherwise the compact default "mistral-small-latest". Use getMistralProposalModel() for
 * the full-quality default (mistral-large-latest). */
export function getMistralModel(): string {
  return process.env.MISTRAL_PROPOSAL_MODEL || "mistral-small-latest";
}

// ─── Groq (OpenAI-compatible) ─────────────────────────────────────────────
// Fast fallback provider. Official variable GROQ_API_KEY. Model overridable via
// GROQ_PROPOSAL_MODEL (default: a current Llama 3.3 70B instruct model).
export function getGroqApiKey(): string | undefined {
  const v = process.env.GROQ_API_KEY;
  return v && v.trim().length > 0 ? v.trim() : undefined;
}
export function isGroqConfigured(): boolean {
  return Boolean(getGroqApiKey());
}
export function getGroqModel(): string {
  return process.env.GROQ_PROPOSAL_MODEL || "llama-3.3-70b-versatile";
}
export function getGroqBaseUrl(): string {
  const v = process.env.GROQ_BASE_URL;
  return (v && v.trim().length > 0 ? v.trim() : "https://api.groq.com/openai/v1").replace(/\/+$/, "");
}

// ─── Together (OpenAI-compatible) ─────────────────────────────────────────
// Fourth-tier provider in the canonical default chain.
export function getTogetherApiKey(): string | undefined {
  const v = process.env.TOGETHER_API_KEY;
  return v && v.trim().length > 0 ? v.trim() : undefined;
}
export function isTogetherConfigured(): boolean {
  return Boolean(getTogetherApiKey());
}
export function getTogetherProposalModel(): string {
  return process.env.TOGETHER_PROPOSAL_MODEL || "meta-llama/Llama-3.3-70B-Instruct-Turbo";
}
export function getTogetherAnalysisModel(): string {
  return process.env.TOGETHER_ANALYSIS_MODEL || getTogetherProposalModel();
}
export function getTogetherFastModel(): string {
  return process.env.TOGETHER_FAST_MODEL || "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo";
}
export function getTogetherBaseUrl(): string {
  const v = process.env.TOGETHER_BASE_URL;
  return (v && v.trim().length > 0 ? v.trim() : "https://api.together.xyz/v1").replace(/\/+$/, "");
}
/** Back-compat alias: returns the proposal model (was getTogetherModel in older code). */
export function getTogetherModel(): string {
  return getTogetherProposalModel();
}

// ─── OpenRouter (OpenAI-compatible aggregator) ────────────────────────────
// Aggregator fallback. Official variable OPENROUTER_API_KEY. Model overridable
// via OPENROUTER_PROPOSAL_MODEL (default: openrouter/auto picks a live model).
export function getOpenRouterApiKey(): string | undefined {
  const v = process.env.OPENROUTER_API_KEY;
  return v && v.trim().length > 0 ? v.trim() : undefined;
}
export function isOpenRouterConfigured(): boolean {
  return Boolean(getOpenRouterApiKey());
}
export function getOpenRouterModel(): string {
  return process.env.OPENROUTER_PROPOSAL_MODEL || "openrouter/auto";
}
export function getOpenRouterBaseUrl(): string {
  const v = process.env.OPENROUTER_BASE_URL;
  return (v && v.trim().length > 0 ? v.trim() : "https://openrouter.ai/api/v1").replace(/\/+$/, "");
}
export function getOpenRouterSiteUrl(): string {
  const v = process.env.OPENROUTER_SITE_URL;
  return v && v.trim().length > 0 ? v.trim() : "https://hope-tender-path-b.vercel.app";
}
/** Standard variable is OPENROUTER_APP_NAME; OPENROUTER_SITE_NAME is accepted
 * as a back-compat alias (used for the OpenRouter X-Title attribution header). */
export function getOpenRouterAppName(): string {
  const v = process.env.OPENROUTER_APP_NAME || process.env.OPENROUTER_SITE_NAME;
  return v && v.trim().length > 0 ? v.trim() : "Hope Tender Proposal Generator";
}

function isProviderConfigured(provider: AiProviderName): boolean {
  if (provider === "deepseek") return isDeepSeekConfigured();
  if (provider === "mistral") return isMistralConfigured();
  if (provider === "groq") return isGroqConfigured();
  if (provider === "together") return isTogetherConfigured();
  if (provider === "openrouter") return isOpenRouterConfigured();
  return Boolean(process.env[PROVIDER_ENV_KEY[provider]]);
}

const COOLDOWN_PER_CATEGORY_MS: Record<AiProviderFailureCategory, number> = {
  RATE_LIMIT: 60_000,        // 60s — typical for 429 from Anthropic / Gemini
  AUTH: 5 * 60_000,           // 5min — bad keys won't recover on their own
  TIMEOUT: 10_000,            // 10s — transient
  MODEL_UNAVAILABLE: 5 * 60_000, // 5min
  NETWORK: 15_000,            // 15s
  MALFORMED_RESPONSE: 5_000,  // 5s — try again quickly
  UNKNOWN: 30_000,            // 30s
};

const state = new Map<AiProviderName, InternalState>();

function ensureState(provider: AiProviderName): InternalState {
  let s = state.get(provider);
  if (!s) {
    s = {
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFailureCategory: null,
      lastFailureMessage: null,
      consecutiveFailures: 0,
      cooldownUntil: null,
    };
    state.set(provider, s);
  }
  return s;
}

function redactMessage(message: string | null | undefined): string {
  return (message ?? "")
    .replace(/sk-[A-Za-z0-9-_]{8,}/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export function classifyAiError(error: unknown): AiProviderFailureCategory {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const lower = raw.toLowerCase();
  if (/429|rate.?limit|quota|too\s+many\s+requests|resource\s+exhausted|tokens?\s+per\s+minute/.test(lower)) return "RATE_LIMIT";
  if (/401|403|invalid\s+api\s+key|unauthor|forbidden|api\s+key/.test(lower)) return "AUTH";
  if (/timed?\s*out|timeout|abort/.test(lower)) return "TIMEOUT";
  if (/404|model\s+not|not\s+found|not\s+supported|model\s+unavailable|invalid_request/.test(lower)) return "MODEL_UNAVAILABLE";
  if (/network|fetch\s+failed|econnreset|enotfound|getaddrinfo|socket\s+hang\s+up/.test(lower)) return "NETWORK";
  if (/no\s+json|malformed\s+json|invalid\s+json|json\s+parse/.test(lower)) return "MALFORMED_RESPONSE";
  return "UNKNOWN";
}

export function recordProviderSuccess(provider: AiProviderName): void {
  const s = ensureState(provider);
  s.lastSuccessAt = Date.now();
  s.consecutiveFailures = 0;
  s.cooldownUntil = null;
  s.lastFailureCategory = null;
  s.lastFailureMessage = null;
}

export function recordProviderFailure(provider: AiProviderName, error: unknown): AiProviderFailureCategory {
  const s = ensureState(provider);
  const category = classifyAiError(error);
  const now = Date.now();
  s.lastFailureAt = now;
  s.lastFailureCategory = category;
  s.lastFailureMessage = redactMessage(error instanceof Error ? error.message : String(error ?? ""));
  s.consecutiveFailures += 1;
  // Exponential backoff on consecutive failures — first failure gets the
  // base cooldown; second doubles it; third quadruples it; capped at 10min.
  const base = COOLDOWN_PER_CATEGORY_MS[category];
  const backoff = Math.min(10 * 60_000, base * Math.pow(2, Math.max(0, s.consecutiveFailures - 1)));
  s.cooldownUntil = now + backoff;
  return category;
}

/** Merges persisted DB state into the in-memory tracker on cold start.
 * Applies newer persisted timestamps and also preserves the more restrictive
 * active cooldown when another serverless instance has already observed a
 * provider failure. This keeps a local success from incorrectly masking a
 * DB-backed rate-limit window that is still active across Vercel instances. */
export function restoreProviderState(
  provider: AiProviderName,
  snapshot: {
    lastSuccessAt: number | null;
    lastFailureAt: number | null;
    lastFailureCategory: AiProviderFailureCategory | null;
    lastFailureMessage: string | null;
    consecutiveFailures: number;
    cooldownUntil: number | null;
  },
): void {
  const s = ensureState(provider);
  if (snapshot.lastSuccessAt && snapshot.lastSuccessAt > (s.lastSuccessAt ?? 0)) {
    s.lastSuccessAt = snapshot.lastSuccessAt;
  }
  const now = Date.now();
  const persistedCooldownActive = Boolean(snapshot.cooldownUntil && snapshot.cooldownUntil > now);
  const persistedFailureNewer = Boolean(snapshot.lastFailureAt && snapshot.lastFailureAt > (s.lastFailureAt ?? 0));
  const persistedCooldownMoreRestrictive = Boolean(
    persistedCooldownActive && snapshot.cooldownUntil! > (s.cooldownUntil ?? 0),
  );

  if (persistedFailureNewer || persistedCooldownMoreRestrictive) {
    s.lastFailureAt = snapshot.lastFailureAt;
    s.lastFailureCategory = snapshot.lastFailureCategory;
    s.lastFailureMessage = snapshot.lastFailureMessage;
    s.consecutiveFailures = Math.max(s.consecutiveFailures, snapshot.consecutiveFailures);
  }
  if (persistedCooldownMoreRestrictive) {
    s.cooldownUntil = snapshot.cooldownUntil;
  }
}

/** Returns a plain-object snapshot of the current in-memory state for
 * persistence. Used by lib/ai-provider-health-db.ts. */
export function getProviderStateSnapshot(provider: AiProviderName): {
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureCategory: AiProviderFailureCategory | null;
  lastFailureMessage: string | null;
  consecutiveFailures: number;
  cooldownUntil: number | null;
} {
  const s = state.get(provider) ?? {
    lastSuccessAt: null, lastFailureAt: null,
    lastFailureCategory: null, lastFailureMessage: null,
    consecutiveFailures: 0, cooldownUntil: null,
  };
  return { ...s };
}

export function isProviderCooledDown(provider: AiProviderName): boolean {
  const s = state.get(provider);
  if (!s || !s.cooldownUntil) return false;
  if (Date.now() >= s.cooldownUntil) {
    // expire the cooldown silently
    s.cooldownUntil = null;
    return false;
  }
  return true;
}

export function getProviderHealth(provider: AiProviderName): AiProviderHealth {
  const s = state.get(provider) ?? {
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureCategory: null,
    lastFailureMessage: null,
    consecutiveFailures: 0,
    cooldownUntil: null,
  };
  return {
    provider,
    configured: isProviderConfigured(provider),
    lastSuccessAt: s.lastSuccessAt ? new Date(s.lastSuccessAt).toISOString() : null,
    lastFailureAt: s.lastFailureAt ? new Date(s.lastFailureAt).toISOString() : null,
    lastFailureCategory: s.lastFailureCategory,
    lastFailureMessage: s.lastFailureMessage,
    consecutiveFailures: s.consecutiveFailures,
    cooldownUntil: s.cooldownUntil ? new Date(s.cooldownUntil).toISOString() : null,
  };
}

export function getAllProviderHealth(): AiProviderHealth[] {
  return (Object.keys(PROVIDER_ENV_KEY) as AiProviderName[]).map(getProviderHealth);
}

export type ProviderRuntimeSnapshot = {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCategory: AiProviderFailureCategory | null;
  lastSafeErrorMessage: string | null;
  lastFailureReason: string | null;
  cooldownUntil: string | null;
  consecutiveFailures: number;
  coolingDown: boolean;
  rateLimited: boolean;
  runtimeVerified: boolean;
  available: boolean;
};

/** Route/UI-friendly runtime view. Field names match the public API contract
 * (lastErrorCategory / lastSafeErrorMessage). The message is already redacted
 * by recordProviderFailure, so this never leaks keys or raw provider bodies. */
export function getProviderRuntimeSnapshot(provider: AiProviderName): ProviderRuntimeSnapshot {
  const h = getProviderHealth(provider);
  const coolingDown = isProviderCooledDown(provider);
  return {
    lastSuccessAt: h.lastSuccessAt,
    lastFailureAt: h.lastFailureAt,
    lastErrorCategory: h.lastFailureCategory,
    lastSafeErrorMessage: h.lastFailureMessage,
    lastFailureReason: h.lastFailureMessage,
    cooldownUntil: h.cooldownUntil,
    consecutiveFailures: h.consecutiveFailures,
    coolingDown,
    rateLimited: coolingDown && h.lastFailureCategory === "RATE_LIMIT",
    runtimeVerified: Boolean(h.lastSuccessAt),
    available: h.configured && !coolingDown,
  };
}

export type ProviderAttemptDiagnostic = {
  provider: AiProviderName;
  configured: boolean;
  coolingDown: boolean;
  lastErrorCategory: AiProviderFailureCategory | null;
  cooldownUntil: string | null;
};

/** Builds a safe, provider-specific snapshot for the AI Analyze diagnostics.
 * Used to turn a vague "regex fallback" paragraph into an actionable,
 * per-provider report (which providers were tried, which are cooling down,
 * and the safe failure category for each). Never includes keys/raw bodies. */
export function buildProviderDiagnosticsSnapshot(): {
  providersAttempted: AiProviderName[];
  providersCoolingDown: AiProviderName[];
  perProvider: ProviderAttemptDiagnostic[];
} {
  const providers = Object.keys(PROVIDER_ENV_KEY) as AiProviderName[];
  const perProvider: ProviderAttemptDiagnostic[] = providers.map((provider) => {
    const h = getProviderHealth(provider);
    return {
      provider,
      configured: h.configured,
      coolingDown: isProviderCooledDown(provider),
      lastErrorCategory: h.lastFailureCategory,
      cooldownUntil: h.cooldownUntil,
    };
  });
  return {
    providersAttempted: perProvider.filter((p) => p.configured).map((p) => p.provider),
    providersCoolingDown: perProvider.filter((p) => p.coolingDown).map((p) => p.provider),
    perProvider,
  };
}

/**
 * Returns milliseconds until the soonest configured provider exits cooldown,
 * or 0 if at least one configured provider is already available.
 * Returns null when no providers are configured.
 */
export function getMinCooldownExpiryMs(): number | null {
  const providers = Object.keys(PROVIDER_ENV_KEY) as AiProviderName[];
  const configured = providers.filter((p) => isProviderConfigured(p));
  if (configured.length === 0) return null;
  const now = Date.now();
  let minMs = Infinity;
  let anyAvailable = false;
  for (const provider of configured) {
    const s = state.get(provider);
    if (!s?.cooldownUntil || now >= s.cooldownUntil) {
      anyAvailable = true;
      break;
    }
    minMs = Math.min(minMs, s.cooldownUntil - now);
  }
  if (anyAvailable) return 0;
  return isFinite(minMs) ? minMs : null;
}

/** Reset state (test-only, also used by an admin endpoint when an
 *  operator wants to clear cooldowns after fixing a misconfiguration). */
export function resetProviderHealth(provider?: AiProviderName): void {
  if (provider) {
    state.delete(provider);
    return;
  }
  state.clear();
}

export const __testing__ = { COOLDOWN_PER_CATEGORY_MS, PROVIDER_ENV_KEY };
