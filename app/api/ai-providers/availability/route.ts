import { NextResponse } from "next/server";
import { requireRole, unauthorizedResponse } from "../../../../lib/auth";
import { prismaReady } from "../../../../lib/prisma";
import { CANONICAL_AI_PROVIDER_ORDER, isProviderConfigured, type AiProviderName } from "../../../../lib/ai-provider-registry";
import { getProviderRuntimeSnapshot, getMinCooldownExpiryMs } from "../../../../lib/ai-provider-health";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/** GET /api/ai-providers/availability — server-side provider availability.
 *  Does NOT expose API keys, raw errors, or response bodies. */
export async function GET() {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); } catch { return unauthorizedResponse(); }
  await prismaReady;

  const perProvider = CANONICAL_AI_PROVIDER_ORDER.map((provider: AiProviderName, idx: number) => {
    const configured = isProviderConfigured(provider);
    if (!configured) return { provider, rank: idx + 1, configured: false, coolingDown: false, cooldownUntilMs: null as number | null, status: "NOT_CONFIGURED" as const };
    const snapshot = getProviderRuntimeSnapshot(provider);
    const cooldownMs = snapshot.cooldownUntil ? Math.max(0, new Date(snapshot.cooldownUntil).getTime() - Date.now()) : null;
    return { provider, rank: idx + 1, configured: true, coolingDown: snapshot.coolingDown, cooldownUntilMs: cooldownMs, status: snapshot.coolingDown ? ("COOLING_DOWN" as const) : ("AVAILABLE" as const) };
  });

  const configuredProviders = perProvider.filter((p) => p.configured);
  const availableProviders = configuredProviders.filter((p) => !p.coolingDown);

  return NextResponse.json({
    anyAvailable: availableProviders.length > 0,
    minCooldownMs: getMinCooldownExpiryMs(),
    configuredCount: configuredProviders.length,
    availableCount: availableProviders.length,
    perProvider,
  });
}
