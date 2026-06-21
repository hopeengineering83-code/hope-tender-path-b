// AI Provider Health Tracker.
//
// Make provider truth accurate, secure, and based on real capability.

export type AiProviderName = "mistral" | "groq" | "openrouter" | "gemini" | "openai" | "together" | "deepseek" | "anthropic";

export type AiProviderFailureCategory =
  | "RATE_LIMIT"
  | "AUTH"
  | "BILLING"
  | "TIMEOUT"
  | "MODEL_UNAVAILABLE"
  | "NETWORK"
  | "MALFORMED_RESPONSE"
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
  | "COOLING_DOWN"
  | "UNKNOWN";

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

// ─── Dynamic Key Reads ──────────────────────────────────────────────────────

export function getAnthropicApiKey(): string | undefined {
  const v = process.env.ANTHROPIC_API_KEY;
  return v && v.trim().length > 0 ? v.trim() : undefined;
}
export function isAnthropicConfigured(): boolean {
  return Boolean(getAnthropicApiKey());
}

export function getGeminiApiKey(): string | undefined {
  const v = process.env.GEMINI_API_KEY;
  return v && v.trim().length > 0 ? v.trim() : undefined;
}
export function isGeminiConfigured(): boolean {
  return Boolean(getGeminiApiKey());
}

export function getOpenAIApiKey(): string | undefined {
  const v = process.env.OPENAI_API_KEY;
  return v && v.trim().length > 0 ? v.trim() : undefined;
}
export function isOpenAIConfigured(): boolean {
  return Boolean(getOpenAIApiKey());
}

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
export function deepSeekOfficialEnvPresent(): boolean {
  const value = process.env.DEEPSEEK_API_KEY;
  return Boolean(value && value.trim().length > 0);
}
export function getDeepSeekModel(): string {
  return process.env.DEEPSEEK_PROPOSAL_MODEL || "deepseek-chat";
}

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
export function getOpenRouterAppName(): string {
  const v = process.env.OPENROUTER_APP_NAME || process.env.OPENROUTER_SITE_NAME;
  return v && v.trim().length > 0 ? v.trim() : "Hope Tender Proposal Generator";
}

export function isProviderConfigured(provider: AiProviderName): boolean {
  switch (provider) {
    case "anthropic": return isAnthropicConfigured();
    case "gemini": return isGeminiConfigured();
    case "openai": return isOpenAIConfigured();
    case "mistral": return isMistralConfigured();
    case "deepseek": return isDeepSeekConfigured();
    case "groq": return isGroqConfigured();
    case "together": return isTogetherConfigured();
    case "openrouter": return isOpenRouterConfigured();
    default: return false;
  }
}

export const COOLDOWN_PER_CATEGORY_MS: Record<AiProviderFailureCategory, number> = {
  RATE_LIMIT: 60_000,
  AUTH: 5 * 60_000,
  BILLING: 10 * 60_000,
  TIMEOUT: 30_000,
  MODEL_UNAVAILABLE: 2 * 60_000,
  NETWORK: 30_000,
  MALFORMED_RESPONSE: 60_000,
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
  if (/404|model\s+not|not\s+found|not\s+supported|model\s+unavailable|invalid_request/.test(lower)) return "MODEL_UNAVAILABLE";
  if (/network|fetch\s+failed|econnreset|enotfound|getaddrinfo|socket\s+hang\s+up/.test(lower)) return "NETWORK";
  if (/no\s+json|malformed\s+json|invalid\s+json|json\s+parse/.test(lower)) return "MALFORMED_RESPONSE";
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
  const providers: AiProviderName[] = ["mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"];
  return providers.map(getProviderHealth);
}

export function deriveProviderStatus(provider: AiProviderName): AiProviderStatus {
  const h = getProviderHealth(provider);
  if (!h.configured) return "NOT_CONFIGURED";

  const cooling = isProviderCooledDown(provider);
  if (cooling) {
    const category = h.lastFailureCategory;
    switch (category) {
      case "RATE_LIMIT": return "RATE_LIMITED";
      case "AUTH": return "UNAUTHORIZED";
      case "BILLING": return "BILLING_BLOCKED";
      case "MODEL_UNAVAILABLE": return "BILLING_BLOCKED";
      case "TIMEOUT": return "TIMEOUT";
      case "NETWORK": return "BILLING_BLOCKED";
      case "UNKNOWN": return "UNKNOWN";
      default: return "COOLING_DOWN";
    }
  }

  if (h.lastGenerationSucceededAt) return "GENERATION_VERIFIED";
  if (h.lastAnalysisSucceededAt) return "ANALYSIS_VERIFIED";
  if (h.lastPingSucceededAt) return "CONNECTIVITY_VERIFIED";

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
  const providers: AiProviderName[] = ["mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"];
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
  const providers: AiProviderName[] = ["mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"];
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
