// ─── Authoritative AI Provider Registry ──────────────────────────────────────
//
// This module is the SINGLE SOURCE OF TRUTH for every automatic AI provider:
// identity, canonical rank, environment variable names, configured check, API
// base URL, per-use-case model selection, request format, output-token budget,
// timeout, retry policy, structured-JSON support, and emergency-only status.
//
// Every fallback sequence, health endpoint, admin diagnostic, environment
// check, documentation table, and test MUST derive its provider order from
// CANONICAL_AI_PROVIDER_ORDER / getProviderRegistry() here. Do NOT hardcode a
// separate provider-order array or fallback-chain string anywhere else.
//
// Security: this module only describes configuration. It NEVER stores, logs, or
// returns API key VALUES, Authorization headers, or raw provider response
// bodies. Key presence is read at request time via readProviderKey().

import {
  CANONICAL_AI_PROVIDER_ORDER as CATALOG_ORDER,
  ALL_CONFIGURED_PROVIDERS as CATALOG_ALL_PROVIDERS,
  automaticProviderOrder as catalogAutomaticOrder,
  PROVIDER_API_KEY_ENV,
} from "./ai-provider-catalog.cjs";

export type AiProviderName =
  | "zai"
  | "cerebras"
  | "mistral"
  | "groq"
  | "openrouter"
  | "gemini"
  | "openai"
  | "together"
  | "deepseek"
  | "anthropic";

// The canonical automatic provider order. The single literal lives in the
// plain-CJS catalog (lib/ai-provider-catalog.cjs) so build-time scripts
// (next.config.js, scripts/check-env.mjs) consume the SAME order without any
// duplication. The order is the owner's directive — gemini → groq → mistral →
// zai → cerebras → openrouter → openai → together → deepseek → anthropic —
// and every one of them is reachable by automatic routing. Nothing filters it.
export const CANONICAL_AI_PROVIDER_ORDER: readonly AiProviderName[] = CATALOG_ORDER;

export type AiUseCase = "default" | "extraction" | "proposal" | "validation" | "fast" | "reasoning";

// How a provider's HTTP request body is shaped. Drives which adapter handles
// the call and which output-token parameter name is used on the wire.
export type ProviderRequestFormat =
  | "openai-compatible" // standard OpenAI /chat/completions, uses `max_tokens`
  | "cerebras" // OpenAI-compatible but uses `max_completion_tokens`
  | "gemini" // Google Generative AI SDK
  | "anthropic"; // Anthropic Messages SDK

export type ProviderEnvVars = {
  apiKey: string;
  baseUrl?: string;
  proposalModel?: string;
  analysisModel?: string;
  fastModel?: string;
  // Alternate env names also accepted for the API key (back-compat).
  apiKeyAliases?: readonly string[];
};

export type ProviderOutputCaps = {
  analysis: number;
  proposal: number;
  fast: number;
};

export type ProviderRetryPolicy = {
  // Maximum retries against THIS provider before moving to the next eligible
  // provider. Per the Vercel-Hobby attempt budget, transient failures move on
  // rather than retrying the same provider, so this is 0 for fallback members.
  maxRetries: number;
  // Whether an auth (401/403) failure should ever be retried. Never true.
  retryOnAuth: false;
  // Whether a billing (402) failure should ever be retried. Never true.
  retryOnBilling: false;
};

/**
 * Informational cost classification for diagnostics only. It never changes
 * automatic eligibility or the configured model identifier.
 *
 *   "free"             — usable on a free account with no payment method.
 *   "conditional-free" — pricing depends on the configured provider model.
 *   "paid"             — provider ordinarily requires paid access.
 */
export type ProviderAccessClass = "free" | "conditional-free" | "paid";

