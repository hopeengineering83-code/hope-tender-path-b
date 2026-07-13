// AI provider policy — thin, registry-derived helpers.
//
// This module no longer declares its own provider order. Everything derives
// from the authoritative registry (lib/ai-provider-registry.ts) so there is a
// single source of truth for the canonical automatic provider order.

import {
  CANONICAL_AI_PROVIDER_ORDER,
  getProviderRegistry,
  providerDisplayName,
  providerRank,
  isProviderConfigured,
  CANONICAL_AI_PROVIDER_CHAIN_DISPLAY,
  CANONICAL_AI_PROVIDER_DISPLAY_NAMES,
  type AiProviderName,
} from "./ai-provider-registry";

export const CANONICAL_AI_PROVIDER_CHAIN = CANONICAL_AI_PROVIDER_ORDER;

export type CanonicalAiProvider = AiProviderName;

export const CANONICAL_AI_PROVIDER_LABEL_BY_NAME: Readonly<Record<CanonicalAiProvider, string>> =
  Object.fromEntries(
    CANONICAL_AI_PROVIDER_ORDER.map((p) => [p, providerDisplayName(p)]),
  ) as Record<CanonicalAiProvider, string>;

export const CANONICAL_AI_PROVIDER_LABELS = CANONICAL_AI_PROVIDER_DISPLAY_NAMES;

export const CANONICAL_AI_PROVIDER_DISPLAY = CANONICAL_AI_PROVIDER_CHAIN_DISPLAY;

export const CANONICAL_AI_PROVIDER_ENV_LIST = CANONICAL_AI_PROVIDER_CHAIN
  .map((provider) => getProviderRegistry()[provider].env.apiKey)
  .join(", ");

export const CANONICAL_AI_PROVIDER_ENV: Readonly<Record<CanonicalAiProvider, string>> =
  Object.fromEntries(
    CANONICAL_AI_PROVIDER_ORDER.map((p) => [p, getProviderRegistry()[p].env.apiKey]),
  ) as Record<CanonicalAiProvider, string>;

export const CANONICAL_AI_PROVIDER_RANK: Readonly<Record<CanonicalAiProvider, number>> =
  Object.fromEntries(
    CANONICAL_AI_PROVIDER_ORDER.map((p) => [p, providerRank(p)]),
  ) as Record<CanonicalAiProvider, number>;

export function configuredCanonicalProviders(env: NodeJS.ProcessEnv = process.env): CanonicalAiProvider[] {
  return CANONICAL_AI_PROVIDER_CHAIN.filter((provider) => isProviderConfigured(provider, env));
}

export function preferredCanonicalProvider(env: NodeJS.ProcessEnv = process.env): CanonicalAiProvider | null {
  return configuredCanonicalProviders(env)[0] ?? null;
}

export function canonicalProviderLabel(provider: CanonicalAiProvider): string {
  return providerDisplayName(provider);
}
