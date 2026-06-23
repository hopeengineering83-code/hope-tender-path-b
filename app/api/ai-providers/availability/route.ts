import { NextResponse } from "next/server";
import { requireRole, unauthorizedResponse } from "../../../../lib/auth";
import { prismaReady } from "../../../../lib/prisma";
import { CANONICAL_AI_PROVIDER_ORDER, isProviderConfigured } from "../../../../lib/ai-provider-registry";
import {
  getProviderRuntimeSnapshot,
  getMinCooldownExpiryMs,
} from "../../../../lib/ai-provider-health";
import type { AiProviderName } from "../../../../lib/ai-provider-registry";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * GET /api/ai-providers/availability
 *
 * Returns server-side provider availability for the AI Analyze retry
 * button. The button becomes enabled automatically when at least one
 * configured provider is currently eligible (not in cooldown).
 *
 * Auth: ADMIN or PROPOSAL_MANAGER (same as AI Analyze itself).
 *
 * Does NOT expose API keys, raw provider errors, or provider response
 * bodies. Returns only:
 *   - anyAvailable: boolean (at least one configured + not cooling down)
 *   - minCooldownMs: number | null (ms until next provider available)
 *   - perProvider: safe metadata only (provider name, configured, coolingDown,
 *     cooldownUntilMs, status — NO keys, NO error messages, NO response bodies)
 */
export async function GET() {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch {
    return unauthorizedResponse();
  }

  await prismaReady;

  // Compute availability from configured keys + provider health + cooldown.
  // This is the authoritative server-side check — not NEXT_PUBLIC_AI_ENABLED.
  const perProvider = CANONICAL_AI_PROVIDER_ORDER.map((provider: AiProviderName) => {
    const configured = isProviderConfigured(provider);
    if (!configured) {
      return {
        provider,
        rank: CANONICAL_AI_PROVIDER_ORDER.indexOf(provider) + 1,
        configured: false,
        coolingDown: false,
        cooldownUntilMs: null,
        status: "NOT_CONFIGURED" as const,
      };
    }
    const snapshot = getProviderRuntimeSnapshot(provider);
    // cooldownUntil is an ISO string; convert to ms-from-now for the UI.
    const cooldownMs = snapshot.cooldownUntil
      ? Math.max(0, new Date(snapshot.cooldownUntil).getTime() - Date.now())
      : null;
    return {
      provider,
      rank: CANONICAL_AI_PROVIDER_ORDER.indexOf(provider) + 1,
      configured: true,
      coolingDown: snapshot.coolingDown,
      cooldownUntilMs: cooldownMs,
      // status is a safe enum (e.g. "AVAILABLE", "COOLING_DOWN") — no
      // raw error messages or response bodies are exposed.
      status: snapshot.coolingDown
        ? ("COOLING_DOWN" as const)
        : ("AVAILABLE" as const),
    };
  });

  const configuredProviders = perProvider.filter((p) => p.configured);
  const availableProviders = configuredProviders.filter((p) => !p.coolingDown);
  const anyAvailable = availableProviders.length > 0;
  const minCooldownMs = getMinCooldownExpiryMs();

  return NextResponse.json({
    anyAvailable,
    minCooldownMs,
    configuredCount: configuredProviders.length,
    availableCount: availableProviders.length,
    perProvider,
  });
}
