import { ReviewDecision, TenderStatus, WorkflowStage } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSession } from "../../../../../lib/auth";
import { logAudit } from "../../../../../lib/audit";
import { prisma, prismaReady } from "../../../../../lib/prisma";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prismaReady;
  const { id } = await params;
  const tender = await prisma.tender.findFirst({ where: { id, userId } });
  if (!tender) {
    return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  }

  const body = await req.json();
  const decision = body.decision === "REJECTED" ? ReviewDecision.REJECTED : ReviewDecision.APPROVED;
  const notes = body.notes ? String(body.notes) : null;

  const reviewAction = await prisma.reviewAction.create({
    data: {
      tenderId: tender.id,
      reviewerId: userId,
      decision,
      notes,
    },
  });

  await prisma.approvalRecord.create({
    data: {
      tenderId: tender.id,
      userId,
      decision,
      notes,
    },
  });

  await prisma.tender.update({
    where: { id: tender.id },
    data: {
      status: decision === ReviewDecision.APPROVED ? TenderStatus.APPROVED : TenderStatus.IN_REVIEW,
      stage: WorkflowStage.REVIEW,
    },
  });

  await logAudit({
    userId,
    action: decision === ReviewDecision.APPROVED ? "tender_approved" : "tender_sent_back",
    entityType: "Tender",
    entityId: tender.id,
    metadata: { reviewActionId: reviewAction.id },
  });

  return NextResponse.json({ success: true, reviewAction });
}
