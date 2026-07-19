import { logger } from "../../../../../lib/observability";
import { NextRequest, NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { resolveTenderAnalysisState } from "../../../../../lib/engine/analysis-state-resolver";
import { logAction } from "../../../../../lib/audit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const { id: tenderId } = await params;

    // Ensure the runtime schema bootstrap has completed before any DB query.
    await prismaReady;

    const analysisInfo = await resolveTenderAnalysisState(prisma, tenderId, actor.id);

    // Explicitly update tender stage/status based on resolved truth
    let status = undefined;
    if (analysisInfo.state === "AI_SUCCEEDED") {
        status = "ANALYZED";
    }

    await prisma.tender.update({
        where: { id: tenderId },
        data: {
            updatedAt: new Date(),
            ...(status ? { status } : {})
        }
    });

    await logAction({
      userId: actor.id,
      action: "TENDER_UPDATE",
      entityType: "Tender",
      entityId: tenderId,
      description: `Owner triggered state reconciliation. Resolved state: ${analysisInfo.state}`,
    });

    return NextResponse.json({
      ok: true,
      analysisInfo
    });
  } catch (error) {
    logger.error("[reconcile-state]", { detail: error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
