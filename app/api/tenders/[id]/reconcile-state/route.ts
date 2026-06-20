import { NextRequest, NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma } from "../../../../../lib/prisma";
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

    // Consume the CANONICAL analysis state resolver with userId for tenant
    // isolation. The reconcile route must NOT independently decide analysis
    // state, and must NEVER delete or automatically overwrite requirements
    // or documents — it only updates tender.status to reflect the canonical
    // truth.
    const analysisInfo = await resolveTenderAnalysisState(tenderId, actor.id);

    // Explicitly update tender stage/status based on resolved truth.
    // This is a NON-DESTRUCTIVE operation: it only sets tender.status to
    // "ANALYZED" when the canonical state is AI_SUCCEEDED. It does NOT
    // delete requirements, documents, or any other data.
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
    console.error("[reconcile-state]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
