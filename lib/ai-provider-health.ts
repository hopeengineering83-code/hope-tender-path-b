// AI Provider Health Tracker.
//
// Screenshot context: production showed "all providers exhausted, falling
// back to regex". The existing chain in lib/ai.ts already tries Anthropic
// → Gemini → OpenAI → DeepSeek in sequence, but without a way to:
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

export type AiProviderName = "anthropic" | "gemini" | "openai" | "deepseek";

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
  deepseek: "DEEPSEEK_API_KEY",
};

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
    configured: Boolean(process.env[PROVIDER_ENV_KEY[provider]]),
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
