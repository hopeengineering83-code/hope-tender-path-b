// GET /api/tenders/[id]/release-state
//
// The canonical Tender Release State endpoint — the single source of truth
// for readiness score, blocker totals, bid verdict, and next action. Every
// panel that previously computed its own version of these numbers
// (CanonicalReadinessScoreWidget, TenderHealthScorePanel,
// BidControlVerdictPanel, command center, report) should read this route
// instead so they can never disagree.
//
// Auth: ADMIN, PROPOSAL_MANAGER, or REVIEWER. VIEWER is rejected to mirror
// the other tender readiness routes.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { getTenderReleaseState } from "../../../../../lib/engine/tender-release-state";
import { logger } from "../../../../../lib/observability";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

function err(message: string, status = 500, extra: Record<string, unknown> = {}) {
  const code = typeof extra.code === "string" ? extra.code : "RELEASE_STATE_ERROR";
  return NextResponse.json({ ok: false, success: false, code, error: message, message, ...extra }, { status });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    let actor;
    try {
      actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
    } catch (e) {
      return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
    }
    await prismaReady;
    const { id } = await params;

    const releaseState = await getTenderReleaseState(prisma, id, actor.id);
    if (!releaseState) return err("Tender not found", 404, { code: "TENDER_NOT_FOUND" });

    return NextResponse.json({ success: true, ok: true, releaseState });
  } catch (error) {
    logger.error("release-state route failed", { detail: error });
    return err("Release-state route failed.", 500, { code: "RELEASE_STATE_RUNTIME_ERROR" });
  }
}
