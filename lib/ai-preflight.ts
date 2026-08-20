/**
 * Provider capability preflight — MODEL-AWARE.
 *
 * Before sending a large payload, this estimates its input-token size and skips
 * providers whose resolved model cannot handle it, preventing 413s and
 * context-window overflows without consuming an attempt-budget slot.
 *
 * The limits come from the EXACT provider + EXACT resolved model, via
 * lib/ai-model-profiles.ts. The previous version kept one context limit per
 * PROVIDER, fixed to whichever model was the registry default when the table
 * was written, so any operator who set a model env var got judged against a
 * model they were no longer using — and a limit copied from a retired snapshot
 * kept being applied to its replacement. The model string used here is read
 * through the same registry accessor the adapter uses, so preflight and the
 * outbound request always describe the same model.
 *
 * Token estimation uses a conservative 4-chars-per-token heuristic.
 * Overestimating size leads to a safe skip; underestimating leads to a 413.
 */

import { type AiProviderName, type AiUseCase } from "./ai-provider-registry";
import { resolveActiveModelProfile, type ModelCapabilityProfile } from "./ai-model-profiles";

// Rough chars-per-token ratio for English text. Conservative (lower = more
// tokens estimated = safer skips).
const CHARS_PER_TOKEN = 4;

// Fraction of the context window left free for the response. Input is checked
// against the remainder.
const INPUT_CONTEXT_FRACTION = 0.8;

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
  /** The exact model the limits were resolved for — never a provider default. */
  model: string;
  /** Full resolved profile, so callers can report WHY a provider was skipped. */
  profile: ModelCapabilityProfile;
  safeMessage: string;
};

/**
 * Check whether a provider's RESOLVED MODEL can handle a given prompt payload.
 *
 * Eligibility is decided against the model that will actually be sent — read
 * through the registry accessor the adapter uses — so a model override changes
 * the preflight verdict along with the request.
 */
export function preflightProvider(
  provider: AiProviderName,
  prompt: string,
  opts?: { systemPrompt?: string; useCase?: AiUseCase; env?: NodeJS.ProcessEnv },
): ProviderPreflightResult {
  const useCase = opts?.useCase ?? "proposal";
  const profile = resolveActiveModelProfile(provider, useCase, opts?.env ?? process.env);
  const estimatedTokens = estimateTotalInputTokens(prompt, opts?.systemPrompt);
  const contextLimit = profile.contextTokens;

  // Context-window check — leave a fifth of the window free for the response.
  const effectiveLimit = Math.floor(contextLimit * INPUT_CONTEXT_FRACTION);
  if (estimatedTokens > effectiveLimit) {
    return {
      provider,
      eligible: false,
      reason: "CONTEXT_OVERFLOW",
      estimatedTokens,
      contextLimit,
      model: profile.model,
      profile,
      safeMessage: `Prompt exceeds the ${profile.model} context window on ${provider} (${estimatedTokens} > ${effectiveLimit} tokens).`,
    };
  }

  // Free-tier tokens-per-minute ceiling, where the model's profile carries one.
  // Groq is the case that matters: its free tier caps throughput far below the
  // context window, so a prompt that fits the window still returns 413. The
  // limit now travels with the MODEL, because Groq's per-minute allowance
  // differs between the 70B and 8B models — a single provider-wide number
  // skipped the small model on payloads it could have served.
  if (profile.freeTierTpmLimit !== null && estimatedTokens > profile.freeTierTpmLimit) {
    return {
      provider,
      eligible: false,
      reason: "TPM_LIMIT",
      estimatedTokens,
      contextLimit,
      model: profile.model,
      profile,
      safeMessage: `Prompt exceeds the free-tier per-minute token limit for ${profile.model} on ${provider} (${estimatedTokens} > ${profile.freeTierTpmLimit} tokens).`,
    };
  }

  return {
    provider,
    eligible: true,
    reason: "OK",
    estimatedTokens,
    contextLimit,
    model: profile.model,
    profile,
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
