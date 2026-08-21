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
  providerAutomaticEligibility,
  isZeroPaidMode,
  isPaidAccessProvider,
  getAutomaticProviderOrder,
  type AiProviderName,
} from "./ai-provider-registry";
import { redactSecrets } from "./sanitize-error";
import {
  classifyProviderError,
  isBillingBlocked,
  type AiProviderFailureCategory,
} from "./ai-provider-classification";

export type { AiProviderName } from "./ai-provider-registry";
export type { AiProviderFailureCategory } from "./ai-provider-classification";

// AiProviderFailureCategory is defined once, in lib/ai-provider-classification.ts,
// and re-exported above. It used to be declared here AND matched by a regex
// ladder in this file, which is how a Cerebras 402 came to be filed as a rate
// limit: the ladder tested the word "quota" before it tested "payment required".
// Classification now has exactly one implementation.

export type AiProviderStatus =
  | "NOT_CONFIGURED"
  | "CONFIGURED"
  | "CONNECTIVITY_VERIFIED"
  | "ANALYSIS_VERIFIED"
  | "GENERATION_VERIFIED"
  | "RATE_LIMITED"
  // AUTH_FAILED, not UNAUTHORIZED: "unauthorized" is also what an ownership
  // check says about a USER, and the two were being read as the same thing.
  // This one always means the PROVIDER rejected our credential.
  | "AUTH_FAILED"
  | "BILLING_BLOCKED"
  | "MODEL_UNAVAILABLE"
  | "PROVIDER_OVERLOAD"
  | "PROVIDER_ERROR"
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
  // Capacity, not our usage and not their bug — the shortest backoff of all,
  // because the identical request typically succeeds moments later.
  PROVIDER_OVERLOAD: 15_000,
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

/**
 * Redact a provider message before it is stored or surfaced.
 *
 * Delegates to the shared redactor in lib/sanitize-error.ts. This used to carry
 * its own pattern list, which is how the two came to disagree: this one knew
 * about Google's AQ-format keys and the shared one did not, so the same key was
 * redacted on one code path and printed verbatim on another. The shared list is
 * a strict superset of what was here.
 */
