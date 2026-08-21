// Single source of truth for the owner-directed AI provider order.
//
// Plain CJS so build-time scripts (next.config.js, scripts/check-env.mjs) and
// the TypeScript registry consume the SAME literals with no duplication.
//
// Every normally configured provider participates in this order. A missing or
// failing provider falls through to the next provider, and deterministic draft
// fallback runs only after all ten AI providers fail.

const CANONICAL_AI_PROVIDER_ORDER = [
  "gemini",
  "groq",
  "mistral",
  "zai",
  "cerebras",
  "openrouter",
  "openai",
  "together",
  "deepseek",
  "anthropic",
];

const ALL_CONFIGURED_PROVIDERS = CANONICAL_AI_PROVIDER_ORDER;

// Deprecated compatibility alias; it intentionally equals the complete chain.
const ZERO_PAID_AUTOMATIC_ORDER = CANONICAL_AI_PROVIDER_ORDER;

// Deprecated compatibility exports. No cost-class policy excludes providers.
const PAID_ACCESS_PROVIDERS = [];

const CONDITIONAL_FREE_PROVIDERS = [];

// Deprecated compatibility helper. Zero-paid-only routing is not active.
function isZeroPaidMode(_env) {
  return false;
}

// The provider order the automatic fallback chain may use, given the mode.
function automaticProviderOrder(env) {
  return CANONICAL_AI_PROVIDER_ORDER;
}

// Anthropic is the final AI-provider attempt before deterministic fallback.
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
