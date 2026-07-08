import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "@/lib/auth";
import {
  restoreProviderHealthBeforeResponse,
  getProviderRuntimeSnapshot,
  isProviderCooledDown,
} from "@/lib/ai-provider-health";
import {
  getCanonicalProviderEntries,
  preferredConfiguredProviderName,
  isProviderConfigured,
  getProviderModel,
  CANONICAL_AI_FALLBACK_CHAIN_DISPLAY,
  type AiProviderName,
} from "@/lib/ai-provider-registry";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  // Provider health exposes configured providers, models and runtime state —
  // reconnaissance value. Restrict to operators (ADMIN / PROPOSAL_MANAGER).
  try {
    await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const restore = await restoreProviderHealthBeforeResponse();

  // SINGLE SOURCE OF TRUTH: every provider object, rank, model and the
  // human-readable chain string are derived from the canonical registry so this
  // surface can never drift from the runtime fallback order. Do NOT hardcode a
  // separate provider list, rank, model or chain string here.
  const entries = getCanonicalProviderEntries();
  const allProviderNames = entries.map((entry) => entry.provider);

  const runtimeByName = Object.fromEntries(
    entries.map((entry) => [entry.provider, getProviderRuntimeSnapshot(entry.provider)]),
  ) as Record<AiProviderName, ReturnType<typeof getProviderRuntimeSnapshot>>;

  const configuredEntries = entries.filter((entry) => isProviderConfigured(entry.provider));
  const configuredNames = configuredEntries.map((e) => e.provider);

  const anyConfigured = configuredNames.length > 0;
  const anyRuntimeVerified = configuredNames.some((n) => runtimeByName[n].runtimeVerified);
  const anyHasRecentSuccess = configuredNames.some((n) => runtimeByName[n].lastSuccessAt !== null);
  const allConfiguredCooling = anyConfigured && configuredNames.every((n) => runtimeByName[n].coolingDown);
  const noAiProviderReady = !anyConfigured || allConfiguredCooling;

  // The most recently successful configured provider (or null). Lets the UI show
  // which provider actually served the last request without leaking key values.
  const lastProviderUsed = configuredNames
    .map((n) => ({ name: n, at: runtimeByName[n].lastSuccessAt }))
    .filter((x) => x.at !== null)
    .sort((a, b) => new Date(b.at as unknown as string).getTime() - new Date(a.at as unknown as string).getTime())[0]?.name ?? null;

  const providers = Object.fromEntries(
    entries.map((entry) => {
      const name = entry.provider;
      const runtime = runtimeByName[name];
      const configured = isProviderConfigured(name);
      return [
        name,
        {
          configured,
          // A provider is inactive when it is unconfigured or currently cooling
          // down — i.e. it cannot serve the next request.
          inactive: !configured || runtime.coolingDown,
          model: getProviderModel(name, "proposal"),
          analysisModel: getProviderModel(name, "extraction"),
          runtime,
          status: runtime.status,
          isAi: true,
          fallbackRank: entry.rank,
          label: entry.displayName,
          attempted: runtime.lastSuccessAt !== null || runtime.coolingDown,
          skipped: !configured,
        },
      ];
    }),
  );

  const warnings: string[] = [];
  const blockers: string[] = [];
  if (!anyConfigured) {
    blockers.push("No AI providers are configured.");
  }
  if (anyConfigured && !anyHasRecentSuccess) {
    warnings.push("runtime availability is not verified. Set API keys in Vercel environment.");
  }
  const cooling = entries.map((e) => e.provider).filter(isProviderCooledDown);
  if (cooling.length > 0) {
    warnings.push(`Provider(s) in cooldown: ${cooling.join(", ")}.`);
  }

  return NextResponse.json({
    success: anyConfigured && !allConfiguredCooling,
    ok: anyRuntimeVerified && !allConfiguredCooling,
    configuredProviderCount: configuredNames.length,
    allProvidersCooling: allConfiguredCooling,
    runtimeVerified: anyRuntimeVerified,
    preferredProvider: preferredConfiguredProviderName(),
    lastProviderUsed,
    noAiProviderReady,
    noAiProviderReadyCode: noAiProviderReady ? "NO_AI_PROVIDER_READY" : null,
    fallbackChain: CANONICAL_AI_FALLBACK_CHAIN_DISPLAY,
    fallbackOrder: allProviderNames,
    providers: {
      ...providers,
      deterministic: {
        fallbackRank: entries.length + 1,
        isAi: false,
        status: "UNKNOWN",
        label: "Deterministic draft fallback",
        inactive: false,
      },
    },
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
