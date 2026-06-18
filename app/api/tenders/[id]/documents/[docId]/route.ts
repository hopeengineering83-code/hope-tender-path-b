import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../../lib/auth";
import { logAction } from "../../../../../../lib/audit";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";

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
  const ownedDocumentWhere = { id: docId, tenderId, tender: { userId: actor.id } } as const;

  let doc: Awaited<ReturnType<typeof prisma.generatedDocument.findFirst>> & {
    reviews?: unknown[];
    comments?: unknown[];
  } | null = null;
  let reviews: unknown[] = [];
  let comments: unknown[] = [];

  try {
    const result = await prisma.generatedDocument.findFirst({
      where: ownedDocumentWhere,
      include: {
        reviews: {
          orderBy: { createdAt: "desc" },
          include: { reviewer: { select: { id: true, name: true, role: true } } },
        },
        comments: {
          where: { parentId: null },
          orderBy: { createdAt: "asc" },
          include: {
            author: { select: { id: true, name: true, role: true } },
            replies: {
              orderBy: { createdAt: "asc" },
              include: { author: { select: { id: true, name: true, role: true } } },
            },
          },
        },
      },
    });
    if (result) {
      doc = result;
      reviews = (result as { reviews?: unknown[] }).reviews ?? [];
      comments = (result as { comments?: unknown[] }).comments ?? [];
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("documentId") || msg.includes("does not exist") || msg.includes("column")) {
      doc = await prisma.generatedDocument.findFirst({ where: ownedDocumentWhere });
    } else {
      throw err;
    }
  }

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
    reviews,
    comments,
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

  const canReview = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(actor.role);
  if (!canReview) return forbiddenResponse();

  const rl = await rateLimitPersistent(`doc-review:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requests", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const { id: tenderId, docId } = await params;
  const rawBody = await req.json().catch(() => null);
  if (!rawBody) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  const { reviewStatus, reviewNotes, reviewAction } = rawBody as {
    reviewStatus?: string;
    reviewNotes?: string;
    reviewAction?: string;
  };

  const validStatuses = ["APPROVED", "REJECTED", "PENDING", "NEEDS_REVISION", "READY_FOR_EXPORT", "CHANGES_REQUESTED"];
  if (reviewStatus && !validStatuses.includes(reviewStatus)) {
    return NextResponse.json({ error: "Invalid review status" }, { status: 400 });
  }

  await prismaReady;

  const doc = await prisma.generatedDocument.findFirst({
    where: { id: docId, tenderId, tender: { userId: actor.id } },
  });

  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const priorStatus = doc.reviewStatus;
  const newStatus = reviewStatus ?? doc.reviewStatus;
  const action = reviewAction ?? reviewStatus ?? "NOTE_UPDATE";

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
