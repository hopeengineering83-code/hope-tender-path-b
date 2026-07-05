import { NextResponse } from "next/server";
import { getSession, requireRole, forbiddenResponse, unauthorizedResponse } from "@/lib/auth";
import {
  restoreProviderHealthBeforeResponse,
  getAllProviderHealth,
  getProviderRuntimeSnapshot,
  isProviderConfigured,
  isProviderCooledDown,
  type AiProviderName,
} from "@/lib/ai-provider-health";
import {
  getCanonicalProviderEntries,
  getProviderModel,
  providerDisplayName,
  preferredConfiguredProviderName,
  CANONICAL_AI_FALLBACK_CHAIN_DISPLAY,
} from "@/lib/ai-provider-registry";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Operator-facing fallback chain string, generated DIRECTLY from the registry —
// never a hand-maintained order. Appends the deterministic draft fallback.
const AI_FALLBACK_CHAIN = CANONICAL_AI_FALLBACK_CHAIN_DISPLAY;

export async function GET() {
  // Auth required — this route exposes AI provider configuration details
  // (configured providers, model names, fallback chain, cooldown status).
  // Without auth, this is reconnaissance gold for an attacker.
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const restore = await restoreProviderHealthBeforeResponse();
  const health = getAllProviderHealth();

  // Canonical, registry-derived provider order — the only ordering source.
  const entries = getCanonicalProviderEntries();
  const allProviderNames: AiProviderName[] = entries.map((e) => e.provider);

  const providerRuntime = Object.fromEntries(
    allProviderNames.map((n) => [n, getProviderRuntimeSnapshot(n)]),
  ) as Record<AiProviderName, ReturnType<typeof getProviderRuntimeSnapshot>>;

  const configuredNames = allProviderNames.filter((n) => isProviderConfigured(n));

  const anyConfigured = configuredNames.length > 0;
  const anyRuntimeVerified = configuredNames.some((n) => providerRuntime[n].runtimeVerified);
  const anyHasRecentSuccess = configuredNames.some((n) => providerRuntime[n].lastSuccessAt !== null);
  const allConfiguredCooling = anyConfigured && configuredNames.every((n) => providerRuntime[n].coolingDown);

  const warnings: string[] = [];
  const blockers: string[] = [];
  const preferredProvider = preferredConfiguredProviderName();
  const noAiProviderReady = !anyConfigured || allConfiguredCooling;

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

  // The last provider that actually produced output (highest-ranked provider
  // with a recorded success), surfaced so operators can see what is really
  // serving traffic rather than guessing from configuration.
  const lastUsed = allProviderNames
    .map((n) => ({ provider: n, at: providerRuntime[n].lastSuccessAt }))
    .filter((x) => x.at !== null)
    .sort((a, b) => (a.at! < b.at! ? 1 : -1))[0]?.provider ?? null;

  // Per-provider block, generated from the registry so rank/label/model/status
  // can never drift from the canonical order. `attempted` reflects whether the
  // provider has any recorded runtime activity this instance.
  const providers = Object.fromEntries(
    entries.map((entry) => {
      const n = entry.provider;
      const runtime = providerRuntime[n];
      const configured = isProviderConfigured(n);
      return [
        n,
        {
          configured,
          label: providerDisplayName(n),
          fallbackRank: entry.rank,
          model: getProviderModel(n, "proposal"),
          analysisModel: getProviderModel(n, "extraction"),
          fastModel: getProviderModel(n, "fast"),
          requestFormat: entry.requestFormat,
          supportsStructuredJson: entry.supportsStructuredJson,
          emergencyOnly: entry.emergencyOnly,
          runtime,
          status: runtime.status,
          isAi: true,
          // Operator-facing activity flags.
          inactive: !configured,
          skipped: configured && runtime.coolingDown,
          attempted: runtime.lastSuccessAt !== null || runtime.lastFailureAt !== null,
          lastUsed: lastUsed === n,
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
    lastProviderUsed: lastUsed,
    noAiProviderReady,
    noAiProviderReadyCode: noAiProviderReady ? "NO_AI_PROVIDER_READY" : null,
    // Fallback order generated directly from the registry.
    fallbackChain: AI_FALLBACK_CHAIN,
    fallbackOrder: allProviderNames,
    providers: {
      ...providers,
      deterministic: {
        fallbackRank: entries.length + 1,
        isAi: false,
        status: "UNKNOWN",
        label: "Deterministic draft fallback",
      },
    },
    health,
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
