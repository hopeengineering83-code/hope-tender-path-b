// Single source of truth for the canonical AI provider ORDER.
//
// AUTHORITATIVE AUTOMATIC FALLBACK:
//   Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI →
//   Together → DeepSeek → Anthropic → deterministic draft fallback
//
// Rules:
//   - Z.ai rank 1, automatic.
//   - Cerebras rank 2, automatic.
//   - Mistral rank 3, automatic.
//   - Groq rank 4, automatic.
//   - OpenRouter rank 5, automatic.
//   - Gemini rank 6, automatic.
//   - OpenAI rank 7, automatic.
//   - Together rank 8, automatic.
//   - DeepSeek rank 9, automatic.
//   - Anthropic rank 10, emergency-only (last AI provider).
//   - Deterministic fallback rank 11, non-AI, never final-export eligible.
//
// No provider is manual-only. Z.ai, Cerebras, Mistral, and Together are
// all part of the automatic chain.

const CANONICAL_AI_PROVIDER_ORDER = [
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
];

const ALL_CONFIGURED_PROVIDERS = CANONICAL_AI_PROVIDER_ORDER;

// Anthropic is the only emergency-only provider.
const EMERGENCY_ONLY_PROVIDERS = ["anthropic"];

// No providers are manual-only — all 10 AI providers are automatic.
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
  EMERGENCY_ONLY_PROVIDERS,
  NON_AUTOMATIC_PROVIDERS,
  PROVIDER_API_KEY_ENV,
  AI_PROVIDER_API_KEY_ENVS,
  ALL_PROVIDER_API_KEY_ENVS,
};
