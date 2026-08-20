// Single source of truth for the AI provider ORDER and the zero-paid policy.
//
// Plain CJS so build-time scripts (next.config.js, scripts/check-env.mjs) and
// the TypeScript registry consume the SAME literals with no duplication.
//
// ─── ZERO-PAID OPERATION ─────────────────────────────────────────────────────
//
// This deployment runs STRICT ZERO-PAID: no AI provider may ever be sent a
// request that could produce a charge. That is enforced structurally, in three
// layers, rather than by remembering not to configure a key:
//
//   1. AUTOMATIC ORDER. Only providers on ZERO_PAID_AUTOMATIC_ORDER are
//      reachable by the automatic fallback chain.
//   2. PAID-ACCESS EXCLUSION. Every provider on PAID_ACCESS_PROVIDERS is
//      refused before a request is built, so a key left in the environment
//      cannot spend money. They remain visible in health/diagnostics as
//      BILLING_BLOCKED — excluded, not hidden.
//   3. BILLING LOCKOUT. Any provider that answers with a payment/balance/quota
//      -required error is removed from the automatic chain for the life of the
//      process (lib/ai-provider-health.ts), so a paid failure is never retried.
//
// AUTOMATIC FALLBACK (zero-paid):
//   Gemini → Groq → Mistral → Z.ai → [OpenRouter, only with a verified :free
//   model] → deterministic draft fallback (non-AI, never final-export eligible)
//
// The full order below also fixes each provider's RANK, which health and
// diagnostics use to enumerate every known provider — including the paid ones
// they must report on but never call.

const CANONICAL_AI_PROVIDER_ORDER = [
  "gemini",
  "groq",
  "mistral",
  "zai",
  "openrouter",
  "cerebras",
  "openai",
  "together",
  "deepseek",
  "anthropic",
];

const ALL_CONFIGURED_PROVIDERS = CANONICAL_AI_PROVIDER_ORDER;

// The zero-paid automatic chain, in priority order. OpenRouter is a CONDITIONAL
// member: isProviderConfigured() admits it only when OPENROUTER_*_MODEL names an
// explicit `:free` model, so it can never route to a paid model.
const ZERO_PAID_AUTOMATIC_ORDER = ["gemini", "groq", "mistral", "zai", "openrouter"];

// Providers that require paid access on this account. Never contacted while
// zero-paid mode is on, regardless of whether a key is present.
//
//   cerebras  — HTTP 402, free-tier quota exhausted, payment method required
//   openai    — insufficient paid quota
//   deepseek  — insufficient balance
//   together  — key/access invalid, and its models are paid
//   anthropic — paid access required
const PAID_ACCESS_PROVIDERS = ["cerebras", "openai", "together", "deepseek", "anthropic"];

// OpenRouter is neither free-by-default nor paid-by-default: it is free only
// with an explicitly configured and verified `:free` model.
const CONDITIONAL_FREE_PROVIDERS = ["openrouter"];

// Zero-paid mode is ON unless an operator explicitly turns it off. Defaulting
// to ON is the point: a missing or misspelt variable must fail closed to "spend
// nothing", never open to "spend money".
function isZeroPaidMode(env) {
  const raw = String((env || process.env).AI_ZERO_PAID_MODE ?? "").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return true;
}

// The provider order the automatic fallback chain may use, given the mode.
function automaticProviderOrder(env) {
  return isZeroPaidMode(env) ? ZERO_PAID_AUTOMATIC_ORDER : CANONICAL_AI_PROVIDER_ORDER;
}

// Anthropic remains the emergency-only tail of the FULL order. In zero-paid
// mode it is excluded entirely — emergency-only and paid-blocked at once.
const EMERGENCY_ONLY_PROVIDERS = ["anthropic"];

const NON_AUTOMATIC_PROVIDERS = [];

const PROVIDER_API_KEY_ENV = {
  zai: "ZAI_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  mistral: "MISTRAL_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  together: "TOGETHER_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const AI_PROVIDER_API_KEY_ENVS = CANONICAL_AI_PROVIDER_ORDER.map((p) => PROVIDER_API_KEY_ENV[p]);
const ALL_PROVIDER_API_KEY_ENVS = AI_PROVIDER_API_KEY_ENVS;

module.exports = {
  CANONICAL_AI_PROVIDER_ORDER,
  ALL_CONFIGURED_PROVIDERS,
  ZERO_PAID_AUTOMATIC_ORDER,
  PAID_ACCESS_PROVIDERS,
  CONDITIONAL_FREE_PROVIDERS,
  isZeroPaidMode,
  automaticProviderOrder,
  EMERGENCY_ONLY_PROVIDERS,
  NON_AUTOMATIC_PROVIDERS,
  PROVIDER_API_KEY_ENV,
  AI_PROVIDER_API_KEY_ENVS,
  ALL_PROVIDER_API_KEY_ENVS,
};