function redactMessage(message: string | null | undefined): string {
  return redactSecrets(message ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * Classify a provider failure. Delegates to the single authority in
 * lib/ai-provider-classification.ts — kept as an exported name here because
 * many call sites already import it from this module.
 */
export function classifyAiError(error: unknown): AiProviderFailureCategory {
  return classifyProviderError(error);
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

// ─── Billing lockout ─────────────────────────────────────────────────────────
//
// A cooldown is the wrong instrument for a billing failure. Cooldowns exist for
// conditions that clear on their own — a rate limit expires, an overloaded
// model frees up — so they expire too, and the chain tries again. "This account
// has no money" does not clear on its own. Under a plain 10-minute cooldown,
// Cerebras' 402 came back around every ten minutes for as long as the process
// lived, spending an attempt each time, and on an account with a payment method
// attached each of those attempts is a chance to be charged.
//
// A provider that demands payment is therefore removed from the automatic chain
// for the life of the process, not parked. It stays fully visible in health and
// diagnostics as BILLING_BLOCKED, and an operator who fixes the account clears
// it deliberately via clearBillingLockout().
const billingLockout = new Map<AiProviderName, { at: number; message: string }>();

/** True when the provider answered with a payment/balance/quota-required error. */
export function isBillingLockedOut(provider: AiProviderName): boolean {
  return billingLockout.has(provider);
}

export function getBillingLockout(provider: AiProviderName): { at: string; message: string } | null {
  const entry = billingLockout.get(provider);
  return entry ? { at: new Date(entry.at).toISOString(), message: entry.message } : null;
}

/** Operator action after fixing the account — never automatic. */
export function clearBillingLockout(provider?: AiProviderName): void {
  if (provider) billingLockout.delete(provider);
  else billingLockout.clear();
}

/**
 * Re-arm a lockout learned by a DIFFERENT instance.
 *
 * The lockout above is a module-level Map, and on a serverless platform that
 * means one lambda. Instance A discovering that a provider demands payment did
 * nothing for instance B, which would rediscover it on its own next request —
 * once per cold start, forever. The lockout is reconstructed on restore from
 * the persisted failure category, so it needs no schema change: BILLING is
 * already the recorded category, and it is the only category that means this.
 */
export function restoreBillingLockout(provider: AiProviderName, at: number, message: string): void {
  if (!billingLockout.has(provider)) billingLockout.set(provider, { at, message });
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

  // Billing is terminal for automatic use — lock the provider out rather than
  // scheduling it to be tried again.
  if (isBillingBlocked(category) && !billingLockout.has(provider)) {
    billingLockout.set(provider, { at: now, message });
  }

  const baseCooldown = COOLDOWN_PER_CATEGORY_MS[category];
  const backoffFactor = Math.min(Math.pow(2, s.consecutiveFailures - 1), 16);
  s.cooldownUntil = now + baseCooldown * backoffFactor;

  return category;
}

// ─── Diagnostic observations, kept off the workload path ─────────────────────
//
// Running "Test provider chain" used to write straight into the state above.
// A diagnostic that found Groq rate-limited therefore imposed a real cooldown
// on real analysis work — the act of asking "is this working?" made it stop
// working, and an operator debugging a failure made the failure worse by
// looking at it.
//
// Diagnostics now record here instead. The observations are reported to the
// operator, and they never gate routing. The single deliberate exception is
// BILLING: discovering that a provider wants money is exactly the thing that
// must reach the workload path, because acting on it prevents a charge rather
// than causing an outage.
export type DiagnosticObservation = {
  provider: AiProviderName;
  observedAt: number;
  capability: "connectivity" | "analysis" | "generation";
  ok: boolean;
  category: AiProviderFailureCategory | null;
  safeMessage: string | null;
  model: string | null;
  latencyMs: number | null;
};

const diagnosticObservations = new Map<AiProviderName, DiagnosticObservation[]>();

export function recordDiagnosticObservation(
  observation: Omit<DiagnosticObservation, "observedAt"> & { observedAt?: number },
): AiProviderFailureCategory | null {
  const entry: DiagnosticObservation = {
    ...observation,
    safeMessage: observation.safeMessage ? redactMessage(observation.safeMessage) : null,
    observedAt: observation.observedAt ?? Date.now(),
  };
  const list = diagnosticObservations.get(observation.provider) ?? [];
  // Keep only the most recent observation per capability, so the report shows
  // the current picture rather than an ever-growing log.
  const kept = list.filter((o) => o.capability !== entry.capability);
  kept.push(entry);
  diagnosticObservations.set(observation.provider, kept);

  // Billing is the one observation that must cross over into routing.
  if (!entry.ok && isBillingBlocked(entry.category) && !billingLockout.has(entry.provider)) {
    billingLockout.set(entry.provider, {
      at: entry.observedAt,
      message: entry.safeMessage ?? "Provider requires payment.",
    });
  }
  return entry.category;
}

export function getDiagnosticObservations(provider: AiProviderName): DiagnosticObservation[] {
  return [...(diagnosticObservations.get(provider) ?? [])];
}

export function resetDiagnosticObservations(provider?: AiProviderName): void {
  if (provider) diagnosticObservations.delete(provider);
  else diagnosticObservations.clear();
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

  // No key at all → NOT_CONFIGURED. (A key with an invalid model is reported as
  // CONFIGURATION_INVALID below, not NOT_CONFIGURED.)
  if (!readProviderKey(provider)) return "NOT_CONFIGURED";

  // Billing outranks everything a key can prove. Two ways to get here, and both
  // mean the same thing to an operator — this provider will not answer without
  // money — so both must render as BILLING_BLOCKED rather than as a stale
  // success or a generic cooldown:
  //   - the provider told us so (billing lockout), or
  //   - zero-paid mode excludes it before it is ever asked.
  if (isBillingLockedOut(provider)) return "BILLING_BLOCKED";

  const cooling = isProviderCooledDown(provider);
  if (cooling) {
    const category = h.lastFailureCategory;
    switch (category) {
      case "RATE_LIMIT": return "RATE_LIMITED";
      case "AUTH": return "AUTH_FAILED";
      case "BILLING": return "BILLING_BLOCKED";
      case "MODEL_UNAVAILABLE": return "MODEL_UNAVAILABLE";
      case "PROVIDER_OVERLOAD": return "PROVIDER_OVERLOAD";
      case "PROVIDER_ERROR": return "PROVIDER_ERROR";
      case "TIMEOUT": return "TIMEOUT";
      case "NETWORK": return "NETWORK_ERROR";
      case "MALFORMED_RESPONSE": return "MALFORMED_RESPONSE";
      case "CONFIGURATION_INVALID": return "CONFIGURATION_INVALID";
      case "UNKNOWN": return "UNKNOWN";
      default: return "COOLING_DOWN";
    }
  }

  // Runtime-verified states, strongest evidence first. Each of these is only
  // set by a real call that really succeeded — never by a key being present.
  if (h.lastGenerationSucceededAt) return "GENERATION_VERIFIED";
  if (h.lastAnalysisSucceededAt) return "ANALYSIS_VERIFIED";
  if (h.lastPingSucceededAt) return "CONNECTIVITY_VERIFIED";

  // A conditional-free provider whose condition is unmet is a configuration
  // problem, surfaced distinctly so operators fix the model rather than see a
  // misleading NOT_CONFIGURED. It never consumes an attempt.
  if (provider === "openrouter") {
    const validity = openRouterModelValidity();
    if (!validity.valid) {
      return validity.reason === "MODEL_UNAVAILABLE" ? "MODEL_UNAVAILABLE" : "CONFIGURATION_INVALID";
    }
  }

  if (!h.configured) return "NOT_CONFIGURED";
  // A key exists and nothing has been proven about it yet. CONFIGURED is
  // deliberately NOT one of the verified states: see isProviderRuntimeUsable().
  return "CONFIGURED";
}

/**
 * The three statuses that mean a real request really succeeded.
 *
 * "Has an API key" is not one of them. Production readiness used to call AI
 * healthy on key presence alone, which is how an environment with four
 * configured providers and zero working ones reported green.
 */
export const RUNTIME_VERIFIED_STATUSES: readonly AiProviderStatus[] = [
  "CONNECTIVITY_VERIFIED",
  "ANALYSIS_VERIFIED",
  "GENERATION_VERIFIED",
];

/**
 * Whether this provider is usable for AI Analyze RIGHT NOW.
 *
 * Requires a verified ANALYSIS (or the stronger GENERATION) capability —
 * connectivity alone is not enough. A provider can answer "OK" to a one-word
 * ping and still be unable to return the structured JSON the analysis depends
 * on, because the ping proves the key and the route, not the capability. That
 * gap was the whole reason diagnostics and runtime disagreed.
 */
export function isProviderAnalysisUsable(provider: AiProviderName): boolean {
  const status = deriveProviderStatus(provider);
  return status === "ANALYSIS_VERIFIED" || status === "GENERATION_VERIFIED";
}

/** Providers with a verified analysis capability, in automatic-chain order. */
export function analysisUsableProviders(): AiProviderName[] {
  return getAutomaticProviderOrder().filter((provider) => {
    if (!providerAutomaticEligibility(provider).eligible) return false;
    return isProviderAnalysisUsable(provider);
  });
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
  /** The provider demands payment, or is excluded by zero-paid mode. */
  billingBlocked: boolean;
  /** A real call really succeeded — never true from key presence alone. */
  runtimeVerified: boolean;
  /** A real ANALYSIS call really succeeded. What AI Analyze actually needs. */
  analysisUsable: boolean;
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
    billingBlocked: status === "BILLING_BLOCKED",
    runtimeVerified: RUNTIME_VERIFIED_STATUSES.includes(status),
    analysisUsable: status === "GENERATION_VERIFIED" || status === "ANALYSIS_VERIFIED",
    // Availability now includes the money gate. A configured, non-cooling
    // provider that requires payment is NOT available: it would answer only
    // with a bill.
    available: h.configured && !coolingDown && status !== "BILLING_BLOCKED",
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
  const configured = getAutomaticProviderOrder().filter(
    (p) => providerAutomaticEligibility(p).eligible && !isBillingLockedOut(p),
  );
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
    billingLockout.delete(provider);
    diagnosticObservations.delete(provider);
    return;
  }
  state.clear();
  billingLockout.clear();
  diagnosticObservations.clear();
}

/**
 * Back-compat alias for the Mistral model getter.
 *
 * This used to read MISTRAL_PROPOSAL_MODEL and fall back to its own hardcoded
 * default — a second answer to "which Mistral model?" that could differ from
 * the registry's. It now delegates, so there is one answer.
 */
export function getMistralModel(): string {
  return getMistralProposalModel();
}

/** Back-compat alias: returns the proposal model. */
export function getTogetherModel(): string {
  return getTogetherProposalModel();
}

export function resetHealthLoadedFlag() {
  // dummy for store tests
}

export const __testing__ = { COOLDOWN_PER_CATEGORY_MS };
