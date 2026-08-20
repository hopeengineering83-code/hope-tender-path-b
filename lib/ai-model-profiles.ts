// ─── Model-aware capability profiles ─────────────────────────────────────────
//
// Preflight used to answer "will this prompt fit?" from a per-PROVIDER table:
// one context limit per provider, taken from whichever model happened to be the
// registry default when the table was written. That is wrong in both directions
// the moment an operator sets a model env var. Configure Gemini to a flash model
// and the app still believed it had the 1M-token window of the model it no
// longer uses; configure Groq to a larger-context model and the app skipped it
// for payloads it could handle perfectly well. Worse, the numbers outlived the
// models: a limit copied from a retired snapshot keeps being applied to its
// replacement.
//
// A profile is therefore resolved from the EXACT provider AND the EXACT model
// string that will be sent on the wire — the same value getProviderModel()
// returns for the same use case, so preflight and the request cannot disagree.
//
// Matching is by model FAMILY PATTERN, never by an enumerated list of model
// names. The distinction matters: an allowlist rejects tomorrow's model as
// unknown, while a family pattern recognises it and applies the family's limits.
// Anything genuinely unrecognised resolves to a deliberately small conservative
// profile — the safe direction, since underestimating capacity costs one skipped
// provider while overestimating costs a hard context-overflow failure.

import { getProviderModel, type AiProviderName, type AiUseCase } from "./ai-provider-registry";

export type ModelCapabilityProfile = {
  provider: AiProviderName;
  model: string;
  /** Maximum input context in tokens. */
  contextTokens: number;
  /** Maximum output tokens the model will produce in one response. */
  maxOutputTokens: number;
  /**
   * Free-tier tokens-per-minute ceiling, when the provider enforces one that is
   * tighter than the context window. null when TPM is not the binding limit.
   */
  freeTierTpmLimit: number | null;
  /** How the profile was determined — "family" (pattern hit) or "conservative". */
  source: "family" | "conservative";
};

type FamilyRule = {
  pattern: RegExp;
  contextTokens: number;
  maxOutputTokens: number;
  freeTierTpmLimit?: number;
};