export type ProviderRegistryEntry = {
  provider: AiProviderName;
  displayName: string;
  rank: number;
  access: ProviderAccessClass;
  /**
   * Path (relative to baseUrl) of the provider's own model-listing endpoint,
   * or null when it has none reachable this way.
   *
   * This is how the app answers "which models may this account actually call?"
   * WITHOUT keeping a local copy of a third party's catalogue. A hardcoded model
   * list is a second authority on a question only the provider can answer, and
   * it goes stale the moment they retire a snapshot — which is exactly how a
   * retired model ends up pinned in a default and every request 404s. The
   * capability test lists models live and verifies the resolved one really
   * works before the provider is called usable.
   */
  modelsEndpoint: string | null;
  /**
   * Ordered PREFERENCE HINTS used when discovering a model — not assertions that
   * these models exist. Each candidate is checked against the provider's live
   * model list, and the first one the account can actually call wins. If none
   * matches, the resolver falls back to what the provider itself reports rather
   * than sending a name this codebase invented.
   */
  freeTierPreference: readonly string[];
  env: ProviderEnvVars;
  requestFormat: ProviderRequestFormat;
  defaults: {
    baseUrl: string | null;
    proposalModel: string;
    analysisModel: string;
    fastModel: string;
  };
  outputCaps: ProviderOutputCaps;
  timeoutMs: number;
  retry: ProviderRetryPolicy;
  // Whether the provider can return guaranteed structured JSON (response_format
  // json_object). When true, structured-extraction calls request JSON mode.
  supportsStructuredJson: boolean;
  // Emergency-only providers are last-resort: they sit at the tail of the
  // canonical order and are only reached when every earlier provider is
  // unavailable/cooling/exhausted.
  emergencyOnly: boolean;
};

// Standard per-use-case output caps for OpenAI-class providers that previously
// used a 16K budget. Kept generous for proposal/reasoning, tighter for fast.
const STANDARD_CAPS: ProviderOutputCaps = { analysis: 4000, proposal: 16000, fast: 1200 };

// Conservative caps mandated for the free-tier OpenAI-compatible newcomers.
// FIX: Analysis cap raised from 3000 to 8000 — the AI Analyze prompt asks for
// a complex JSON object with 20+ fields and nested arrays. 3000 tokens
// truncates the response → MALFORMED_RESPONSE → provider marked as failed.
// 8000 tokens is sufficient for a complete analysis JSON while still being
// within free-tier limits for Z.ai GLM and Cerebras.
const CONSERVATIVE_CAPS: ProviderOutputCaps = { analysis: 8000, proposal: 4000, fast: 1200 };
// Hobby-safe caps: 2x proposal depth vs conservative, still fits 45s timeout.
// GLM-4-Flash generates 8K tokens in ~20-25s, well within the 45s Tier 1 budget.
const HOBBY_SAFE_CAPS: ProviderOutputCaps = { analysis: 8000, proposal: 8000, fast: 1200 };

const DEFAULT_TIMEOUT_MS = 20_000;
// FIX: Z.ai and Cerebras need longer timeouts for AI Analyze. The analysis
// prompt is very large (thousands of tokens) and glm-4.7-flash / gpt-oss-120b
// can take 15-40s to generate a complete JSON response. 20s causes TIMEOUT
// on the first provider, consuming an attempt budget slot for nothing.
const ANALYSIS_TIMEOUT_MS = 45_000;

const FALLBACK_RETRY: ProviderRetryPolicy = { maxRetries: 0, retryOnAuth: false, retryOnBilling: false };

