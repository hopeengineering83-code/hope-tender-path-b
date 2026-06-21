// Ordered by the canonical runtime fallback chain, generated DIRECTLY from the
// authoritative registry (lib/ai-provider-registry.ts) so there is a single
// source of truth. Anthropic is intentionally LAST so Anthropic rate limits do
// not block the app when earlier providers are available.
// Reorder only via the registry — see docs/ai-provider-order.md.
import { getCanonicalProviderEntries } from "../ai-provider-registry";

export const AI_PROVIDER_ORDER = getCanonicalProviderEntries().map((entry) => ({
  provider: entry.displayName,
  envName: entry.env.apiKey,
  order: entry.rank,
}));

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
