import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { requireRole, requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../../lib/auth";
import { logAction } from "../../../../../../lib/audit";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }

  // Reviewers and above can review; viewers cannot
  const canReview = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(actor.role);
  if (!canReview) return forbiddenResponse();

  const { id: tenderId, docId } = await params;
  const { reviewStatus, reviewNotes } = await req.json() as { reviewStatus?: string; reviewNotes?: string };

  const validStatuses = ["APPROVED", "REJECTED", "PENDING", "NEEDS_REVISION"];
  if (reviewStatus && !validStatuses.includes(reviewStatus)) {
    return NextResponse.json({ error: "Invalid review status" }, { status: 400 });
  }

  await prismaReady;

  const doc = await prisma.generatedDocument.findFirst({
    where: { id: docId, tenderId },
  });

  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const updated = await prisma.generatedDocument.update({
    where: { id: docId },
    data: {
      reviewStatus: reviewStatus ?? doc.reviewStatus,
      reviewNotes: reviewNotes !== undefined ? reviewNotes : doc.reviewNotes,
      reviewedBy: actor.id,
      reviewedAt: new Date(),
    },
  });

  await logAction({
    userId: actor.id,
    action: "UPDATE",
    entityType: "GeneratedDocument",
    entityId: docId,
    description: `Document "${doc.name}" reviewed: ${reviewStatus ?? "notes updated"}`,
  });

  return NextResponse.json({ document: updated });
}