// The authoritative registry. Order in this array is irrelevant — rank governs
// the canonical sequence — but it is kept in canonical order for readability.
const REGISTRY: Readonly<Record<AiProviderName, ProviderRegistryEntry>> = {
  zai: {
    provider: "zai",
    displayName: "Z.ai GLM",
    rank: 4,
    access: "free",
    modelsEndpoint: "/models",
    freeTierPreference: ["glm-4.7-flash", "glm-4-flash"],
    env: {
      apiKey: PROVIDER_API_KEY_ENV.zai,
      baseUrl: "ZAI_BASE_URL",
      proposalModel: "ZAI_PROPOSAL_MODEL",
      analysisModel: "ZAI_ANALYSIS_MODEL",
      fastModel: "ZAI_FAST_MODEL",
    },
    requestFormat: "openai-compatible",
    defaults: {
      // General Z.ai API endpoint (NOT a Coding Plan endpoint).
      baseUrl: "https://api.z.ai/api/paas/v4",
      proposalModel: "glm-4.7-flash",
      analysisModel: "glm-4.7-flash",
      fastModel: "glm-4.7-flash",
    },
    outputCaps: HOBBY_SAFE_CAPS, // 8K proposal tokens — safe for Vercel Hobby 45s
    // FIX: 45s timeout for analysis — the large AI Analyze prompt needs
    // more than the 20s default. Z.ai glm-4.7-flash can take 15-40s on
    // a full tender analysis JSON response.
    timeoutMs: ANALYSIS_TIMEOUT_MS,
    retry: FALLBACK_RETRY,
    supportsStructuredJson: true,
    emergencyOnly: false,
  },
  cerebras: {
    provider: "cerebras",
    displayName: "Cerebras",
    rank: 5,
    access: "paid",
    modelsEndpoint: "/models",
    freeTierPreference: [],
    env: {
      apiKey: PROVIDER_API_KEY_ENV.cerebras,
      baseUrl: "CEREBRAS_BASE_URL",
      proposalModel: "CEREBRAS_PROPOSAL_MODEL",
      analysisModel: "CEREBRAS_ANALYSIS_MODEL",
      fastModel: "CEREBRAS_FAST_MODEL",
    },
    // OpenAI-compatible wire format, but MUST use max_completion_tokens.
    requestFormat: "cerebras",
    defaults: {
      baseUrl: "https://api.cerebras.ai/v1",
      proposalModel: "gpt-oss-120b",
      analysisModel: "gpt-oss-120b",
      fastModel: "gpt-oss-120b",
    },
    outputCaps: HOBBY_SAFE_CAPS, // 8K proposal tokens — safe for Vercel Hobby 45s
    // FIX: 45s timeout — same rationale as Z.ai.
    timeoutMs: ANALYSIS_TIMEOUT_MS,
    retry: FALLBACK_RETRY,
    supportsStructuredJson: true,
    emergencyOnly: false,
  },
  mistral: {
    provider: "mistral",
    displayName: "Mistral",
    rank: 3,
    access: "free",
    modelsEndpoint: "/models",
    freeTierPreference: ["mistral-small-latest", "open-mistral-nemo", "ministral-8b-latest"],
    env: {
      apiKey: PROVIDER_API_KEY_ENV.mistral,
      baseUrl: "MISTRAL_BASE_URL",
      proposalModel: "MISTRAL_PROPOSAL_MODEL",
      analysisModel: "MISTRAL_ANALYSIS_MODEL",
      fastModel: "MISTRAL_FAST_MODEL",
    },
    requestFormat: "openai-compatible",
    defaults: {
      baseUrl: "https://api.mistral.ai/v1",
      // mistral-large-latest is a paid model. Zero-paid defaults to the
      // free-tier small model, matching freeTierPreference.
      proposalModel: "mistral-small-latest",
      analysisModel: "mistral-small-latest",
      fastModel: "ministral-8b-latest",
    },
    outputCaps: STANDARD_CAPS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retry: FALLBACK_RETRY,
    supportsStructuredJson: true,
    emergencyOnly: false,
  },
  groq: {
    provider: "groq",
    displayName: "Groq",
    rank: 2,
    access: "free",
    modelsEndpoint: "/models",
    freeTierPreference: ["llama-3.1-8b-instant"],
    env: {
      apiKey: PROVIDER_API_KEY_ENV.groq,
      baseUrl: "GROQ_BASE_URL",
      proposalModel: "GROQ_PROPOSAL_MODEL",
      analysisModel: "GROQ_ANALYSIS_MODEL",
      fastModel: "GROQ_FAST_MODEL",
    },
    requestFormat: "openai-compatible",
    defaults: {
      baseUrl: "https://api.groq.com/openai/v1",
      // Groq has no runtime default. Its retired 70B default must never be
      // reached, and discovery alone cannot prove that a replacement is free
      // for this account. Operators must configure the currently verified
      // free-tier model explicitly.
      proposalModel: "",
      analysisModel: "",
      fastModel: "",
    },
    outputCaps: STANDARD_CAPS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retry: FALLBACK_RETRY,
    supportsStructuredJson: true,
    emergencyOnly: false,
  },
  openrouter: {
    provider: "openrouter",
    displayName: "OpenRouter",
    rank: 6,
    access: "conditional-free",
    modelsEndpoint: "/models",
    freeTierPreference: [],
    env: {
      apiKey: PROVIDER_API_KEY_ENV.openrouter,
      baseUrl: "OPENROUTER_BASE_URL",
      proposalModel: "OPENROUTER_PROPOSAL_MODEL",
      analysisModel: "OPENROUTER_ANALYSIS_MODEL",
      fastModel: "OPENROUTER_FAST_MODEL",
    },
    requestFormat: "openai-compatible",
    defaults: {
      baseUrl: "https://openrouter.ai/api/v1",
      // No model default. OpenRouter is an aggregator: the model identifier
      // selects both the vendor and the price, so there is no sensible value to
      // guess on the operator's behalf. Set OPENROUTER_PROPOSAL_MODEL /
      // OPENROUTER_ANALYSIS_MODEL / OPENROUTER_FAST_MODEL to whichever model
      // this account should use. Without one the provider is skipped, because a
      // request cannot be built — not because of any cost policy, which this
      // deployment no longer has.
      proposalModel: "",
      analysisModel: "",
      fastModel: "",
    },
    outputCaps: STANDARD_CAPS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retry: FALLBACK_RETRY,
    supportsStructuredJson: true,
    emergencyOnly: false,
  },
  gemini: {
    provider: "gemini",
    displayName: "Gemini",
    rank: 1,
    access: "free",
    modelsEndpoint: "/v1beta/models",
    freeTierPreference: ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"],
    env: {
      apiKey: PROVIDER_API_KEY_ENV.gemini,
      proposalModel: "GEMINI_MODEL",
      analysisModel: "GEMINI_ANALYSIS_MODEL",
      fastModel: "GEMINI_EXTRACTION_MODEL",
    },
    requestFormat: "gemini",
    defaults: {
      baseUrl: null,
      // Flash, not Pro: gemini-2.5-pro is not served on the free tier, so
      // defaulting to it made rank-1 Gemini fail on a free-tier account before
      // it could answer anything. Each value here is the head of the matching
      // freeTierPreference list, so the source default and the live-verified
      // choice can never disagree.
      proposalModel: "gemini-2.5-flash",
      analysisModel: "gemini-2.5-flash",
      fastModel: "gemini-2.0-flash",
    },
    outputCaps: STANDARD_CAPS,
    timeoutMs: 28_000,
    retry: FALLBACK_RETRY,
    supportsStructuredJson: false,
    emergencyOnly: false,
  },
  openai: {
    provider: "openai",
    displayName: "OpenAI",
    rank: 7,
    access: "paid",
    modelsEndpoint: "/models",
    freeTierPreference: [],
    env: {
      apiKey: PROVIDER_API_KEY_ENV.openai,
      baseUrl: "OPENAI_BASE_URL",
      proposalModel: "OPENAI_PROPOSAL_MODEL",
      analysisModel: "OPENAI_ANALYSIS_MODEL",
      fastModel: "OPENAI_FAST_MODEL",
    },
    requestFormat: "openai-compatible",
    defaults: {
      baseUrl: "https://api.openai.com/v1",
      proposalModel: "gpt-4o",
      analysisModel: "gpt-4o",
      fastModel: "gpt-4o-mini",
    },
    outputCaps: STANDARD_CAPS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retry: FALLBACK_RETRY,
    supportsStructuredJson: true,
    emergencyOnly: false,
  },
  together: {
    provider: "together",
    displayName: "Together",
    rank: 8,
    access: "paid",
    modelsEndpoint: "/models",
    freeTierPreference: [],
    env: {
      apiKey: PROVIDER_API_KEY_ENV.together,
      baseUrl: "TOGETHER_BASE_URL",
      proposalModel: "TOGETHER_PROPOSAL_MODEL",
      analysisModel: "TOGETHER_ANALYSIS_MODEL",
      fastModel: "TOGETHER_FAST_MODEL",
    },
    requestFormat: "openai-compatible",
    defaults: {
      baseUrl: "https://api.together.xyz/v1",
      proposalModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      analysisModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      fastModel: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
    },
    outputCaps: STANDARD_CAPS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retry: FALLBACK_RETRY,
    supportsStructuredJson: true,
    emergencyOnly: false,
  },
  deepseek: {
    provider: "deepseek",
    displayName: "DeepSeek",
    rank: 9,
    access: "paid",
    modelsEndpoint: "/models",
    freeTierPreference: [],
    env: {
      apiKey: PROVIDER_API_KEY_ENV.deepseek,
      apiKeyAliases: ["DEEP_SEEK_API_KEY", "DEEPSEEK_KEY"],
      baseUrl: "DEEPSEEK_BASE_URL",
      proposalModel: "DEEPSEEK_PROPOSAL_MODEL",
      analysisModel: "DEEPSEEK_ANALYSIS_MODEL",
      fastModel: "DEEPSEEK_FAST_MODEL",
    },
    requestFormat: "openai-compatible",
    defaults: {
      baseUrl: "https://api.deepseek.com/v1",
      proposalModel: "deepseek-chat",
      analysisModel: "deepseek-chat",
      fastModel: "deepseek-chat",
    },
    outputCaps: STANDARD_CAPS,
    timeoutMs: 20_000,
    retry: FALLBACK_RETRY,
    supportsStructuredJson: true,
    emergencyOnly: false,
  },
  anthropic: {
    provider: "anthropic",
    displayName: "Anthropic / Claude",
    rank: 10,
    access: "paid",
    modelsEndpoint: null,
    freeTierPreference: [],
    env: {
      apiKey: PROVIDER_API_KEY_ENV.anthropic,
      proposalModel: "ANTHROPIC_PROPOSAL_MODELS",
    },
    requestFormat: "anthropic",
    defaults: {
      baseUrl: null,
      proposalModel: "claude-sonnet-4-5",
      analysisModel: "claude-sonnet-4-5",
      fastModel: "claude-3-5-haiku-latest",
    },
    outputCaps: STANDARD_CAPS,
    timeoutMs: 10_000,
    retry: FALLBACK_RETRY,
    // Last AI provider — emergency-only (rank 10). All earlier providers are automatic; Anthropic is the emergency-only last resort.
    emergencyOnly: true,
    supportsStructuredJson: false,
  },
};

