import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { prismaReady } from "../../../../../lib/prisma";
import { logAudit } from "../../../../../lib/audit";
import { runTenderEngine } from "../../../../../lib/engine/run-tender-engine";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prismaReady;

  try {
    const { id } = await params;
    const result = await runTenderEngine(id, userId);
    await logAudit({
      userId,
      action: "tender_engine_run",
      entityType: "Tender",
      entityId: id,
      metadata: {
        requirements: result?.requirements?.length || 0,
        complianceGaps: result?.complianceGaps?.length || 0,
        generatedDocuments: result?.generatedDocuments?.length || 0,
      },
    });
    return NextResponse.json({ success: true, tender: result });
  } catch (error) {
    console.error("Engine run failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Engine failed" }, { status: 500 });
  }
}
