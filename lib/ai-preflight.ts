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
 * The smallest output budget that can actually CARRY this use case's result.
 *
 * THE DEFECT THIS FIXES, read off the owner's durable AiJob 4a678bf3.
 * ------------------------------------------------------------------
 * A single 512-token floor decided eligibility for every use case. Groq's
 * free tier spends ONE 8,000-token-per-minute budget on input and output
 * together, so a 6,265-token analysis chunk left 1,335 tokens for the answer.
 * 1,335 clears a 512 floor, so preflight called the request viable. The run
 * recorded:
 *
 *   groq: Groq openai/gpt-oss-120b hit the output token budget before
 *         producing any content (max_tokens=1335) — raise the budget
 *
 * Zero content. `gpt-oss-120b` is a reasoning model: it spends budget thinking
 * before it emits anything, and a structured extraction has to emit a whole
 * JSON object of requirements. "Enough room to say something" is not one
 * number — it depends on what the caller asked for. Splitting the source
 * smaller does not help either, because every chunk repeats the ~4,200-token
 * prompt template inside the same per-minute budget.
 *
 * So the floor is per use case, and an analysis chunk that cannot be answered
 * is refused BEFORE dispatch, leaving the attempt for a provider that can
 * answer it — which is what the fallback chain is for.
 *
 * The values are ordered by what the response has to contain, and 2,048 for
 * extraction is set above the 1,335 that was measured producing nothing.
 */
export function minUsefulOutputTokens(useCase: AiUseCase): number {
  switch (useCase) {
    // A structured JSON object: requirements, client details, evaluation
    // criteria, submission rules, each with source traceability.
    case "extraction":
      return 2_048;
    // Prose long enough to be a proposal section rather than a stub.
    case "proposal":
      return 1_024;
    // Short verdicts and classifications answer inside the base floor.
    default:
      return MIN_USEFUL_OUTPUT_TOKENS;
  }
}

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
  const contextSafetyMargin = Math.max(128, Math.ceil(contextLimit * SAFETY_MARGIN_FRACTION));
  const minOutputTokens = minUsefulOutputTokens(useCase);

  // A request is viable only if the complete input, a useful response, and a
  // safety margin fit. Previously preflight checked input alone, while the
  // adapter additionally reserved 3–4K output tokens; Groq therefore received
  // known-over-limit requests despite a green preflight.
  if (estimatedTokens + minOutputTokens + contextSafetyMargin > contextLimit) {
    return {
      provider,
      eligible: false,
      reason: "CONTEXT_OVERFLOW",
      estimatedTokens,
      contextLimit,
      model: profile.model,
      profile,
      safeMessage: `Prompt exceeds the configured model context budget (${estimatedTokens} input tokens).`,
      maxOutputTokens: 0,
    };
  }

  // Preserve a separate throughput verdict: a model can have ample context
  // while its provider plan rejects input + reserved output in one TPM window.
  if (
    profile.freeTierTpmLimit !== null && estimatedTokens > profile.freeTierTpmLimit
    || profile.freeTierTpmLimit !== null
      && estimatedTokens + minOutputTokens
        + Math.max(128, Math.ceil(profile.freeTierTpmLimit * SAFETY_MARGIN_FRACTION)) > profile.freeTierTpmLimit
  ) {
    return {
      provider,
      eligible: false,
      reason: "TPM_LIMIT",
      estimatedTokens,
      contextLimit,
      model: profile.model,
      profile,
      safeMessage: `Prompt exceeds the configured provider throughput budget (${estimatedTokens} input tokens).`,
      maxOutputTokens: 0,
    };
  }

  const requestLimit = profile.freeTierTpmLimit === null
    ? contextLimit
    : Math.min(contextLimit, profile.freeTierTpmLimit);
  const safetyMargin = Math.max(128, Math.ceil(requestLimit * SAFETY_MARGIN_FRACTION));
  const availableOutputTokens = requestLimit - estimatedTokens - safetyMargin;

  return {
    provider,
    eligible: true,
    reason: "OK",
    estimatedTokens,
    contextLimit,
    model: profile.model,
    profile,
    safeMessage: "OK",
    maxOutputTokens: Math.max(minOutputTokens, Math.min(requestedOutputTokens, availableOutputTokens)),
  };
}

/**
 * The largest input this provider+model will accept for a use case.
 *
 * WHY THIS IS EXPORTED, and what it is for.
 * -----------------------------------------
 * A capability probe sends a tiny fixed payload. Passing it proves the key,
 * the route and the model's structured-output behaviour -- it does not prove
 * that a REAL workload fits, and the two answers can differ:
 *
 *   Groq openai/gpt-oss-120b passed the analysis probe twice on 2026-09-14
 *   and was reported "usable for AI Analyze". The owner's real AI Analyze
 *   then recorded, durably:
 *     "groq: Prompt exceeds the configured provider throughput budget
 *      (7242 input tokens)."
 *   Groq does not even appear in that job's `tried:` list. It was skipped by
 *   preflight before contact, because 7242 input + 512 minimum output + a
 *   400-token margin is 8154 against an 8000 TPM ceiling. The skip is
 *   CORRECT. What was wrong was telling the owner the provider could run
 *   AI Analyze.
 *
 * The ceiling is computed from the same profile, the same constants and the
 * same margins preflightProvider uses, so a diagnostic and the real run can
 * never drift apart on this number.
 */
export function maxAcceptableInputTokens(
  provider: AiProviderName,
  useCase: AiUseCase,
  env?: NodeJS.ProcessEnv,
  modelOverride?: string,
): { tokens: number; model: string; limitedBy: "context" | "throughput" } {
  const profile = modelOverride
    ? resolveModelProfile(provider, modelOverride)
    : resolveActiveModelProfile(provider, useCase, env ?? process.env);
  // The SAME per-use-case floor preflightProvider applies. Reported ceilings
  // and real verdicts drifting apart is the defect this whole function exists
  // to prevent; a shared constant that one side has since outgrown would
  // reintroduce it quietly.
  const minOutputTokens = minUsefulOutputTokens(useCase);
  const contextCeiling = profile.contextTokens
    - minOutputTokens
    - Math.max(128, Math.ceil(profile.contextTokens * SAFETY_MARGIN_FRACTION));
  if (profile.freeTierTpmLimit === null) {
    return { tokens: Math.max(0, contextCeiling), model: profile.model, limitedBy: "context" };
  }
  const throughputCeiling = profile.freeTierTpmLimit
    - minOutputTokens
    - Math.max(128, Math.ceil(profile.freeTierTpmLimit * SAFETY_MARGIN_FRACTION));
  return throughputCeiling < contextCeiling
    ? { tokens: Math.max(0, throughputCeiling), model: profile.model, limitedBy: "throughput" }
    : { tokens: Math.max(0, contextCeiling), model: profile.model, limitedBy: "context" };
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
