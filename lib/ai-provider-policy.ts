import type { AiProviderName } from "./ai-provider-health";

export const CANONICAL_AI_PROVIDER_CHAIN: readonly AiProviderName[] = [
  "gemini",
  "openrouter",
  "openai",
  "groq",
  "deepseek",
  "anthropic",
] as const;

export type CanonicalAiProvider = (typeof CANONICAL_AI_PROVIDER_CHAIN)[number];

export const CANONICAL_AI_PROVIDER_LABEL_BY_NAME: Readonly<Record<CanonicalAiProvider, string>> = {
  gemini: "Gemini",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  groq: "Groq",
  deepseek: "DeepSeek",
  anthropic: "Claude/Anthropic",
};

export const CANONICAL_AI_PROVIDER_LABELS = CANONICAL_AI_PROVIDER_CHAIN.map(
  (provider) => CANONICAL_AI_PROVIDER_LABEL_BY_NAME[provider],
);

export const CANONICAL_AI_PROVIDER_DISPLAY = CANONICAL_AI_PROVIDER_LABELS.join(" → ");

export const CANONICAL_AI_PROVIDER_ENV: Readonly<Record<CanonicalAiProvider, string>> = {
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  openai: "OPENAI_API_KEY",
  groq: "GROQ_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

export const CANONICAL_AI_PROVIDER_RANK: Readonly<Record<CanonicalAiProvider, number>> = {
  gemini: 1,
  openrouter: 2,
  openai: 3,
  groq: 4,
  deepseek: 5,
  anthropic: 6,
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
