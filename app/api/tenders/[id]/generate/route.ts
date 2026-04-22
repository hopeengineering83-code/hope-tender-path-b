import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { generateTenderDocuments } from "../../../../../lib/engine/generate";
import { logAction } from "../../../../../lib/audit";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return msg === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const userId = actor.id;
  await prismaReady;
  const { id } = await params;

  const tender = await prisma.tender.findFirst({ where: { id, userId } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  // Block generation if there are unresolved critical gaps
  const blockingGaps = await prisma.complianceGap.count({
    where: { tenderId: id, severity: "CRITICAL", isResolved: false },
  });

  if (blockingGaps > 0) {
    return NextResponse.json(
      { error: `Generation blocked: ${blockingGaps} unresolved CRITICAL compliance gap(s). Resolve them first.` },
      { status: 422 },
    );
  }

  try {
    await generateTenderDocuments(id, userId);

    await logAction({
      userId,
      action: "TENDER_GENERATED",
      entityType: "Tender",
      entityId: id,
      description: `Generated documents for tender "${tender.title}"`,
      metadata: { tenderId: id },
    });

    const updatedTender = await prisma.tender.findFirst({
      where: { id, userId },
      include: { generatedDocuments: { orderBy: { exactOrder: "asc" } } },
    });

    return NextResponse.json({ success: true, tender: updatedTender });
  } catch (error) {
    console.error("[generate] error:", error);
    return NextResponse.json({ error: "Document generation failed" }, { status: 500 });
  }
}
