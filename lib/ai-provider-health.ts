// AI Provider Health Tracker.
//
// Make provider truth accurate, secure, and based on real capability.
//
// The provider identity, canonical order, env var names, and configured checks
// all derive from the authoritative registry (lib/ai-provider-registry.ts).
// This module owns only the RUNTIME health state machine (success/failure,
// cooldown, derived status).

import {
  CANONICAL_AI_PROVIDER_ORDER,
  readProviderKey,
  isProviderConfigured as registryIsProviderConfigured,
  getProviderBaseUrl,
  getProviderModel,
  openRouterModelValidity,
  type AiProviderName,
} from "./ai-provider-registry";

export type { AiProviderName } from "./ai-provider-registry";

export type AiProviderFailureCategory =
  | "RATE_LIMIT"
  | "AUTH"
  | "BILLING"
  | "TIMEOUT"
  | "MODEL_UNAVAILABLE"
  | "NETWORK"
  | "MALFORMED_RESPONSE"
  | "CONFIGURATION_INVALID"
  // The provider accepted the request and then failed on its own side (5xx).
  // Distinct from NETWORK (never reached them) and from UNKNOWN (we cannot
  // tell), because a provider outage is retryable and is not our misconfiguration.
  | "PROVIDER_ERROR"
  | "UNKNOWN";

export type AiProviderStatus =
  | "NOT_CONFIGURED"
  | "CONFIGURED"
  | "CONNECTIVITY_VERIFIED"
  | "ANALYSIS_VERIFIED"
  | "GENERATION_VERIFIED"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "BILLING_BLOCKED"
  | "MODEL_UNAVAILABLE"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "MALFORMED_RESPONSE"
  | "COOLING_DOWN"
  | "CONFIGURATION_INVALID"
  | "UNKNOWN";

// Canonical provider list, derived from the registry. The ONLY ordering source.
const ALL_PROVIDER_NAMES: readonly AiProviderName[] = CANONICAL_AI_PROVIDER_ORDER;

export type AiProviderHealth = {
  provider: AiProviderName;
  configured: boolean;
  lastSuccessAt: string | null;
  lastPingSucceededAt: string | null;
  lastGenerationSucceededAt: string | null;
  lastAnalysisSucceededAt: string | null;
  lastFailureAt: string | null;
  lastFailureCategory: AiProviderFailureCategory | null;
  lastFailureMessage: string | null;
  consecutiveFailures: number;
  cooldownUntil: string | null;
};

export type InternalState = {
  lastSuccessAt: number | null;
  lastPingSucceededAt: number | null;
  lastGenerationSucceededAt: number | null;
  lastAnalysisSucceededAt: number | null;
  lastFailureAt: number | null;
  lastFailureCategory: AiProviderFailureCategory | null;
  lastFailureMessage: string | null;
  consecutiveFailures: number;
  cooldownUntil: number | null;
};

const state = new Map<AiProviderName, InternalState>();

// ─── Dynamic Key Reads (all delegate to the registry's request-time helper) ───
// Every key/config read flows through readProviderKey/getProviderModel/
// getProviderBaseUrl in the registry, so the configured-state and the
// invocation-state can never disagree (no stale module-level key caches).

export function getZaiApiKey(): string | undefined { return readProviderKey("zai"); }
export function isZaiConfigured(): boolean { return registryIsProviderConfigured("zai"); }
export function getZaiBaseUrl(): string { return getProviderBaseUrl("zai") ?? "https://api.z.ai/api/paas/v4"; }
export function getZaiProposalModel(): string { return getProviderModel("zai", "proposal"); }
export function getZaiAnalysisModel(): string { return getProviderModel("zai", "extraction"); }
export function getZaiFastModel(): string { return getProviderModel("zai", "fast"); }

export function getCerebrasApiKey(): string | undefined { return readProviderKey("cerebras"); }
export function isCerebrasConfigured(): boolean { return registryIsProviderConfigured("cerebras"); }
export function getCerebrasBaseUrl(): string { return getProviderBaseUrl("cerebras") ?? "https://api.cerebras.ai/v1"; }
export function getCerebrasProposalModel(): string { return getProviderModel("cerebras", "proposal"); }
export function getCerebrasAnalysisModel(): string { return getProviderModel("cerebras", "extraction"); }
export function getCerebrasFastModel(): string { return getProviderModel("cerebras", "fast"); }

export function getAnthropicApiKey(): string | undefined { return readProviderKey("anthropic"); }
export function isAnthropicConfigured(): boolean { return registryIsProviderConfigured("anthropic"); }

export function getGeminiApiKey(): string | undefined { return readProviderKey("gemini"); }
export function isGeminiConfigured(): boolean { return registryIsProviderConfigured("gemini"); }

