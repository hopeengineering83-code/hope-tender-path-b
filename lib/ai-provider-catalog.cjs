// Single source of truth for the canonical automatic AI provider ORDER.
// AUTOMATIC FALLBACK: Gemini → OpenRouter → OpenAI → Groq → DeepSeek → Anthropic (last)
// Z.ai, Cerebras, Mistral, Together are configured but NOT automatic.

const CANONICAL_AI_PROVIDER_ORDER = [
  "gemini",
  "openrouter",
  "openai",
  "groq",
  "deepseek",
  "anthropic",
];

const ALL_CONFIGURED_PROVIDERS = [
  "zai", "cerebras", "mistral", "groq", "openrouter",
  "gemini", "openai", "together", "deepseek", "anthropic",
];

const NON_AUTOMATIC_PROVIDERS = ["zai", "cerebras", "mistral", "together"];

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
const ALL_PROVIDER_API_KEY_ENVS = ALL_CONFIGURED_PROVIDERS.map((p) => PROVIDER_API_KEY_ENV[p]);

module.exports = {
  CANONICAL_AI_PROVIDER_ORDER,
  ALL_CONFIGURED_PROVIDERS,
  NON_AUTOMATIC_PROVIDERS,
  PROVIDER_API_KEY_ENV,
  AI_PROVIDER_API_KEY_ENVS,
  ALL_PROVIDER_API_KEY_ENVS,
};
