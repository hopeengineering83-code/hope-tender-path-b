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
    // OpenRouter is a router, not a model vendor. Its identities are
    // `vendor/model[:variant]`, and the model behind one of them is the same
    // model the direct providers above describe — so the profile is resolved
    // by routing the model half back through those family rules rather than by
    // listing anything here. See resolveOpenRouterProfile.
    //
    // This list previously held exactly one rule, matching `:free`. Everything
    // else — every paid model, and every free one written without the suffix —
    // fell through to the 8K conservative profile, so an operator who
    // configured OpenRouter with a 200K-context model got a provider that was
    // skipped for any real tender prompt, permanently, with the honest-looking
    // message "Prompt exceeds the configured model context budget". The
    // configuration, not the account, was what made the provider impossible.
    //
    // Leaving one `:free`-shaped rule as the only recognised OpenRouter model
    // also encoded, as capability data, the free-only policy the provider
    // contract forbids. A ceiling for `:free` variants is kept below, because
    // OpenRouter genuinely does reduce context on them — but it is a ceiling on
    // the real family limit, not a substitute for knowing it.
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

/**
 * The context ceiling OpenRouter applies to its `:free` variants.
 *
 * A free variant of a 200K-context model is not a 200K-context endpoint, so the
 * real family limit is capped rather than trusted. Any other variant
 * (`:nitro`, `:beta`, `:extended`, none at all) is the vendor's own endpoint
 * and keeps the family's limits.
 */
const OPENROUTER_FREE_VARIANT_CONTEXT_CEILING = 32_768;
const OPENROUTER_FREE_VARIANT_OUTPUT_CEILING = 4_096;

/**
 * OpenRouter vendor prefixes whose name does not itself identify the family
 * table that describes them.
 *
 * This deliberately holds NO capability numbers — only "the Llama models
 * OpenRouter publishes under `meta-llama` are the family `together` describes".
 * A second table of limits would drift out of step with the first, which is the
 * failure this module was written to end; a table of names cannot, because
 * changing a limit above changes what this resolves to as well.
 *
 * Without it the cross-vendor scan answers with whichever rule matches first,
 * and a provider's rule for its OWN deployment of a model can be wrong for the
 * same model elsewhere: Groq's `^llama-3` entry carries Groq's 8K deployment
 * limit, and it was capping OpenRouter's Llama 3.3 70B — a 131K model — at 8K.
 */
const OPENROUTER_VENDOR_ALIASES: Record<string, AiProviderName> = {
  google: "gemini",
  metallama: "together",
};

/**
 * Resolve an OpenRouter identity through the family rules of the vendor it
 * routes to.
 *
 * `anthropic/claude-3.5-sonnet` is Anthropic's model reached by a different
 * road; describing it as an unknown 8K model is simply wrong, and wrong in the
 * direction that silently removes a working provider from the chain. The model
 * half is matched against every provider's families rather than through a
 * vendor-name lookup table, so a new vendor prefix needs no maintenance here
 * and cannot drift out of step with the numbers above.
 *
 * Genuinely unrecognised models still fall through to the conservative
 * profile, which remains the safe direction.
 */
