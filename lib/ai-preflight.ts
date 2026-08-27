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

import { getProviderOutputCap, type AiProviderName, type AiUseCase } from "./ai-provider-registry";
import { resolveActiveModelProfile, resolveModelProfile, type ModelCapabilityProfile } from "./ai-model-profiles";

// Rough chars-per-token ratio for English text. Conservative (lower = more
// tokens estimated = safer skips).
const CHARS_PER_TOKEN = 4;

// Fraction of the context window left free for the response. Input is checked
// against the remainder.
const SAFETY_MARGIN_FRACTION = 0.05;
const MIN_USEFUL_OUTPUT_TOKENS = 512;

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
  /** Output allowance that keeps input + output + margin inside all limits. */
  maxOutputTokens: number;
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
  opts?: { systemPrompt?: string; useCase?: AiUseCase; env?: NodeJS.ProcessEnv; modelOverride?: string },
): ProviderPreflightResult {
  const useCase = opts?.useCase ?? "proposal";
  const profile = opts?.modelOverride
    ? resolveModelProfile(provider, opts.modelOverride)
    : resolveActiveModelProfile(provider, useCase, opts?.env ?? process.env);
  const estimatedTokens = estimateTotalInputTokens(prompt, opts?.systemPrompt);
  const contextLimit = profile.contextTokens;
  const requestedOutputTokens = Math.min(profile.maxOutputTokens, getProviderOutputCap(provider, useCase));
  const requestLimit = profile.freeTierTpmLimit === null
    ? contextLimit
    : Math.min(contextLimit, profile.freeTierTpmLimit);
  const safetyMargin = Math.max(128, Math.ceil(requestLimit * SAFETY_MARGIN_FRACTION));
  const availableOutputTokens = requestLimit - estimatedTokens - safetyMargin;

  // A request is viable only if the complete input, a useful response, and a
  // safety margin fit. Previously preflight checked input alone, while the
  // adapter additionally reserved 3–4K output tokens; Groq therefore received
  // known-over-limit requests despite a green preflight.
  if (availableOutputTokens < MIN_USEFUL_OUTPUT_TOKENS) {
    const reason = profile.freeTierTpmLimit !== null && requestLimit === profile.freeTierTpmLimit
      ? "TPM_LIMIT" as const
      : "CONTEXT_OVERFLOW" as const;
    return {
      provider,
      eligible: false,
      reason,
      estimatedTokens,
      contextLimit,
      model: profile.model,
      profile,
      safeMessage: `Request cannot fit ${profile.model} on ${provider}: input ${estimatedTokens} + minimum output ${MIN_USEFUL_OUTPUT_TOKENS} + safety ${safetyMargin} exceeds ${requestLimit} tokens.`,
      maxOutputTokens: 0,
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
    maxOutputTokens: Math.max(MIN_USEFUL_OUTPUT_TOKENS, Math.min(requestedOutputTokens, availableOutputTokens)),
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
