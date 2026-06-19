// Ordered by the canonical runtime fallback chain (mirrors lib/ai.ts
// CANONICAL_PROVIDER_CHAIN and lib/ai-provider-policy.ts
// CANONICAL_AI_PROVIDER_CHAIN). Anthropic is intentionally LAST so Anthropic
// rate limits do not block the app when earlier providers are available.
// Reorder only via an explicit product decision — see docs/ai-provider-order.md.
export const AI_PROVIDER_ORDER = [
  { provider: "Mistral", envName: "MISTRAL_API_KEY", order: 1 },
  { provider: "Groq", envName: "GROQ_API_KEY", order: 2 },
  { provider: "OpenRouter", envName: "OPENROUTER_API_KEY", order: 3 },
  { provider: "Gemini", envName: "GEMINI_API_KEY", order: 4 },
  { provider: "OpenAI", envName: "OPENAI_API_KEY", order: 5 },
  { provider: "Together", envName: "TOGETHER_API_KEY", order: 6 },
  { provider: "DeepSeek", envName: "DEEPSEEK_API_KEY", order: 7 },
  { provider: "Anthropic", envName: "ANTHROPIC_API_KEY", order: 8 },
] as const;

export type SafeProviderStatus = {
  provider: string;
  envName: string;
  order: number;
  configured: boolean;
};

export function getSafeProviderStatus(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): SafeProviderStatus[] {
  return AI_PROVIDER_ORDER.map((item) => ({
    provider: item.provider,
    envName: item.envName,
    order: item.order,
    configured: Boolean(env[item.envName]),
  }));
}

export function hasAnyProviderConfigured(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): boolean {
  return getSafeProviderStatus(env).some((item) => item.configured);
}
