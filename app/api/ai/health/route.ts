import { NextResponse } from "next/server";
import {
  restoreProviderHealthBeforeResponse,
  getAllProviderHealth,
  getProviderRuntimeSnapshot,
  isProviderCooledDown,
  type AiProviderName
} from "@/lib/ai-provider-health";
import {
  CANONICAL_AI_PROVIDER_ORDER,
  AI_PROVIDER_REGISTRY,
  isProviderConfigured,
  getProviderConfig,
  CANONICAL_AI_PROVIDER_DISPLAY,
} from "@/lib/ai-provider-policy";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

function computePreferredProvider() {
  for (const provider of CANONICAL_AI_PROVIDER_ORDER) {
    if (isProviderConfigured(provider)) return provider;
  }
  return null;
}

export async function GET() {
  const restore = await restoreProviderHealthBeforeResponse();
  const health = getAllProviderHealth();
  const providerRuntime = Object.fromEntries(
    CANONICAL_AI_PROVIDER_ORDER.map((n) => [n, getProviderRuntimeSnapshot(n)])
  ) as Record<AiProviderName, ReturnType<typeof getProviderRuntimeSnapshot>>;

  const configuredNames = CANONICAL_AI_PROVIDER_ORDER.filter((n) => isProviderConfigured(n));

  const anyConfigured = configuredNames.length > 0;
  const anyRuntimeVerified = configuredNames.some((n) => providerRuntime[n].runtimeVerified);
  const anyHasRecentSuccess = configuredNames.some((n) => providerRuntime[n].lastSuccessAt !== null);
  const allConfiguredCooling = anyConfigured && configuredNames.every((n) => providerRuntime[n].coolingDown);

  const warnings: string[] = [];
  const blockers: string[] = [];
  const preferredProvider = computePreferredProvider();
  const noAiProviderReady = !anyConfigured || allConfiguredCooling;

  if (!anyConfigured) {
    blockers.push("No AI providers are configured.");
  }

  if (anyConfigured && !anyHasRecentSuccess) {
    warnings.push("runtime availability is not verified. Set API keys in Vercel environment.");
  }

  const cooling = CANONICAL_AI_PROVIDER_ORDER.filter(isProviderCooledDown);
  if (cooling.length > 0) {
    warnings.push(`Provider(s) in cooldown: ${cooling.join(", ")}.`);
  }

  const providers = Object.fromEntries(
    CANONICAL_AI_PROVIDER_ORDER.map((id) => {
      const meta = AI_PROVIDER_REGISTRY[id];
      const config = getProviderConfig(id);
      return [
        id,
        {
          configured: isProviderConfigured(id),
          model: config.models.proposal,
          analysisModel: config.models.analysis,
          fastModel: config.models.fast,
          runtime: providerRuntime[id],
          status: providerRuntime[id].status,
          isAi: true,
          fallbackRank: meta.rank,
          label: meta.displayName,
        },
      ];
    })
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
    fallbackChain: CANONICAL_AI_PROVIDER_DISPLAY,
    providers,
    blockers,
    warnings,
    providerHealthRestoreWarning: !restore.ok ? "using in-memory provider health for this response: " + restore.error : undefined,
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