export function getOpenAIApiKey(): string | undefined { return readProviderKey("openai"); }
export function isOpenAIConfigured(): boolean { return registryIsProviderConfigured("openai"); }

export const DEEPSEEK_OFFICIAL_ENV = "DEEPSEEK_API_KEY";
export function getDeepSeekApiKey(): string | undefined { return readProviderKey("deepseek"); }
export function isDeepSeekConfigured(): boolean { return registryIsProviderConfigured("deepseek"); }
export function deepSeekOfficialEnvPresent(): boolean {
  const value = process.env.DEEPSEEK_API_KEY;
  return Boolean(value && value.trim().length > 0);
}
export function getDeepSeekModel(): string { return getProviderModel("deepseek", "proposal"); }

export function getMistralApiKey(): string | undefined { return readProviderKey("mistral"); }
export function isMistralConfigured(): boolean { return registryIsProviderConfigured("mistral"); }
export function getMistralProposalModel(): string { return getProviderModel("mistral", "proposal"); }
export function getMistralAnalysisModel(): string { return getProviderModel("mistral", "extraction"); }
export function getMistralFastModel(): string { return getProviderModel("mistral", "fast"); }
export function getMistralBaseUrl(): string { return getProviderBaseUrl("mistral") ?? "https://api.mistral.ai/v1"; }

export function getGroqApiKey(): string | undefined { return readProviderKey("groq"); }
export function isGroqConfigured(): boolean { return registryIsProviderConfigured("groq"); }
export function getGroqModel(): string { return getProviderModel("groq", "proposal"); }
export function getGroqBaseUrl(): string { return getProviderBaseUrl("groq") ?? "https://api.groq.com/openai/v1"; }

export function getTogetherApiKey(): string | undefined { return readProviderKey("together"); }
export function isTogetherConfigured(): boolean { return registryIsProviderConfigured("together"); }
export function getTogetherProposalModel(): string { return getProviderModel("together", "proposal"); }
export function getTogetherAnalysisModel(): string { return getProviderModel("together", "extraction"); }
export function getTogetherFastModel(): string { return getProviderModel("together", "fast"); }
export function getTogetherBaseUrl(): string { return getProviderBaseUrl("together") ?? "https://api.together.xyz/v1"; }

export function getOpenRouterApiKey(): string | undefined { return readProviderKey("openrouter"); }
export function isOpenRouterConfigured(): boolean { return registryIsProviderConfigured("openrouter"); }
/**
 * Returns the configured OpenRouter model ONLY when it is a valid explicit
 * `:free` model. Returns null when invalid (openrouter/auto or non-free), so
 * callers never send a request that could create paid usage.
 */
export function getOpenRouterModel(): string | null {
  const validity = openRouterModelValidity();
  return validity.valid ? validity.model : null;
}
export function getOpenRouterBaseUrl(): string { return getProviderBaseUrl("openrouter") ?? "https://openrouter.ai/api/v1"; }
export function getOpenRouterSiteUrl(): string {
  const v = process.env.OPENROUTER_SITE_URL;
  return v && v.trim().length > 0 ? v.trim() : "https://hope-tender-path-b.vercel.app";
}
export function getOpenRouterAppName(): string {
  const v = process.env.OPENROUTER_APP_NAME || process.env.OPENROUTER_SITE_NAME;
  return v && v.trim().length > 0 ? v.trim() : "Hope Tender Proposal Generator";
}

export function isProviderConfigured(provider: AiProviderName): boolean {
  return registryIsProviderConfigured(provider);
}

export const COOLDOWN_PER_CATEGORY_MS: Record<AiProviderFailureCategory, number> = {
  RATE_LIMIT: 60_000,
  AUTH: 5 * 60_000,
  BILLING: 10 * 60_000,
  TIMEOUT: 30_000,
  MODEL_UNAVAILABLE: 2 * 60_000,
  NETWORK: 30_000,
  MALFORMED_RESPONSE: 60_000,
  CONFIGURATION_INVALID: 10 * 60_000,
  // A provider-side outage usually clears on its own, so back off like a
  // timeout rather than quarantining for minutes as a config fault would.
  PROVIDER_ERROR: 30_000,
  UNKNOWN: 60_000,
};

