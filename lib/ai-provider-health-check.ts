/**
 * AI provider health — is the AI subsystem actually usable right now?
 *
 * This used to answer "yes" as soon as one API key was present in the
 * environment. Key presence is not capability: an environment with four
 * configured providers and zero working ones reported healthy, and production
 * readiness reported green while every AI Analyze failed. The failure mode was
 * the worst kind — the check was green precisely when someone needed it to be
 * informative.
 *
 * The answer now requires a provider that has passed a REAL capability test in
 * this process (see lib/ai-provider-capability-test.ts), and it distinguishes
 * three states rather than two:
 *
 *   healthy   — at least one provider has verified ANALYSIS capability.
 *               A redundancy rule briefly lived here, requiring two; it was a
 *               cost-policy artefact and the owner's provider directive has no
 *               such requirement. The chain is ten providers deep and falls
 *               through on every failure class, which is where resilience
 *               actually comes from.
 *   degraded  — providers are configured and eligible, but nothing has been
 *               verified yet on this instance. Not a failure: the first real
 *               AI Analyze or an operator diagnostic proves it either way.
 *   unhealthy — nothing in the active chain can be used at all.
 *
 * The check itself stays cheap and makes no outbound calls: it reads the health
 * state that real calls and operator diagnostics have already written.
 */

import {
  getAutomaticProviderOrder,
  providerAutomaticEligibility,
  automaticChainDisplay,
  type AiProviderName,
} from "./ai-provider-registry";
import {
  deriveProviderStatus,
  isProviderAnalysisUsable,
  analysisUsableProviders,
} from "./ai-provider-health";

export interface AiProviderHealthResult {
  healthy: boolean;
  /** Configured and permitted to be contacted by the automatic chain. */
  eligibleProviders: string[];
  /** Passed a real AI Analyze structured-output test in this process. */
  analysisVerifiedProviders: string[];
  /**
   * Currently cooling down from a payment/balance refusal. Nothing is excluded
   * by policy — these are providers that refused at runtime and will be tried
   * again when their cooldown expires.
   */
  billingBlockedProviders: string[];
  configuredProviders: string[];
  totalProviders: number;
  activeChain: string;
  /** "healthy" | "degraded" | "unhealthy" — see the module comment. */
  state: "healthy" | "degraded" | "unhealthy";
  message: string;
}

export function checkAiProviderHealth(): AiProviderHealthResult {
  const activeChain = automaticChainDisplay();
  try {
    const chain = getAutomaticProviderOrder();
    const eligible: AiProviderName[] = [];
    const billingBlocked: AiProviderName[] = [];

    for (const provider of chain) {
      const eligibility = providerAutomaticEligibility(provider);
      if (eligibility.eligible) eligible.push(provider);
      if (deriveProviderStatus(provider) === "BILLING_BLOCKED") billingBlocked.push(provider);
    }

    const verified = analysisUsableProviders();

    if (verified.length >= 1) {
      return {
        healthy: true,
        state: "healthy",
        eligibleProviders: eligible,
        analysisVerifiedProviders: verified,
        billingBlockedProviders: billingBlocked,
        configuredProviders: eligible,
        totalProviders: chain.length,
        activeChain,
        message: `${verified.length} provider(s) verified for AI Analyze: ${verified.join(", ")}.`,
      };
    }

    if (eligible.length === 0) {
      return {
        healthy: false,
        state: "unhealthy",
        eligibleProviders: [],
        analysisVerifiedProviders: [],
        billingBlockedProviders: billingBlocked,
        configuredProviders: [],
        totalProviders: chain.length,
        activeChain,
        message: billingBlocked.length > 0
          ? `No AI provider is currently usable — ${billingBlocked.length} recently refused payment and are cooling down. They will be retried automatically; configure another provider to avoid waiting.`
          : "No AI providers configured — AI features will be unavailable.",
      };
    }

    return {
      healthy: false,
      state: "degraded",
      eligibleProviders: eligible,
      analysisVerifiedProviders: [],
      billingBlockedProviders: billingBlocked,
      configuredProviders: eligible,
      totalProviders: chain.length,
      activeChain,
      message: `${eligible.length} provider(s) configured but none verified on this instance yet — run the provider capability test or the first AI Analyze to confirm.`,
    };
  } catch (e) {
    return {
      healthy: false,
      state: "unhealthy",
      eligibleProviders: [],
      analysisVerifiedProviders: [],
      billingBlockedProviders: [],
      configuredProviders: [],
      totalProviders: 0,
      activeChain,
      message: `Provider health check failed: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}

/** True when at least one provider has runtime-verified analysis capability. */
export function hasRuntimeVerifiedAnalysisProvider(): boolean {
  return analysisUsableProviders().length >= 1;
}

export { isProviderAnalysisUsable };
