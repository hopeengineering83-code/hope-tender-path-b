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

// The canonical automatic provider order. This is the ONLY place the order is
// declared. Currently-working tier first (zai → cerebras → mistral → groq →
// openrouter), remaining supported providers after OpenRouter in the required
// order (gemini → openai → together → deepseek → anthropic).
export const CANONICAL_AI_PROVIDER_ORDER = [
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
] as const satisfies readonly AiProviderName[];

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

export type ProviderRegistryEntry = {
  provider: AiProviderName;
  displayName: string;
  rank: number;
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
const CONSERVATIVE_CAPS: ProviderOutputCaps = { analysis: 3000, proposal: 4000, fast: 1200 };

const DEFAULT_TIMEOUT_MS = 20_000;

const FALLBACK_RETRY: ProviderRetryPolicy = { maxRetries: 0, retryOnAuth: false, retryOnBilling: false };

// The authoritative registry. Order in this array is irrelevant — rank governs
// the canonical sequence — but it is kept in canonical order for readability.
const REGISTRY: Readonly<Record<AiProviderName, ProviderRegistryEntry>> = {
  zai: {
    provider: "zai",
    displayName: "Z.ai GLM",
    rank: 1,
    env: {
      apiKey: "ZAI_API_KEY",
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
    outputCaps: CONSERVATIVE_CAPS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retry: FALLBACK_RETRY,
    supportsStructuredJson: true,
    emergencyOnly: false,
  },
  cerebras: {
    provider: "cerebras",
    displayName: "Cerebras",
    rank: 2,
    env: {
      apiKey: "CEREBRAS_API_KEY",
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
    outputCaps: CONSERVATIVE_CAPS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retry: FALLBACK_RETRY,
    supportsStructuredJson: true,
    emergencyOnly: false,
  },
  mistral: {
    provider: "mistral",
    displayName: "Mistral",
    rank: 3,
    env: {
      apiKey: "MISTRAL_API_KEY",
      baseUrl: "MISTRAL_BASE_URL",
      proposalModel: "MISTRAL_PROPOSAL_MODEL",
      analysisModel: "MISTRAL_ANALYSIS_MODEL",
      fastModel: "MISTRAL_FAST_MODEL",
    },
    requestFormat: "openai-compatible",
    defaults: {
      baseUrl: "https://api.mistral.ai/v1",
      proposalModel: "mistral-large-latest",
      analysisModel: "mistral-large-latest",
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
    rank: 4,
    env: {
      apiKey: "GROQ_API_KEY",
      baseUrl: "GROQ_BASE_URL",
      proposalModel: "GROQ_PROPOSAL_MODEL",
      analysisModel: "GROQ_ANALYSIS_MODEL",
      fastModel: "GROQ_FAST_MODEL",
    },
    requestFormat: "openai-compatible",
    defaults: {
      baseUrl: "https://api.groq.com/openai/v1",
      proposalModel: "llama-3.3-70b-versatile",
      analysisModel: "llama-3.3-70b-versatile",
      fastModel: "llama-3.1-8b-instant",
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
    rank: 5,
    env: {
      apiKey: "OPENROUTER_API_KEY",
      baseUrl: "OPENROUTER_BASE_URL",
      proposalModel: "OPENROUTER_PROPOSAL_MODEL",
      analysisModel: "OPENROUTER_ANALYSIS_MODEL",
      fastModel: "OPENROUTER_FAST_MODEL",
    },
    requestFormat: "openai-compatible",
    defaults: {
      baseUrl: "https://openrouter.ai/api/v1",
      // No safe default model: OpenRouter requires an explicit `:free` model.
      // `openrouter/auto` is rejected to avoid creating paid usage.
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
    rank: 6,
    env: {
      apiKey: "GEMINI_API_KEY",
      proposalModel: "GEMINI_MODEL",
      analysisModel: "GEMINI_ANALYSIS_MODEL",
      fastModel: "GEMINI_EXTRACTION_MODEL",
    },
    requestFormat: "gemini",
    defaults: {
      baseUrl: null,
      proposalModel: "gemini-2.5-pro",
      analysisModel: "gemini-2.5-pro",
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
    env: {
      apiKey: "OPENAI_API_KEY",
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
    env: {
      apiKey: "TOGETHER_API_KEY",
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
    env: {
      apiKey: "DEEPSEEK_API_KEY",
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
    env: {
      apiKey: "ANTHROPIC_API_KEY",
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
    // Last-resort emergency provider — kept last so rate limits never block the
    // app when earlier providers are available.
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
    // OpenRouter is only "configured" when it has a key AND a valid explicit
    // `:free` model — otherwise a request could create paid usage.
    return Boolean(readProviderKey(provider, env)) && openRouterModelValidity(env).valid;
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

export function getProviderOutputCap(
  provider: AiProviderName,
  useCase: AiUseCase = "proposal",
): number {
  const caps = REGISTRY[provider].outputCaps;
  if (useCase === "extraction") return caps.analysis;
  if (useCase === "fast") return caps.fast;
  return caps.proposal;
}

// ─── OpenRouter free-model policy ─────────────────────────────────────────────

export type OpenRouterModelValidity = {
  valid: boolean;
  model: string | null;
  reason: "OK" | "MODEL_UNAVAILABLE" | "CONFIGURATION_INVALID";
  message: string | null;
};

/**
 * OpenRouter must use an explicit free model. `openrouter/auto` is rejected and
 * any model whose identifier does not end in `:free` is rejected so the app can
 * never create paid OpenRouter usage.
 */
export function openRouterModelValidity(env: NodeJS.ProcessEnv = process.env): OpenRouterModelValidity {
  const configured = (env.OPENROUTER_PROPOSAL_MODEL || env.OPENROUTER_ANALYSIS_MODEL || "").trim();
  if (!configured) {
    return {
      valid: false,
      model: null,
      reason: "CONFIGURATION_INVALID",
      message: "OPENROUTER_PROPOSAL_MODEL is not set — configure an explicit ':free' model.",
    };
  }
  if (configured.toLowerCase() === "openrouter/auto") {
    return {
      valid: false,
      model: configured,
      reason: "MODEL_UNAVAILABLE",
      message: "openrouter/auto is rejected — it can route to paid models. Configure an explicit ':free' model.",
    };
  }
  if (!configured.endsWith(":free")) {
    return {
      valid: false,
      model: configured,
      reason: "CONFIGURATION_INVALID",
      message: `OpenRouter model '${configured}' does not end in ':free' — refusing to risk paid usage.`,
    };
  }
  return { valid: true, model: configured, reason: "OK", message: null };
}