// Per-provider family rules, most specific first. Every entry is a FAMILY, so a
// new point release inside the family inherits the right limits automatically.
const FAMILY_RULES: Partial<Record<AiProviderName, readonly FamilyRule[]>> = {
  gemini: [
    // Flash family — the free tier. 1M input context, 8K output.
    { pattern: /^gemini-[\d.]+-flash/, contextTokens: 1_000_000, maxOutputTokens: 8_192 },
    { pattern: /^gemini-flash/, contextTokens: 1_000_000, maxOutputTokens: 8_192 },
    // Pro family — larger output, paid tier.
    { pattern: /^gemini-[\d.]+-pro/, contextTokens: 1_000_000, maxOutputTokens: 65_536 },
    { pattern: /^gemini-/, contextTokens: 32_768, maxOutputTokens: 8_192 },
  ],
  groq: [
    // Groq's free tier binds on tokens-per-minute long before context does, so
    // the TPM ceiling is carried on the profile and checked alongside context.
    { pattern: /^llama-3\.1-8b/, contextTokens: 131_072, maxOutputTokens: 8_192, freeTierTpmLimit: 6_000 },
    { pattern: /^llama-3/, contextTokens: 8_192, maxOutputTokens: 8_192, freeTierTpmLimit: 6_000 },
    { pattern: /^openai\/gpt-oss/, contextTokens: 131_072, maxOutputTokens: 32_768, freeTierTpmLimit: 8_000 },
    { pattern: /^(qwen|gemma|mixtral|deepseek)/, contextTokens: 32_768, maxOutputTokens: 8_192, freeTierTpmLimit: 6_000 },
  ],
  mistral: [
    { pattern: /^mistral-(small|medium)/, contextTokens: 131_072, maxOutputTokens: 8_192 },
    { pattern: /^mistral-large/, contextTokens: 131_072, maxOutputTokens: 8_192 },
    { pattern: /^open-mistral-nemo/, contextTokens: 131_072, maxOutputTokens: 8_192 },
    { pattern: /^ministral-/, contextTokens: 131_072, maxOutputTokens: 8_192 },
    { pattern: /^(codestral|pixtral|magistral)/, contextTokens: 131_072, maxOutputTokens: 8_192 },
  ],
  zai: [
    { pattern: /^glm-4[.\d]*-flash/, contextTokens: 128_000, maxOutputTokens: 16_384 },
    { pattern: /^glm-4[.\d]*v/, contextTokens: 64_000, maxOutputTokens: 8_192 },
    { pattern: /^glm-/, contextTokens: 128_000, maxOutputTokens: 8_192 },
  ],
  openrouter: [
    // Model identity on OpenRouter is `vendor/model:free`; limits vary widely
    // by whatever the operator selected, so stay conservative on purpose.
    { pattern: /:free$/, contextTokens: 32_768, maxOutputTokens: 4_096 },
  ],
  cerebras: [
    { pattern: /^(gpt-oss|llama)/, contextTokens: 128_000, maxOutputTokens: 32_768 },
  ],
  openai: [
    { pattern: /^gpt-4o/, contextTokens: 128_000, maxOutputTokens: 16_384 },
    { pattern: /^gpt-4\.1/, contextTokens: 1_000_000, maxOutputTokens: 32_768 },
    { pattern: /^(o1|o3|o4)/, contextTokens: 200_000, maxOutputTokens: 100_000 },
  ],
  together: [
    { pattern: /llama-3\.3-70b/i, contextTokens: 131_072, maxOutputTokens: 8_192 },
    { pattern: /llama-3\.1-8b/i, contextTokens: 131_072, maxOutputTokens: 8_192 },
  ],
  deepseek: [
    { pattern: /^deepseek-(chat|reasoner)/, contextTokens: 65_536, maxOutputTokens: 8_192 },
  ],
  anthropic: [
    { pattern: /^claude-(sonnet|opus|haiku)-[45]/, contextTokens: 200_000, maxOutputTokens: 64_000 },
    { pattern: /^claude-3/, contextTokens: 200_000, maxOutputTokens: 8_192 },
  ],
};

// Applied when no family matches. Small on purpose: an unrecognised model that
// is skipped costs one provider in the chain, while an unrecognised model that
// is overestimated costs a failed request and a consumed attempt.
const CONSERVATIVE_PROFILE = { contextTokens: 8_192, maxOutputTokens: 4_096 } as const;

/** Resolve the capability profile for an EXACT provider + model pair. */
export function resolveModelProfile(
  provider: AiProviderName,
  model: string,
): ModelCapabilityProfile {
  const normalized = (model ?? "").trim().toLowerCase();
  const rules = FAMILY_RULES[provider] ?? [];
  for (const rule of rules) {
    if (rule.pattern.test(normalized)) {
      return {
        provider,
        model,
        contextTokens: rule.contextTokens,
        maxOutputTokens: rule.maxOutputTokens,
        freeTierTpmLimit: rule.freeTierTpmLimit ?? null,
        source: "family",
      };
    }
  }
  return {
    provider,
    model,
    contextTokens: CONSERVATIVE_PROFILE.contextTokens,
    maxOutputTokens: CONSERVATIVE_PROFILE.maxOutputTokens,
    freeTierTpmLimit: null,
    source: "conservative",
  };
}

/**
 * Resolve the profile for the model that WILL be used for a given use case —
 * reading the model through the same registry accessor the adapter uses, so
 * preflight can never be judging a different model than the one sent.
 */
export function resolveActiveModelProfile(
  provider: AiProviderName,
  useCase: AiUseCase = "proposal",
  env: NodeJS.ProcessEnv = process.env,
): ModelCapabilityProfile {
  return resolveModelProfile(provider, getProviderModel(provider, useCase, env));
}
