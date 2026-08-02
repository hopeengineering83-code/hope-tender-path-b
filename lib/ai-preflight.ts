/**
 * Provider capability preflight.
 *
 * Before sending a large matching/analysis payload to a provider, this module
 * estimates the input-token / payload size and skips providers that cannot
 * handle the request. This prevents:
 *   - Groq 413 (request too large / TPM limit)
 *   - Cerebras context-window overflow
 *   - Mistral timeout on oversized payloads
 *   - wasting attempt budget on known-ineligible providers
 *
 * The preflight is NON-BLOCKING for the fallback chain: a skipped provider
 * does NOT consume an attempt budget slot (same as cooldown/unconfigured).
 * The chain simply moves to the next eligible provider.
 *
 * Token estimation uses a conservative 4-chars-per-token heuristic (industry
 * standard is ~4 for English text). This is intentionally conservative —
 * overestimating size leads to safe skips, underestimating leads to 413s.
 */

import { getProviderEntry, type AiProviderName, type AiUseCase } from "./ai-provider-registry";

// Conservative per-provider context window limits (input tokens).
// These are the documented limits for the DEFAULT models in the registry.
// When a user overrides the model via env, the limit may differ — we use the
// default-model limit as a safe conservative bound.
const PROVIDER_CONTEXT_LIMITS: Record<AiProviderName, number> = {
  zai: 128_000, // glm-4.7-flash: 128K context
  cerebras: 128_000, // gpt-oss-120b: 128K context
  mistral: 128_000, // mistral-large-latest: 128K context
  groq: 32_000, // llama-3.3-70b-versatile: 32K context (Groq free tier is lower)
  openrouter: 32_000, // varies by :free model; conservative 32K
  gemini: 1_000_000, // gemini-2.5-pro: 1M context
  openai: 128_000, // gpt-4o: 128K context
  together: 128_000, // Llama-3.3-70B: 128K context
  deepseek: 64_000, // deepseek-chat: 64K context
  anthropic: 200_000, // claude-sonnet-4-5: 200K context
};

// Groq free-tier TPM (tokens-per-minute) limit. The free tier is 30K TPM for
// most models. We use a conservative 28K to leave headroom for the response.
const GROQ_FREE_TPM_LIMIT = 28_000;

// Rough chars-per-token ratio for English text. Conservative (lower = more
// tokens estimated = safer skips).
const CHARS_PER_TOKEN = 4;

/**
 * Estimate the input token count for a prompt. Conservative 4-chars-per-token.
 */
export function estimateInputTokens(prompt: string): number {
  return Math.ceil(prompt.length / CHARS_PER_TOKEN);
}

/**
 * Estimate the input token count for a prompt + system prompt combination.
 */
export function estimateTotalInputTokens(prompt: string, systemPrompt?: string): number {
  const promptTokens = estimateInputTokens(prompt);
  const systemTokens = systemPrompt ? estimateInputTokens(systemPrompt) : 0;
  return promptTokens + systemTokens;
}

export type ProviderPreflightResult = {
  provider: AiProviderName;
  eligible: boolean;
  reason: "OK" | "CONTEXT_OVERFLOW" | "TPM_LIMIT" | "UNKNOWN_PROVIDER";
  estimatedTokens: number;
  contextLimit: number;
  safeMessage: string;
};

/**
 * Check whether a provider can handle a given prompt payload.
 * Returns eligible=true when the provider's context window can accommodate
 * the estimated input tokens. Returns eligible=false with a safe reason when
 * the payload would overflow.
 *
 * For Groq specifically, also checks the TPM limit — Groq free-tier rejects
 * requests that exceed 30K TPM with HTTP 413.
 */
export function preflightProvider(
  provider: AiProviderName,
  prompt: string,
  opts?: { systemPrompt?: string; useCase?: AiUseCase },
): ProviderPreflightResult {
  const entry = getProviderEntry(provider);
  const estimatedTokens = estimateTotalInputTokens(prompt, opts?.systemPrompt);
  const contextLimit = PROVIDER_CONTEXT_LIMITS[provider] ?? 32_000;

  // Context-window check — if the estimated input exceeds the provider's
  // context window, skip it. Add 20% headroom for the response.
  const effectiveLimit = Math.floor(contextLimit * 0.8);
  if (estimatedTokens > effectiveLimit) {
    return {
      provider,
      eligible: false,
      reason: "CONTEXT_OVERFLOW",
      estimatedTokens,
      contextLimit,
      safeMessage: `Prompt exceeds ${provider} context window (${estimatedTokens} > ${effectiveLimit} tokens).`,
    };
  }

  // Groq TPM check — Groq free-tier has a 30K TPM limit. If the estimated
  // input alone exceeds 28K tokens, the request will 413. Skip Groq.
  if (provider === "groq" && estimatedTokens > GROQ_FREE_TPM_LIMIT) {
    return {
      provider,
      eligible: false,
      reason: "TPM_LIMIT",
      estimatedTokens,
      contextLimit,
      safeMessage: `Prompt exceeds Groq free-tier TPM limit (${estimatedTokens} > ${GROQ_FREE_TPM_LIMIT} tokens).`,
    };
  }

  return {
    provider,
    eligible: true,
    reason: "OK",
    estimatedTokens,
    contextLimit,
    safeMessage: "OK",
  };
}

/**
 * Batch preflight: check all providers in canonical order and return the
 * eligible list plus the skip reasons. Callers use this to filter the chain
 * BEFORE iterating, so oversized providers never consume an attempt.
 */
export function preflightChain(
  chain: readonly AiProviderName[],
  prompt: string,
  opts?: { systemPrompt?: string; useCase?: AiUseCase },
): {
  eligible: AiProviderName[];
  skipped: Array<{ provider: AiProviderName; reason: ProviderPreflightResult["reason"]; safeMessage: string }>;
} {
  const eligible: AiProviderName[] = [];
  const skipped: Array<{ provider: AiProviderName; reason: ProviderPreflightResult["reason"]; safeMessage: string }> = [];
  for (const provider of chain) {
    const result = preflightProvider(provider, prompt, opts);
    if (result.eligible) {
      eligible.push(provider);
    } else {
      skipped.push({ provider, reason: result.reason, safeMessage: result.safeMessage });
    }
  }
  return { eligible, skipped };
}