function resolveOpenRouterProfile(model: string): { rule: FamilyRule; free: boolean } | null {
  const normalized = (model ?? "").trim().toLowerCase();
  if (!normalized) return null;

  const [identity, ...variantParts] = normalized.split(":");
  const free = variantParts.join(":") === "free";
  // Drop the vendor prefix: `anthropic/claude-3` -> `claude-3`. Groq's own
  // rules include a slashed family (`openai/gpt-oss`), so the un-stripped form
  // is tried first and the stripped form only as a fallback.
  const candidates = [identity, identity.slice(identity.indexOf("/") + 1)];

  // The vendor named in the identity is consulted first.
  //
  // Without this, a scan in table order lets one provider's rule answer for
  // another's model: Groq carries a rule for the DeepSeek distillation it
  // hosts, at Groq's limits, and it matched `deepseek/deepseek-chat` before
  // DeepSeek's own rule was reached — capping a 64K model at 32K. The vendor
  // prefix is information already in the model string, so preferring it needs
  // no table to maintain; `mistralai` matches `mistral`, `z-ai` matches `zai`,
  // and a prefix with no counterpart (`google`, `meta-llama`) simply falls
  // through to the scan, where the model name itself finds its family.
  const vendorPrefix = identity.includes("/")
    ? identity.slice(0, identity.indexOf("/")).replace(/[^a-z0-9]/g, "")
    : "";
  const vendorNames = Object.keys(FAMILY_RULES).filter((name) => name !== "openrouter");
  const aliased = OPENROUTER_VENDOR_ALIASES[vendorPrefix];
  const preferred = aliased
    ? [aliased as string]
    : vendorPrefix
      ? vendorNames.filter((name) => vendorPrefix.includes(name) || name.includes(vendorPrefix))
      : [];
  const order = [...preferred, ...vendorNames.filter((name) => !preferred.includes(name))];

  // Vendor first, then both spellings of the model. The nesting matters: the
  // preferred vendor's rules are anchored at the model name (`^deepseek-chat`)
  // and so only match the stripped spelling, while another vendor's rule can
  // match the un-stripped one (`^deepseek` against `deepseek/deepseek-chat`).
  // Trying every vendor on the first spelling before trying the second handed
  // the answer to whichever vendor happened to be less specific.
  for (const vendor of order) {
    for (const candidate of candidates) {
      if (!candidate) continue;
      for (const rule of FAMILY_RULES[vendor as AiProviderName] ?? []) {
        if (rule.pattern.test(candidate)) return { rule, free };
      }
    }
  }
  return null;
}

/** Resolve the capability profile for an EXACT provider + model pair. */
export function resolveModelProfile(
  provider: AiProviderName,
  model: string,
): ModelCapabilityProfile {
  const normalized = (model ?? "").trim().toLowerCase();

  if (provider === "openrouter") {
    const routed = resolveOpenRouterProfile(model);
    if (routed) {
      return {
        provider,
        model,
        contextTokens: routed.free
          ? Math.min(routed.rule.contextTokens, OPENROUTER_FREE_VARIANT_CONTEXT_CEILING)
          : routed.rule.contextTokens,
        maxOutputTokens: routed.free
          ? Math.min(routed.rule.maxOutputTokens, OPENROUTER_FREE_VARIANT_OUTPUT_CEILING)
          : routed.rule.maxOutputTokens,
        // A vendor's own free-tier throughput ceiling does not apply to the
        // same model reached through OpenRouter, which meters separately.
        freeTierTpmLimit: null,
        source: "family",
      };
    }
  }

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
  return applyOperatorTpmLimit(
    resolveModelProfile(provider, getProviderModel(provider, useCase, env)),
    env,
  );
}

/**
 * Let an operator state the throughput their plan actually has.
 *
 * The TPM ceilings above are FREE-tier facts, and they were applied to every
 * key unconditionally. A real tender prompt is far larger than Groq's free
 * 6–8K-per-minute window, so preflight skipped Groq for proposal generation on
 * every run — including for an operator paying for a plan with hundreds of
 * thousands of tokens per minute. The provider was made impossible by the
 * app's assumption about the account, not by the account.
 *
 * `<PROVIDER>_TPM_LIMIT` states the real ceiling; `0` means the plan has no
 * ceiling tight enough to matter and removes the check for that provider. This
 * changes nothing unless an operator sets it, so the conservative free-tier
 * behaviour remains the default, and it is not a way to hide a rejection: if
 * the stated limit is wrong the provider answers 429 and the ordinary
 * classification and failover handle it exactly as before.
 *
 * Nothing here reorders providers or excludes any of them.
 */
export function applyOperatorTpmLimit(
  profile: ModelCapabilityProfile,
  env: NodeJS.ProcessEnv = process.env,
): ModelCapabilityProfile {
  const raw = env[`${profile.provider.toUpperCase()}_TPM_LIMIT`];
  if (raw === undefined || String(raw).trim() === "") return profile;
  const parsed = Number(String(raw).trim());
  if (!Number.isFinite(parsed) || parsed < 0) return profile;
  return { ...profile, freeTierTpmLimit: parsed === 0 ? null : Math.floor(parsed) };
}
