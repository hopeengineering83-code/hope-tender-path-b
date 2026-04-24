import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { generateStrictTenderDocuments } from "../../../../../lib/engine/generate-strict";
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

  const blockingGaps = await prisma.complianceGap.count({
    where: { tenderId: id, severity: { in: ["CRITICAL", "HIGH"] }, isResolved: false },
  });

  if (blockingGaps > 0) {
    return NextResponse.json(
      { error: `Generation blocked: ${blockingGaps} unresolved high/critical compliance gap(s). Resolve or override them first.` },
      { status: 422 },
    );
  }

  try {
    await generateStrictTenderDocuments(id, userId);

    await logAction({
      userId,
      action: "TENDER_GENERATED",
      entityType: "Tender",
      entityId: id,
      description: `Generated strict tender-required documents for tender "${tender.title}"`,
      metadata: { tenderId: id, mode: "STRICT_TENDER_SCOPE" },
    });

    const updatedTender = await prisma.tender.findFirst({
      where: { id, userId },
      include: { generatedDocuments: { orderBy: { exactOrder: "asc" } } },
    });

    return NextResponse.json({ success: true, tender: updatedTender });
  } catch (error) {
    console.error("[generate] error:", error);
    const message = error instanceof Error ? error.message : "Document generation failed";
    const status = message === "NO_TENDER_REQUIRED_DOCUMENTS" || message.startsWith("Missing selected") ? 422 : 500;
    return NextResponse.json({ error: message === "NO_TENDER_REQUIRED_DOCUMENTS" ? "No tender-required documents are planned. Run tender analysis or review tender instructions before generation." : message }, { status });
  }
}
