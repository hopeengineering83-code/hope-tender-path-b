// Single source of truth for the canonical automatic AI provider ORDER and the
// API-key environment variable per provider.
//
// This is plain CommonJS (NOT TypeScript) on purpose: build-time scripts that
// run before any TS compilation — next.config.js (CommonJS) and
// scripts/check-env.mjs (ESM) — must consume the exact same data as the typed
// registry (lib/ai-provider-registry.ts). The registry imports this module and
// layers the rich per-provider metadata (models, base URLs, caps, timeouts,
// retry policy) on top. There is therefore exactly ONE declaration of the
// provider order and key names in the codebase.
//
// Do NOT duplicate this order or these key names anywhere else.

/** @type {readonly string[]} */
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

/** @type {Record<string, string>} */
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

/** Known-invalid Z.ai model overrides that must never be used at runtime. */
const ZAI_FORBIDDEN_MODEL_OVERRIDES = ["glm-4.7-flash"];

// Ordered list of API-key env var names, in canonical provider order.
const AI_PROVIDER_API_KEY_ENVS = CANONICAL_AI_PROVIDER_ORDER.map(
  (p) => PROVIDER_API_KEY_ENV[p],
);

module.exports = {
  CANONICAL_AI_PROVIDER_ORDER,
  PROVIDER_API_KEY_ENV,
  AI_PROVIDER_API_KEY_ENVS,
  ZAI_FORBIDDEN_MODEL_OVERRIDES,
};
