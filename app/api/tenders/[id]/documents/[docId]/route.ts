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

  const normalizedReviewNotes = typeof reviewNotes === "string" ? reviewNotes.trim() : "";
  const priorStatus = doc.reviewStatus;
  const newStatus = reviewStatus ?? doc.reviewStatus;
  const action = reviewAction ?? reviewStatus ?? "NOTE_UPDATE";

  if ((newStatus === "APPROVED" || newStatus === "READY_FOR_EXPORT") && normalizedReviewNotes.length < 10) {
    return NextResponse.json(
      { error: "A genuine reviewer note of at least 10 characters is required for approval actions.", code: "REVIEWER_NOTE_REQUIRED" },
      { status: 400 },
    );
  }

  // Soft-gate: only the READY_FOR_EXPORT transition is constrained by the
  // central generation/export gate. Other review actions (notes-only updates,
  // APPROVED, REJECTED, NEEDS_REVISION) remain available during broken-analysis
  // recovery. READY_FOR_EXPORT semantically claims "safe to deliver"; allowing
  // it while the gate is failing would create a misleading DB state (UI shows
  // ready, /export still returns 409). The actual deliverable paths (/export,
  // /download) re-enforce the gate fail-closed, so this is defense-in-depth,
  // not a leak fix. The newStatus !== priorStatus guard avoids re-checking the
  // gate when a doc is already READY_FOR_EXPORT and the user is just updating
  // notes.
  if (newStatus === "READY_FOR_EXPORT" && newStatus !== priorStatus) {
    // Block on PARTIAL_EXTRACTION_AI_ANALYZED — cannot mark docs export-ready
    // on partial extraction (inconsistent with /export and /generate).
    const tenderForExtractionCheck = await prisma.tender.findFirst({
      where: { id: tenderId, userId: actor.id },
      select: { analysisExtractionStatus: true },
    });
    if (tenderForExtractionCheck?.analysisExtractionStatus === "PARTIAL_EXTRACTION_AI_ANALYZED") {
      return NextResponse.json({ error: "Cannot mark document export-ready: AI analysis ran on partial extraction. Re-extract and re-run AI Analyze.", code: "ANALYSIS_FROM_PARTIAL_EXTRACTION" }, { status: 422 });
    }

    const { assertTenderReadyForGenerationAndExport } = await import("../../../../../../lib/engine/generation-readiness-gate");
    const centralGate = await assertTenderReadyForGenerationAndExport({
      prisma,
      tenderId,
      userId: actor.id,
      purpose: "export",
    });
    if (!centralGate.ok) {
      return NextResponse.json({
        error: `Cannot mark document READY_FOR_EXPORT: ${centralGate.blockerDetail}`,
        code: centralGate.blockerCode,
      }, { status: 409 });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.generatedDocument.update({
      where: { id: docId },
      data: {
        reviewStatus: newStatus,
        reviewNotes: reviewNotes !== undefined ? normalizedReviewNotes : doc.reviewNotes,
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
          notes: reviewNotes !== undefined ? normalizedReviewNotes : null,
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
    description: `${actor.email} ${action.toLowerCase()} document "${doc.name}" (${priorStatus} → ${newStatus})${normalizedReviewNotes ? `: ${normalizedReviewNotes.slice(0, 120)}` : ""}`,
    metadata: { tenderId, priorStatus, newStatus, action },
  });

  return NextResponse.json({ document: updated });
}
