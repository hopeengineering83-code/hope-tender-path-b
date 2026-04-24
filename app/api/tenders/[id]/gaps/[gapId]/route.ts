import { NextResponse } from "next/server";
import { getSession } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { logAction } from "../../../../../../lib/audit";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; gapId: string }> },
) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id: tenderId, gapId } = await params;

  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId } });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gap = await prisma.complianceGap.findFirst({ where: { id: gapId, tenderId } });
  if (!gap) return NextResponse.json({ error: "Gap not found" }, { status: 404 });

  const body = await req.json() as { isResolved?: boolean; resolvedNote?: string; mitigationPlan?: string };

  const updated = await prisma.complianceGap.update({
    where: { id: gapId },
    data: {
      isResolved: body.isResolved !== undefined ? body.isResolved : gap.isResolved,
      resolvedNote: body.resolvedNote !== undefined ? body.resolvedNote : gap.resolvedNote,
      mitigationPlan: body.mitigationPlan !== undefined ? body.mitigationPlan : gap.mitigationPlan,
      updatedAt: new Date(),
    },
  });

  await logAction({
    userId,
    action: "UPDATE",
    entityType: "ComplianceGap",
    entityId: gapId,
    description: `${updated.isResolved ? "Resolved" : "Reopened"} compliance gap "${gap.title}"`,
  });

  return NextResponse.json(updated);
}
