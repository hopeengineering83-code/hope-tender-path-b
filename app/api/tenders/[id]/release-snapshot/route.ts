import { logger } from "../../../../../lib/observability";
import { NextRequest, NextResponse } from "next/server";
import { requireRole, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
import { getTenderReleaseSnapshot } from "../../../../../lib/engine/tender-release-snapshot";

/**
 * Unified release snapshot endpoint.
 *
 * Single authenticated endpoint that returns the authoritative snapshot consumed by ALL panels.
 * - MetadataTruthPanel
 * - MetadataCompletionPanel
 * - ClientSubmissionDetailsPanel
 * - workflow-center
 *
 * This ensures all panels display the same snapshotRevision, field statuses, and blocker counts.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER").catch(() => null);
    if (!actor) return unauthorizedResponse();

    const { id: tenderId } = await params;

    const snapshot = await getTenderReleaseSnapshot(prisma, tenderId, actor.id);
    if (!snapshot) {
      return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      snapshot,
    });
  } catch (error) {
    logger.error("[release-snapshot]", { detail: error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
