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

    // Explicitly update tender stage/status based on resolved truth.
    // Update status AND analysisExtractionStatus atomically so the two
    // denormalized columns cannot disagree. Previously this route set
    // status="ANALYZED" but left a stale analysisExtractionStatus (e.g.
    // "OCR_REQUIRED"), causing export-readiness.ts to see a mismatch.
    const data: { updatedAt: Date; status?: string; analysisExtractionStatus?: string } = {
        updatedAt: new Date(),
    };
    if (analysisInfo.state === "AI_SUCCEEDED") {
        data.status = "ANALYZED";
        // Set analysisExtractionStatus to the AI-analyzed terminal state so
        // it matches the resolved analysis state.
        data.analysisExtractionStatus = "FULL_EXTRACTION_AI_ANALYZED";
    }

    await prisma.tender.update({
        where: { id: tenderId },
        data,
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