function ensureState(provider: AiProviderName): InternalState {
  let s = state.get(provider);
  if (!s) {
    s = {
      lastSuccessAt: null,
      lastPingSucceededAt: null,
      lastGenerationSucceededAt: null,
      lastAnalysisSucceededAt: null,
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
    .replace(/sk-ant-[A-Za-z0-9-_=]{8,}/g, "[REDACTED]")
    .replace(/sk-or-[A-Za-z0-9-_=]{8,}/g, "[REDACTED]")
    .replace(/sk-[A-Za-z0-9-_]{8,}/g, "[REDACTED]")
    .replace(/gsk_[A-Za-z0-9-_]{8,}/g, "[REDACTED]")
    .replace(/dsk[-_][A-Za-z0-9-_]{8,}/g, "[REDACTED]")
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, "[REDACTED]")
    .replace(/\bAQ[A-Za-z0-9_-]{30,}\b/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/authorization:\s*[A-Za-z0-9._\-+/=]+/gi, "authorization: [REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export function classifyAiError(error: unknown): AiProviderFailureCategory {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const lower = raw.toLowerCase();
  if (/429|rate.?limit|quota|too\s+many\s+requests|resource\s+exhausted|tokens?\s+per\s+minute/.test(lower)) return "RATE_LIMIT";
  if (/401|403|invalid\s+api\s+key|unauthor|forbidden|api\s+key/.test(lower)) return "AUTH";
  if (/402|insufficient.?balance|payment\s+required|billing|account\s+balance/.test(lower)) return "BILLING";
  if (/timed?\s*out|timeout|abort/.test(lower)) return "TIMEOUT";
  if (/404|model\s+not|not\s+found|not\s+supported|model\s+unavailable|invalid_request|unknown\s+model|please\s+check\s+the\s+model|model\s+code/.test(lower)) return "MODEL_UNAVAILABLE";
  if (/network|fetch\s+failed|econnreset|enotfound|getaddrinfo|socket\s+hang\s+up/.test(lower)) return "NETWORK";
  if (/no\s+json|malformed\s+json|invalid\s+json|json\s+parse/.test(lower)) return "MALFORMED_RESPONSE";
  // Checked after the specific cases above so a 503 that also says "rate limit"
  // is still RATE_LIMIT. Bare 5xx means the provider broke, not us.
  if (/\b5\d{2}\b|internal\s+server\s+error|bad\s+gateway|service\s+unavailable|gateway\s+timeout/.test(lower)) return "PROVIDER_ERROR";
  return "UNKNOWN";
}

export function recordProviderAnalysisSuccess(provider: AiProviderName): void {
  const s = ensureState(provider);
  const now = Date.now();
  s.lastSuccessAt = now;
  s.lastAnalysisSucceededAt = now;
  s.consecutiveFailures = 0;
  s.cooldownUntil = null;
  s.lastFailureCategory = null;
  s.lastFailureMessage = null;
}

export function recordProviderSuccess(provider: AiProviderName): void {
  const s = ensureState(provider);
  const now = Date.now();
  s.lastSuccessAt = now;
  s.lastGenerationSucceededAt = now;
  s.consecutiveFailures = 0;
  s.cooldownUntil = null;
  s.lastFailureCategory = null;
  s.lastFailureMessage = null;
}

export function recordProviderPingSuccess(provider: AiProviderName): void {
  const s = ensureState(provider);
  s.lastPingSucceededAt = Date.now();
  s.consecutiveFailures = 0;
  s.cooldownUntil = null;
  s.lastFailureCategory = null;
  s.lastFailureMessage = null;
}

export function recordProviderFailure(provider: AiProviderName, error: unknown): AiProviderFailureCategory {
  const s = ensureState(provider);
  const category = classifyAiError(error);
  const message = redactMessage(error instanceof Error ? error.message : String(error));
  const now = Date.now();

  s.lastFailureAt = now;
  s.lastFailureCategory = category;
  s.lastFailureMessage = message;
  s.consecutiveFailures++;

  const baseCooldown = COOLDOWN_PER_CATEGORY_MS[category];
  const backoffFactor = Math.min(Math.pow(2, s.consecutiveFailures - 1), 16);
  s.cooldownUntil = now + baseCooldown * backoffFactor;

  return category;
}

export function getProviderStateSnapshot(provider: AiProviderName): InternalState | null {
  const s = state.get(provider);
  return s ? { ...s } : null;
}

export function restoreProviderState(provider: AiProviderName, snap: InternalState): void {
  state.set(provider, { ...snap });
}

export async function restoreProviderHealthBeforeResponse(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { restoreHealthFromDb } = await import("./ai-provider-health-db");
    const result = await restoreHealthFromDb();
    return { ok: true, error: result.warning || undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function isProviderCooledDown(provider: AiProviderName): boolean {
  const s = state.get(provider);
  if (!s || !s.cooldownUntil) return false;
  if (Date.now() >= s.cooldownUntil) {
    s.cooldownUntil = null;
    return false;
  }
  return true;
}

export function getProviderHealth(provider: AiProviderName): AiProviderHealth {
  const s = ensureState(provider);
  return {
    provider,
    configured: isProviderConfigured(provider),
    lastSuccessAt: s.lastSuccessAt ? new Date(s.lastSuccessAt).toISOString() : null,
    lastPingSucceededAt: s.lastPingSucceededAt ? new Date(s.lastPingSucceededAt).toISOString() : null,
    lastGenerationSucceededAt: s.lastGenerationSucceededAt ? new Date(s.lastGenerationSucceededAt).toISOString() : null,
    lastAnalysisSucceededAt: s.lastAnalysisSucceededAt ? new Date(s.lastAnalysisSucceededAt).toISOString() : null,
    lastFailureAt: s.lastFailureAt ? new Date(s.lastFailureAt).toISOString() : null,
    lastFailureCategory: s.lastFailureCategory,
    lastFailureMessage: s.lastFailureMessage,
    consecutiveFailures: s.consecutiveFailures,
    cooldownUntil: s.cooldownUntil ? new Date(s.cooldownUntil).toISOString() : null,
  };
}

export function getAllProviderHealth(): AiProviderHealth[] {
  return ALL_PROVIDER_NAMES.map(getProviderHealth);
}

export function deriveProviderStatus(provider: AiProviderName): AiProviderStatus {
  const h = getProviderHealth(provider);

  // No key at all → NOT_CONFIGURED. (OpenRouter with a key but an invalid model
  // is reported as CONFIGURATION_INVALID below, not NOT_CONFIGURED.)
  if (!readProviderKey(provider)) return "NOT_CONFIGURED";

  const cooling = isProviderCooledDown(provider);
  if (cooling) {
    const category = h.lastFailureCategory;
    switch (category) {
      case "RATE_LIMIT": return "RATE_LIMITED";
      case "AUTH": return "UNAUTHORIZED";
      case "BILLING": return "BILLING_BLOCKED";
      case "MODEL_UNAVAILABLE": return "MODEL_UNAVAILABLE";
      case "TIMEOUT": return "TIMEOUT";
      case "NETWORK": return "NETWORK_ERROR";
      case "MALFORMED_RESPONSE": return "MALFORMED_RESPONSE";
      case "CONFIGURATION_INVALID": return "CONFIGURATION_INVALID";
      case "UNKNOWN": return "UNKNOWN";
      default: return "COOLING_DOWN";
    }
  }

  // A genuine runtime success outranks a configuration warning.
  if (h.lastGenerationSucceededAt) return "GENERATION_VERIFIED";
  if (h.lastAnalysisSucceededAt) return "ANALYSIS_VERIFIED";
  if (h.lastPingSucceededAt) return "CONNECTIVITY_VERIFIED";

  // OpenRouter with a key but a missing/invalid (non-:free) model is a
  // configuration problem, surfaced distinctly so operators fix the model
  // rather than see a misleading NOT_CONFIGURED. It never consumes an attempt.
  if (provider === "openrouter") {
    const validity = openRouterModelValidity();
    if (!validity.valid) {
      return validity.reason === "MODEL_UNAVAILABLE" ? "MODEL_UNAVAILABLE" : "CONFIGURATION_INVALID";
    }
  }

  if (!h.configured) return "NOT_CONFIGURED";
  return "CONFIGURED";
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
  status: AiProviderStatus;
};

export function getProviderRuntimeSnapshot(provider: AiProviderName): ProviderRuntimeSnapshot {
  const h = getProviderHealth(provider);
  const coolingDown = isProviderCooledDown(provider);
  const status = deriveProviderStatus(provider);
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
    runtimeVerified: status === "GENERATION_VERIFIED" || status === "ANALYSIS_VERIFIED",
    available: h.configured && !coolingDown,
    status,
  };
}

export type ProviderAttemptDiagnostic = {
  provider: AiProviderName;
  configured: boolean;
  coolingDown: boolean;
  lastErrorCategory: AiProviderFailureCategory | null;
  cooldownUntil: string | null;
};

export function buildProviderDiagnosticsSnapshot(): {
  providersAttempted: AiProviderName[];
  providersCoolingDown: AiProviderName[];
  perProvider: ProviderAttemptDiagnostic[];
} {
  const providers: readonly AiProviderName[] = ALL_PROVIDER_NAMES;
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

export function getMinCooldownExpiryMs(): number | null {
  const configured = ALL_PROVIDER_NAMES.filter((p) => isProviderConfigured(p));
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

export function resetProviderHealth(provider?: AiProviderName): void {
  if (provider) {
    state.delete(provider);
    return;
  }
  state.clear();
}

/** Back-compat alias for the Mistral model getter. */
export function getMistralModel(): string {
  return process.env.MISTRAL_PROPOSAL_MODEL || "mistral-small-latest";
}

/** Back-compat alias: returns the proposal model. */
export function getTogetherModel(): string {
  return getTogetherProposalModel();
}

export function resetHealthLoadedFlag() {
  // dummy for store tests
}

export const __testing__ = { COOLDOWN_PER_CATEGORY_MS };