// ─── Accessors ────────────────────────────────────────────────────────────────

export function getProviderRegistry(): Readonly<Record<AiProviderName, ProviderRegistryEntry>> {
  return REGISTRY;
}

export function getProviderEntry(provider: AiProviderName): ProviderRegistryEntry {
  return REGISTRY[provider];
}

/** Canonical ordered list of registry entries (rank ascending). */
export function getCanonicalProviderEntries(): ProviderRegistryEntry[] {
  return CANONICAL_AI_PROVIDER_ORDER.map((p) => REGISTRY[p]);
}

export const ALL_CONFIGURED_PROVIDERS: readonly AiProviderName[] = CATALOG_ALL_PROVIDERS;

export function getAllConfiguredProviderEntries(): ProviderRegistryEntry[] {
  return ALL_CONFIGURED_PROVIDERS.map((p) => REGISTRY[p]);
}

export function providerDisplayName(provider: AiProviderName): string {
  return REGISTRY[provider].displayName;
}

export const CANONICAL_AI_PROVIDER_DISPLAY_NAMES: readonly string[] =
  CANONICAL_AI_PROVIDER_ORDER.map((p) => REGISTRY[p].displayName);

// Human-readable fallback chain string, generated from the registry. Appends
// the deterministic draft fallback so operator-facing surfaces describe the
// complete recovery path.
export const CANONICAL_AI_PROVIDER_CHAIN_DISPLAY =
  CANONICAL_AI_PROVIDER_DISPLAY_NAMES.join(" → ");

