// Per-document threaded comment endpoint (PR #247).
//
// Closes spec Module #16: "approve, reject, mark ready for export,
// maintain approval history, internal comments". The PUT endpoint
// at ../route.ts handles approval actions; this endpoint handles
// the comment thread side.
//
// Endpoints:
//   GET    /api/tenders/[id]/documents/[docId]/comments
//   POST   /api/tenders/[id]/documents/[docId]/comments
//   PATCH  /api/tenders/[id]/documents/[docId]/comments?commentId=...
//
// PATCH supports two operations:
//   • { resolved: true }  — mark a comment thread as resolved
//   • { body: "..." }     — edit the body of an own comment

import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../../../lib/auth";
import { logAction } from "../../../../../../../lib/audit";

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
    select: { id: true },
  });
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const comments = await prisma.documentComment.findMany({
    where: { documentId: docId, parentId: null },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: { id: true, name: true, email: true, role: true } },
      replies: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true, email: true, role: true } } },
      },
    },
  });

  return NextResponse.json({ comments });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  // Anyone authenticated except VIEWER can comment. Viewers are read-only.
  const canComment = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(actor.role);
  if (!canComment) return forbiddenResponse();

  const { id: tenderId, docId } = await params;
  const { body, parentId } = await req.json() as { body?: string; parentId?: string | null };

  if (!body || body.trim().length === 0) {
    return NextResponse.json({ error: "Comment body is required" }, { status: 400 });
  }
  if (body.length > 5_000) {
    return NextResponse.json({ error: "Comment body too long (max 5000 chars)" }, { status: 400 });
  }

  await prismaReady;

  const doc = await prisma.generatedDocument.findFirst({
    where: { id: docId, tenderId },
    select: { id: true, name: true },
  });
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  // If replying, verify the parent comment exists AND belongs to this
  // document (defense-in-depth against cross-document parentId tampering).
  if (parentId) {
    const parent = await prisma.documentComment.findFirst({
      where: { id: parentId, documentId: docId },
      select: { id: true },
    });
    if (!parent) return NextResponse.json({ error: "Parent comment not found on this document" }, { status: 404 });
  }

  const comment = await prisma.documentComment.create({
    data: {
      documentId: docId,
      authorId: actor.id,
      body: body.trim(),
      parentId: parentId ?? null,
    },
    include: {
      author: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  await logAction({
    userId: actor.id,
    action: "DOCUMENT_COMMENT",
    entityType: "GeneratedDocument",
    entityId: docId,
    description: `${actor.email} commented on "${doc.name}"${parentId ? " (reply)" : ""}: ${body.trim().slice(0, 120)}`,
    metadata: { tenderId, commentId: comment.id, parentId: parentId ?? null },
  });

  return NextResponse.json({ comment }, { status: 201 });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }

  const canComment = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(actor.role);
  if (!canComment) return forbiddenResponse();

  const { id: tenderId, docId } = await params;
  const { searchParams } = new URL(req.url);
  const commentId = searchParams.get("commentId");
  if (!commentId) return NextResponse.json({ error: "commentId query parameter required" }, { status: 400 });

  const { resolved, body } = await req.json() as { resolved?: boolean; body?: string };

  await prismaReady;

  const existing = await prisma.documentComment.findFirst({
    where: { id: commentId, documentId: docId, document: { tenderId } },
  });
  if (!existing) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

  // Authorisation:
  //   - Body edit: only the original author can edit their own comment.
  //   - Resolve action: any reviewer can resolve any comment thread.
  if (typeof body === "string") {
    if (existing.authorId !== actor.id && actor.role !== "ADMIN") {
      return NextResponse.json({ error: "Only the author or an admin can edit a comment body" }, { status: 403 });
    }
    if (body.length > 5_000) return NextResponse.json({ error: "Comment body too long" }, { status: 400 });
  }

  const data: { body?: string; resolvedAt?: Date | null; resolvedBy?: string | null } = {};
  if (typeof body === "string") data.body = body.trim();
  if (typeof resolved === "boolean") {
    data.resolvedAt = resolved ? new Date() : null;
    data.resolvedBy = resolved ? actor.id : null;
  }

  const updated = await prisma.documentComment.update({
    where: { id: commentId },
    data,
    include: { author: { select: { id: true, name: true, email: true, role: true } } },
  });

  await logAction({
    userId: actor.id,
    action: "DOCUMENT_COMMENT_UPDATE",
    entityType: "DocumentComment",
    entityId: commentId,
    description: `${actor.email} ${typeof resolved === "boolean" ? (resolved ? "resolved" : "reopened") : "edited"} comment on document ${docId}`,
    metadata: { tenderId, docId, resolved: resolved ?? null, edited: typeof body === "string" },
  });

  return NextResponse.json({ comment: updated });
}
