// Admin endpoint for AI provider health.
//
// Returns the current in-memory provider health table (configured,
// last success, last failure, consecutive failures, cooldown-until)
// so an operator can answer "is Anthropic still rate-limited?" without
// reading server logs.
//
// POST with { reset: true } clears all cooldowns; useful after an
// operator has fixed a misconfigured API key and wants to retry
// immediately rather than wait for the auto-expire.
//
// Auth: ADMIN only.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { logAction } from "../../../../lib/audit";
import { getAllProviderHealth, resetProviderHealth, type AiProviderName } from "../../../../lib/ai-provider-health";
import { reportError } from "../../../../lib/observability";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

function err(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "AI_PROVIDER_HEALTH_ERROR";
  return NextResponse.json({ ok: false, success: false, code, error: message, message, ...extra }, { status });
}

export async function GET() {
  try {
    try { await requireRole("ADMIN"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const health = getAllProviderHealth();
    const inCooldown = health.filter((h) => h.cooldownUntil).map((h) => h.provider);
    const exhausted = health.filter((h) => h.configured && (h.consecutiveFailures >= 1));
    return NextResponse.json({
      success: true,
      providers: health,
      summary: {
        totalConfigured: health.filter((h) => h.configured).length,
        totalInCooldown: inCooldown.length,
        cooledDown: inCooldown,
        consecutivelyFailingConfigured: exhausted.length,
        anyHealthy: health.some((h) => h.configured && !h.cooldownUntil),
      },
    });
  } catch (error) {
    void reportError(error, { route: "/api/admin/ai-provider-health", operation: "GET" });
    return err("Provider-health lookup failed.", 500, { code: "AI_PROVIDER_HEALTH_RUNTIME_ERROR", detail: error instanceof Error ? error.message : String(error) });
  }
}

export async function POST(req: Request) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
    const body = await req.json().catch(() => ({}));
    if (body.reset === true) {
      const provider = typeof body.provider === "string" ? (body.provider as AiProviderName) : undefined;
      resetProviderHealth(provider);
      await logAction({
        userId: actor.id,
        action: "AI_PROVIDER_FAILOVER",
        entityType: "AiProviderHealth",
        entityId: provider ?? "*",
        description: `Operator reset provider health for ${provider ?? "all providers"}.`,
      });
      return NextResponse.json({ success: true, reset: true, provider: provider ?? "all" });
    }
    return err("Unsupported POST body — pass { reset: true } to clear cooldowns.", 400, { code: "UNSUPPORTED_BODY" });
  } catch (error) {
    void reportError(error, { route: "/api/admin/ai-provider-health", operation: "POST" });
    return err("Provider-health reset failed.", 500, { code: "AI_PROVIDER_HEALTH_RUNTIME_ERROR", detail: error instanceof Error ? error.message : String(error) });
  }
}
