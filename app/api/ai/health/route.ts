// GET /api/ai/health
//
// Registry-derived AI provider health snapshot. Every provider entry, the
// fallback-chain string, the preferred provider, and the per-provider model
// are derived from the authoritative registry lib/ai-provider-registry.ts.
// Do NOT hardcode a provider order or fallback-chain string here — the
// registry is the single source of truth.
//
// Security: requires ADMIN or PROPOSAL_MANAGER. The previous unauthenticated
// version exposed provider configuration (key presence, model names, runtime
// status) to any caller — reconnaissance gold. Auth-gated now.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "@/lib/auth";
import {
  restoreProviderHealthBeforeResponse,
  getAllProviderHealth,
  getProviderRuntimeSnapshot,
  isProviderCooledDown,
  type AiProviderName,
} from "@/lib/ai-provider-health";
import {
  getCanonicalProviderEntries,
  preferredConfiguredProviderName,
  getProviderModel,
  CANONICAL_AI_FALLBACK_CHAIN_DISPLAY,
} from "@/lib/ai-provider-registry";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  // H1: AI health route requires ADMIN or PROPOSAL_MANAGER. Was unauthenticated.
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const restore = await restoreProviderHealthBeforeResponse();
  const health = getAllProviderHealth();

  // Build provider entries from the canonical registry — order is
  // Z.ai → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI →
  // Together → DeepSeek → Anthropic.
  const canonicalEntries = getCanonicalProviderEntries();
  const allProviderNames: AiProviderName[] = canonicalEntries.map((e) => e.provider);

  const providerRuntime = Object.fromEntries(
    allProviderNames.map((n) => [n, getProviderRuntimeSnapshot(n)]),
  ) as Record<AiProviderName, ReturnType<typeof getProviderRuntimeSnapshot>>;

  const configuredNames = allProviderNames.filter((n) => {
    const h = health.find((hp) => hp.provider === n);
    return h?.configured;
  });

  const anyConfigured = configuredNames.length > 0;
  const anyRuntimeVerified = configuredNames.some((n) => providerRuntime[n].runtimeVerified);
  const anyHasRecentSuccess = configuredNames.some((n) => providerRuntime[n].lastSuccessAt !== null);
  const allConfiguredCooling = anyConfigured && configuredNames.every((n) => providerRuntime[n].coolingDown);

  const warnings: string[] = [];
  const blockers: string[] = [];
  const preferredProvider = preferredConfiguredProviderName();
  const noAiProviderReady = !anyConfigured || allConfiguredCooling;

  // Compute lastProviderUsed from actual runtime data — the most recently
  // successful configured provider. Lets the UI show which provider actually
  // served the last request without leaking key values.
  const lastProviderUsed = configuredNames
    .map((n) => ({ name: n, at: providerRuntime[n].lastSuccessAt }))
    .filter((x) => x.at !== null)
    .sort((a, b) => new Date(b.at as unknown as string).getTime() - new Date(a.at as unknown as string).getTime())[0]?.name ?? null;

  if (!anyConfigured) {
    blockers.push("No AI providers are configured.");
  }
  if (anyConfigured && !anyHasRecentSuccess) {
    warnings.push("runtime availability is not verified. Set API keys in Vercel environment.");
  }

  const cooling = allProviderNames.filter(isProviderCooledDown);
  if (cooling.length > 0) {
    warnings.push(`Provider(s) in cooldown: ${cooling.join(", ")}.`);
  }

  // Per-provider cards built from the registry. fallbackRank and label come
  // straight from the registry entry so they can never drift from the
  // canonical order. The model is resolved through getProviderModel so
  // Z.ai endpoint/model compatibility is honoured.
  const providers = Object.fromEntries(
    canonicalEntries.map((entry) => {
      const runtime = providerRuntime[entry.provider];
      return [
        entry.provider,
        {
          configured: configuredNames.includes(entry.provider),
          model: getProviderModel(entry.provider, "proposal"),
          analysisModel: getProviderModel(entry.provider, "extraction"),
          fastModel: getProviderModel(entry.provider, "fast"),
          runtime,
          status: runtime.status,
          isAi: true,
          fallbackRank: entry.rank,
          label: entry.displayName,
          envVar: entry.env.apiKey,
          emergencyOnly: entry.emergencyOnly,
        },
      ];
    }),
  );

  return NextResponse.json({
    success: anyConfigured && !allConfiguredCooling,
    ok: anyRuntimeVerified && !allConfiguredCooling,
    configuredProviderCount: configuredNames.length,
    allProvidersCooling: allConfiguredCooling,
    runtimeVerified: anyRuntimeVerified,
    preferredProvider,
    noAiProviderReady,
    noAiProviderReadyCode: noAiProviderReady ? "NO_AI_PROVIDER_READY" : null,
    fallbackChain: CANONICAL_AI_FALLBACK_CHAIN_DISPLAY,
    fallbackOrder: allProviderNames,
    providers: {
      ...providers,
      // Deterministic draft fallback — final non-AI entry. NOT a healthy AI
      // provider, never shown as green. Runs only after every configured AI
      // provider has failed or is unavailable.
      deterministic: {
        fallbackRank: canonicalEntries.length + 1,
        isAi: false,
        status: "UNKNOWN",
        label: "Deterministic draft fallback",
      },
    },
    // Activity flags — computed from actual runtime data so the operator UI
    // can see which providers are active, which were attempted, and which
    // provider served the last request.
    inactive: configuredNames.filter((n) => !providerRuntime[n].coolingDown && !providerRuntime[n].runtimeVerified),
    skipped: allProviderNames.filter((n) => !configuredNames.includes(n)),
    attempted: configuredNames.filter((n) => providerRuntime[n].lastSuccessAt !== null || providerRuntime[n].coolingDown),
    lastProviderUsed,
    blockers,
    warnings,
    providerHealthRestoreWarning: !restore.ok
      ? "using in-memory provider health for this response: " + restore.error
      : undefined,
    nextAction: blockers.length > 0
      ? "CONFIGURE_AI_KEYS"
      : allConfiguredCooling
        ? "ALL_PROVIDERS_COOLING"
        : !anyHasRecentSuccess
          ? "RUNTIME_NOT_VERIFIED"
          : warnings.length > 0
            ? "REVIEW_AI_CONFIGURATION"
            : "READY",
  });
}
