import type { AiProviderName } from "./ai-provider-health";

export const CANONICAL_AI_PROVIDER_CHAIN = [
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

export type CanonicalAiProvider = (typeof CANONICAL_AI_PROVIDER_CHAIN)[number];

export const CANONICAL_AI_PROVIDER_LABEL_BY_NAME: Readonly<Record<CanonicalAiProvider, string>> = {
  zai: "Z.ai GLM",
  cerebras: "Cerebras",
  mistral: "Mistral",
  groq: "Groq",
  openrouter: "OpenRouter",
  gemini: "Gemini",
  openai: "OpenAI",
  together: "Together",
  deepseek: "DeepSeek",
  anthropic: "Anthropic / Claude",
};

export const CANONICAL_AI_PROVIDER_LABELS = CANONICAL_AI_PROVIDER_CHAIN.map(
  (provider) => CANONICAL_AI_PROVIDER_LABEL_BY_NAME[provider],
);

export const CANONICAL_AI_PROVIDER_DISPLAY = CANONICAL_AI_PROVIDER_LABELS.join(" → ");

export const CANONICAL_AI_PROVIDER_ENV: Readonly<Record<CanonicalAiProvider, string>> = {
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

export const CANONICAL_AI_PROVIDER_RANK: Readonly<Record<CanonicalAiProvider, number>> = {
  zai: 1,
  cerebras: 2,
  mistral: 3,
  groq: 4,
  openrouter: 5,
  gemini: 6,
  openai: 7,
  together: 8,
  deepseek: 9,
  anthropic: 10,
};

export function configuredCanonicalProviders(env: NodeJS.ProcessEnv = process.env): CanonicalAiProvider[] {
  return CANONICAL_AI_PROVIDER_CHAIN.filter((provider) => Boolean(env[CANONICAL_AI_PROVIDER_ENV[provider]]?.trim()));
}

export function preferredCanonicalProvider(env: NodeJS.ProcessEnv = process.env): CanonicalAiProvider | null {
  return configuredCanonicalProviders(env)[0] ?? null;
}

export function canonicalProviderLabel(provider: CanonicalAiProvider): string {
  return CANONICAL_AI_PROVIDER_LABEL_BY_NAME[provider];
}

// Maximum actual outbound provider attempts per request/chunk.
export const MAX_PROVIDER_ATTEMPTS = 3;
