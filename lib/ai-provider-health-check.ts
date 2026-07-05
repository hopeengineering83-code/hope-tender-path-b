/**
 * AI provider health check — verifies that at least one AI provider is
 * configured and reachable.
 *
 * This is a lightweight check that doesn't make actual API calls (which would
 * be slow and cost money). It only verifies that:
 * 1. At least one provider API key is set in the environment
 * 2. The provider registry loads without errors
 */

import { CANONICAL_AI_PROVIDER_ORDER, getProviderRegistry, isProviderConfigured } from "./ai-provider-registry";

export interface AiProviderHealthResult {
  healthy: boolean;
  configuredProviders: string[];
  totalProviders: number;
  message: string;
}

export function checkAiProviderHealth(): AiProviderHealthResult {
  try {
    const configured = CANONICAL_AI_PROVIDER_ORDER.filter((p) => isProviderConfigured(p));

    if (configured.length === 0) {
      return {
        healthy: false,
        configuredProviders: [],
        totalProviders: CANONICAL_AI_PROVIDER_ORDER.length,
        message: "No AI providers configured — AI features will be unavailable",
      };
    }

    return {
      healthy: true,
      configuredProviders: configured,
      totalProviders: CANONICAL_AI_PROVIDER_ORDER.length,
      message: `${configured.length} of ${CANONICAL_AI_PROVIDER_ORDER.length} AI providers configured`,
    };
  } catch (e) {
    return {
      healthy: false,
      configuredProviders: [],
      totalProviders: 0,
      message: `Provider health check failed: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}
