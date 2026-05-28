// GET /api/tenders/[id]/lifecycle
//
// Returns the full tender lifecycle state, primary next action, allowed/blocked
// action matrix, and canonical document-count summary for the Recovery Command
// Center UI.
//
// Auth: ADMIN, PROPOSAL_MANAGER, REVIEWER (read-only)
// Rate limit: API_RATE_LIMIT (non-mutating, cheap)

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { computeTenderLifecycle } from "../../../../../lib/engine/tender-lifecycle-orchestrator";
import { rateLimit, API_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { sanitizeError } from "../../../../../lib/sanitize-error";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

function err(message: string, status = 500, code = "LIFECYCLE_ERROR") {
  return NextResponse.json({ ok: false, code, error: message }, { status });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const rl = rateLimit(`lifecycle:${actor.id}`, API_RATE_LIMIT);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
        { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
      );
    }

    await prismaReady;
    const { id } = await params;

    // Scope to the current user — same as every other tender endpoint.
    const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
    if (!tender) return err("Tender not found", 404, "TENDER_NOT_FOUND");

    const result = await computeTenderLifecycle(prisma, id);
    if (!result) return err("Tender not found", 404, "TENDER_NOT_FOUND");

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("lifecycle GET failed", error);
    return err(`Lifecycle computation failed: ${sanitizeError(error)}`, 500, "LIFECYCLE_RUNTIME_ERROR");
  }
}