export const CANONICAL_AI_FALLBACK_CHAIN_DISPLAY =
  `${CANONICAL_AI_PROVIDER_CHAIN_DISPLAY} → deterministic draft fallback`;

export function providerRank(provider: AiProviderName): number {
  return REGISTRY[provider].rank;
}

/** The highest-ranked configured provider, or null when none is configured. */
export function preferredConfiguredProviderName(
  env: NodeJS.ProcessEnv = process.env,
): AiProviderName | null {
  return CANONICAL_AI_PROVIDER_ORDER.find((p) => isProviderConfigured(p, env)) ?? null;
}

// ─── Configuration helpers (request-time, never cached at module load) ────────

/**
 * Read a provider's API key at request time. Checks the canonical env var plus
 * any aliases. Returns undefined when unset/blank. This is the ONE helper used
 * for both the configured check and the actual invocation, so configured-state
 * and call-state can never disagree (prevents stale module-level key caches).
 */
export function readProviderKey(
  provider: AiProviderName,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const entry = REGISTRY[provider];
  const candidates = [entry.env.apiKey, ...(entry.env.apiKeyAliases ?? [])];
  for (const name of candidates) {
    const value = env[name];
    if (value && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

export function isProviderConfigured(
  provider: AiProviderName,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (provider === "openrouter") {
    return Boolean(readProviderKey(provider, env)) && getProviderModel(provider, "proposal", env).length > 0;
  }
  if (provider === "zai") {
    // Z.ai requires a valid endpoint/model pairing — Coding Plan keys cannot
    // use General models and vice versa. Skip the provider if the
    // configuration is invalid instead of burning an attempt on a 400.
    return resolveZaiConfiguration("proposal", env).valid
      && resolveZaiConfiguration("extraction", env).valid
      && resolveZaiConfiguration("fast", env).valid;
  }
  if (provider === "groq") {
    return Boolean(readProviderKey(provider, env))
      && (["proposal", "extraction", "fast"] as const).every((useCase) => {
        const model = getProviderModel(provider, useCase, env);
        return model.length > 0;
      });
  }
  return Boolean(readProviderKey(provider, env));
}

export function getProviderBaseUrl(
  provider: AiProviderName,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const entry = REGISTRY[provider];
  const envName = entry.env.baseUrl;
  const fromEnv = envName ? env[envName]?.trim() : undefined;
  const base = fromEnv && fromEnv.length > 0 ? fromEnv : entry.defaults.baseUrl;
  return base ? base.replace(/\/+$/, "") : null;
}

export function getProviderModel(
  provider: AiProviderName,
  useCase: AiUseCase = "proposal",
  env: NodeJS.ProcessEnv = process.env,
): string {
  const entry = REGISTRY[provider];
  const slot: keyof ProviderRegistryEntry["defaults"] =
    useCase === "extraction"
      ? "analysisModel"
      : useCase === "fast"
        ? "fastModel"
        : "proposalModel";
  const envName =
    slot === "analysisModel"
      ? entry.env.analysisModel
      : slot === "fastModel"
        ? entry.env.fastModel
        : entry.env.proposalModel;

  // Z.ai uses a dedicated resolver that validates the endpoint and the shape of
  // the model identifier. A malformed configuration is skipped before consuming
  // an attempt; which GLM models a key may actually use is Z.ai's to answer.
  if (provider === "zai") return resolveZaiConfiguration(useCase, env).model;

  const fromEnv = envName ? env[envName]?.trim() : undefined;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  // Analysis/fast fall back to the proposal model env if their specific env is
  // unset (mirrors prior getMistralAnalysisModel behaviour), then to defaults.
  if (slot !== "proposalModel") {
    const proposalEnv = entry.env.proposalModel ? env[entry.env.proposalModel]?.trim() : undefined;
    if (proposalEnv && proposalEnv.length > 0) return proposalEnv;
  }
  return entry.defaults[slot];
}

// ─── Z.ai Configuration Resolver ────────────────────────────────────
// Z.ai's General API and Coding Plan are both served from api.z.ai; the plan is
// carried by the key, not the URL. This resolver therefore checks the three
// things the app can know locally — key present, endpoint is api.z.ai, model
// identifier is well-formed — and leaves model entitlement to the provider.

export type ZaiPlanType = "general" | "coding-plan" | "unknown";

export type ZaiConfigurationResult = {
  valid: boolean;
  reason: "OK" | "API_KEY_MISSING" | "BASE_URL_MISSING" | "MODEL_UNSUPPORTED" | "MODEL_ENDPOINT_MISMATCH";
  safeMessage: string;
  baseUrl: string;
  model: string;
  planType: ZaiPlanType;
  useCase: AiUseCase;
};

const ZAI_GENERAL_BASE_URL = "https://api.z.ai/api/paas/v4";

/**
 * Z.ai model identifiers are validated by SHAPE, not by an enumerated list.
 *
 * This used to be two hardcoded Sets mirroring Z.ai's catalogue
 * (`{glm-4-flash, glm-4-flashx}` and `{glm-4-coding, glm-4v-coding}`). A local
 * copy of a third party's model list is a second authority on a question only
 * the provider can answer, and it goes stale the moment they ship a model. It
 * did: when the operator configured the current `glm-4.7-flash` family, the
 * allowlist rejected it as MODEL_UNSUPPORTED and rank-1 Z.ai was skipped
 * before it ever made a request — every call silently fell through to
 * Cerebras, with no error anywhere because the skip was "safe".
 *
 * A shape check keeps the genuine protection (an empty value, or another
 * vendor's identifier pasted into ZAI_*_MODEL, is still refused before an
 * attempt is spent) while letting Z.ai be the authority on which of its own
 * models exist. A model this app does not recognise now produces a real,
 * classified MODEL_UNAVAILABLE from the provider instead of an invisible skip.
 */
const ZAI_MODEL_SHAPE = /^glm-[0-9][0-9a-z.\-]*$/;

function isPlausibleZaiModel(model: string): boolean {
  return ZAI_MODEL_SHAPE.test(model.trim().toLowerCase());
}

// Both the General API and the Coding Plan are served from api.z.ai; the plan
// is determined by which key the operator holds, not by the URL. The endpoint
// therefore identifies the platform only.
function zaiPlanTypeForBaseUrl(baseUrl: string): ZaiPlanType {
  const normalized = baseUrl.replace(/\/+$/, "").toLowerCase();
  return normalized === ZAI_GENERAL_BASE_URL ? "general" : "unknown";
}

export function resolveZaiConfiguration(
  useCase: AiUseCase = "proposal",
  env: NodeJS.ProcessEnv = process.env,
): ZaiConfigurationResult {
  const entry = REGISTRY.zai;
  const baseUrl = (getProviderBaseUrl("zai", env) ?? ZAI_GENERAL_BASE_URL).replace(/\/+$/, "");
  const planType = zaiPlanTypeForBaseUrl(baseUrl);
  const slot: keyof ProviderRegistryEntry["defaults"] =
    useCase === "extraction" ? "analysisModel" : useCase === "fast" ? "fastModel" : "proposalModel";
  const envName = slot === "analysisModel" ? entry.env.analysisModel : slot === "fastModel" ? entry.env.fastModel : entry.env.proposalModel;
  const specific = envName ? env[envName]?.trim() : undefined;
  const proposal = entry.env.proposalModel ? env[entry.env.proposalModel]?.trim() : undefined;

  // Effective model: the specific env override, else the proposal override for
  // non-proposal slots, else the registry default.
  const model = (specific && specific.length > 0
    ? specific
    : slot !== "proposalModel" && proposal && proposal.length > 0
      ? proposal
      : entry.defaults[slot]
  ).trim();
  const keyPresent = Boolean(readProviderKey("zai", env));

  if (!keyPresent) return { valid: false, reason: "API_KEY_MISSING", safeMessage: "Z.ai API key is not configured.", baseUrl, model, planType, useCase };
  if (planType === "unknown") return { valid: false, reason: "BASE_URL_MISSING", safeMessage: "Z.ai base URL is not the supported api.z.ai endpoint.", baseUrl, model, planType, useCase };
  if (!isPlausibleZaiModel(model)) return { valid: false, reason: "MODEL_UNSUPPORTED", safeMessage: "Z.ai model identifier is empty or does not look like a Z.ai GLM model.", baseUrl, model, planType, useCase };
  // Beyond this point the configuration is well-formed, so the provider is the
  // authority on whether the key may use the model. If it may not, Z.ai answers
  // with an error that classifyAiError() turns into MODEL_UNAVAILABLE (or AUTH,
  // RATE_LIMIT, PROVIDER_ERROR…) and the chain falls through to rank 2 with a
  // recorded reason — rather than the provider being skipped silently here.

  return { valid: true, reason: "OK", safeMessage: "Z.ai configuration is valid.", baseUrl, model, planType, useCase };
}

export function getProviderOutputCap(
  provider: AiProviderName,
  useCase: AiUseCase = "proposal",
): number {
  const caps = REGISTRY[provider].outputCaps;
  if (useCase === "extraction") return caps.analysis;
  if (useCase === "fast") return caps.fast;
  return caps.proposal;
}

/**
 * Returns the per-provider timeout from the registry. This is the timeout
 * for a SINGLE provider call (not the overall route deadline). Used by
 * generateWithZai/generateWithCerebras/etc. to pass to generateOpenAICompatible.
 */
export function getProviderTimeoutMs(provider: AiProviderName): number {
  return REGISTRY[provider].timeoutMs;
}

// ─── OpenRouter free-model policy ─────────────────────────────────────────────

export type OpenRouterModelValidity = {
  valid: boolean;
  model: string | null;
  reason: "OK" | "MODEL_UNAVAILABLE" | "CONFIGURATION_INVALID";
  message: string | null;
};

/** OpenRouter uses the exact configured model identifier without rewriting it. */
export function openRouterModelValidity(env: NodeJS.ProcessEnv = process.env): OpenRouterModelValidity {
  const configured = (env.OPENROUTER_PROPOSAL_MODEL || env.OPENROUTER_ANALYSIS_MODEL || "").trim();
  if (!configured) {
    return {
      valid: false,
      model: null,
      reason: "CONFIGURATION_INVALID",
      message: "OPENROUTER_PROPOSAL_MODEL is not set.",
    };
  }
  return { valid: true, model: configured, reason: "OK", message: null };
}

/**
 * The provider order the automatic fallback chain uses: the complete canonical
 * order, every time. There is no mode, flag or cost class that narrows it.
 */
export function getAutomaticProviderOrder(
  _env: NodeJS.ProcessEnv = process.env,
): readonly AiProviderName[] {
  // The env parameter is retained for call-site compatibility and is
  // deliberately ignored: the chain is the canonical order for every
  // environment. Nothing may narrow or reorder it.
  return catalogAutomaticOrder() as readonly AiProviderName[];
}

export type ProviderEligibility = {
  provider: AiProviderName;
  eligible: boolean;
  // PAID_ACCESS_BLOCKED, CONDITIONAL_FREE_UNVERIFIED and
  // MODEL_FREE_STATUS_UNPROVEN were removed with the cost-class policy. They
  // are deliberately absent rather than kept as unreachable members: leaving
  // them would let dead branches keep compiling in every consumer, which is how
  // a removed policy goes on quietly shaping behaviour.
  reason: "OK" | "NOT_CONFIGURED" | "NOT_IN_AUTOMATIC_ORDER";
  safeMessage: string;
};

/**
 * Whether the automatic chain may contact this provider at all, before any
 * runtime health state is consulted. This is the money gate: it answers "could
 * calling this cost anything?", not "is it working?".
 */
export function providerAutomaticEligibility(
  provider: AiProviderName,
  env: NodeJS.ProcessEnv = process.env,
): ProviderEligibility {
  const entry = REGISTRY[provider];

  if (!getAutomaticProviderOrder(env).includes(provider)) {
    return {
      provider,
      eligible: false,
      reason: "NOT_IN_AUTOMATIC_ORDER",
      safeMessage: `${entry.displayName} is not part of the active automatic provider order.`,
    };
  }

  if (!isProviderConfigured(provider, env)) {
    return {
      provider,
      eligible: false,
      reason: "NOT_CONFIGURED",
      safeMessage: `${entry.displayName} is not configured.`,
    };
  }

  return { provider, eligible: true, reason: "OK", safeMessage: "OK" };
}

/** Providers the automatic chain may contact right now, in priority order. */
export function automaticallyEligibleProviders(
  env: NodeJS.ProcessEnv = process.env,
): AiProviderName[] {
  return getAutomaticProviderOrder(env).filter(
    (provider) => providerAutomaticEligibility(provider, env).eligible,
  );
}

/** Human-readable description of the active automatic chain, incl. the tail. */
export function automaticChainDisplay(env: NodeJS.ProcessEnv = process.env): string {
  const names = getAutomaticProviderOrder(env).map((p) => REGISTRY[p].displayName);
  return `${names.join(" → ")} → deterministic draft fallback`;
}
