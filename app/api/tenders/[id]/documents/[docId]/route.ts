import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../../lib/auth";
import { logAction } from "../../../../../../lib/audit";

// Per-document review action endpoint (PR #247).
//
// Up to PR #246 this endpoint did a destructive update of the
// reviewStatus + reviewedBy + reviewedAt fields on GeneratedDocument
// — every action overwrote the previous one and no history was kept.
//
// New behaviour: every action also creates a DocumentReview row
// preserving the prior status, the new status, the reviewer ID,
// optional notes, and a timestamp. The aggregate fields on
// GeneratedDocument are still updated (so simple "what's the current
// status" queries still work the same way), but the audit trail is
// now queryable via GET on the same endpoint and through
// DocumentReview.findMany() in the UI.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }

  const canRead = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER"].includes(actor.role);
  if (!canRead) return forbiddenResponse();

  const { id: tenderId, docId } = await params;
  await prismaReady;

  const doc = await prisma.generatedDocument.findFirst({
    where: { id: docId, tenderId },
    include: {
      reviews: {
        orderBy: { createdAt: "desc" },
        include: { reviewer: { select: { id: true, name: true, email: true, role: true } } },
      },
      comments: {
        where: { parentId: null },
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { id: true, name: true, email: true, role: true } },
          replies: {
            orderBy: { createdAt: "asc" },
            include: { author: { select: { id: true, name: true, email: true, role: true } } },
          },
        },
      },
    },
  });

  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  return NextResponse.json({
    document: {
      id: doc.id,
      name: doc.name,
      reviewStatus: doc.reviewStatus,
      reviewNotes: doc.reviewNotes,
      reviewedBy: doc.reviewedBy,
      reviewedAt: doc.reviewedAt,
    },
    reviews: doc.reviews,
    comments: doc.comments,
  });
}

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
  const { reviewStatus, reviewNotes, reviewAction } = await req.json() as {
    reviewStatus?: string;
    reviewNotes?: string;
    // Optional explicit action label (APPROVED / REJECTED / CHANGES_REQUESTED
    // / READY_FOR_EXPORT). When omitted, defaults to the new reviewStatus
    // value so backwards-compatible callers continue to work.
    reviewAction?: string;
  };

  const validStatuses = ["APPROVED", "REJECTED", "PENDING", "NEEDS_REVISION", "READY_FOR_EXPORT", "CHANGES_REQUESTED"];
  if (reviewStatus && !validStatuses.includes(reviewStatus)) {
    return NextResponse.json({ error: "Invalid review status" }, { status: 400 });
  }

  await prismaReady;

  const doc = await prisma.generatedDocument.findFirst({
    where: { id: docId, tenderId },
  });

  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const priorStatus = doc.reviewStatus;
  const newStatus = reviewStatus ?? doc.reviewStatus;
  const action = reviewAction ?? reviewStatus ?? "NOTE_UPDATE";

  // Atomic transaction: update aggregate fields AND insert review-action
  // row in a single tx so the audit trail can never miss an action.
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.generatedDocument.update({
      where: { id: docId },
      data: {
        reviewStatus: newStatus,
        reviewNotes: reviewNotes !== undefined ? reviewNotes : doc.reviewNotes,
        reviewedBy: actor.id,
        reviewedAt: new Date(),
      },
    });

    // Only create a DocumentReview row when there's an actual action
    // (status change OR explicit reviewAction). Updating notes alone
    // doesn't pollute the trail with empty rows.
    if (reviewStatus || reviewAction) {
      await tx.documentReview.create({
        data: {
          documentId: docId,
          reviewerId: actor.id,
          action,
          notes: reviewNotes ?? null,
          priorStatus,
          newStatus,
        },
      });
    }

    return u;
  });

  await logAction({
    userId: actor.id,
    action: "DOCUMENT_REVIEW",
    entityType: "GeneratedDocument",
    entityId: docId,
    description: `${actor.email} ${action.toLowerCase()} document "${doc.name}" (${priorStatus} → ${newStatus})${reviewNotes ? `: ${reviewNotes.slice(0, 120)}` : ""}`,
    metadata: { tenderId, priorStatus, newStatus, action },
  });

  return NextResponse.json({ document: updated });
}
