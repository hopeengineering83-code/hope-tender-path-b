import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../../../lib/auth";
import { logAction } from "../../../../../../../lib/audit";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../../../lib/rate-limit";

const authorSelect = { id: true, name: true, role: true } as const;

async function applyMutationLimit(actorId: string) {
  const result = await rateLimitPersistent(`document-comment:${actorId}`, MUTATION_RATE_LIMIT);
  if (result.allowed) return null;
  const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: "Too many requests", retryAfter },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

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
  if (!["ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER"].includes(actor.role)) {
    return forbiddenResponse();
  }

  const { id: tenderId, docId } = await params;
  await prismaReady;

  const doc = await prisma.generatedDocument.findFirst({
    where: { id: docId, tenderId, tender: { userId: actor.id } },
    select: { id: true },
  });
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const comments = await prisma.documentComment.findMany({
    where: { documentId: docId, parentId: null },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: authorSelect },
      replies: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: authorSelect } },
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
  if (!["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(actor.role)) {
    return forbiddenResponse();
  }

  const rateLimited = await applyMutationLimit(actor.id);
  if (rateLimited) return rateLimited;

  const { id: tenderId, docId } = await params;
  const rawBody = await req.json().catch(() => null) as { body?: string; parentId?: string | null } | null;
  if (!rawBody) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  const body = typeof rawBody.body === "string" ? rawBody.body.trim() : "";
  const parentId = rawBody.parentId ?? null;

  if (!body) return NextResponse.json({ error: "Comment body is required" }, { status: 400 });
  if (body.length > 5_000) {
    return NextResponse.json({ error: "Comment body too long (max 5000 chars)" }, { status: 400 });
  }

  await prismaReady;

  const doc = await prisma.generatedDocument.findFirst({
    where: { id: docId, tenderId, tender: { userId: actor.id } },
    select: { id: true, name: true },
  });
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  if (parentId) {
    const parent = await prisma.documentComment.findFirst({
      where: { id: parentId, documentId: docId, document: { tender: { userId: actor.id } } },
      select: { id: true },
    });
    if (!parent) return NextResponse.json({ error: "Parent comment not found on this document" }, { status: 404 });
  }

  const comment = await prisma.documentComment.create({
    data: { documentId: docId, authorId: actor.id, body, parentId },
    include: { author: { select: authorSelect } },
  });

  await logAction({
    userId: actor.id,
    action: "DOCUMENT_COMMENT",
    entityType: "GeneratedDocument",
    entityId: docId,
    description: `${actor.email} commented on "${doc.name}"${parentId ? " (reply)" : ""}: ${body.slice(0, 120)}`,
    metadata: { tenderId, commentId: comment.id, parentId },
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
  if (!["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(actor.role)) {
    return forbiddenResponse();
  }

  const rateLimited = await applyMutationLimit(actor.id);
  if (rateLimited) return rateLimited;

  const { id: tenderId, docId } = await params;
  const { searchParams } = new URL(req.url);
  const commentId = searchParams.get("commentId");
  if (!commentId) return NextResponse.json({ error: "commentId query parameter required" }, { status: 400 });

  const patchBody = await req.json().catch(() => null) as { resolved?: boolean; body?: string } | null;
  if (!patchBody) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  const { resolved } = patchBody;
  const hasBody = typeof patchBody.body === "string";
  const body = hasBody ? patchBody.body!.trim() : undefined;
  if (!hasBody && typeof resolved !== "boolean") {
    return NextResponse.json({ error: "Provide a comment body or resolved state" }, { status: 400 });
  }
  if (hasBody && !body) return NextResponse.json({ error: "Comment body is required" }, { status: 400 });
  if (body && body.length > 5_000) return NextResponse.json({ error: "Comment body too long" }, { status: 400 });

  await prismaReady;

  const existing = await prisma.documentComment.findFirst({
    where: {
      id: commentId,
      documentId: docId,
      document: { tenderId, tender: { userId: actor.id } },
    },
  });
  if (!existing) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

  if (hasBody && existing.authorId !== actor.id && actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Only the author or an admin can edit a comment body" }, { status: 403 });
  }

  const data: { body?: string; resolvedAt?: Date | null; resolvedBy?: string | null } = {};
  if (hasBody) data.body = body;
  if (typeof resolved === "boolean") {
    data.resolvedAt = resolved ? new Date() : null;
    data.resolvedBy = resolved ? actor.id : null;
  }

  const updated = await prisma.documentComment.update({
    where: { id: commentId },
    data,
    include: { author: { select: authorSelect } },
  });

  await logAction({
    userId: actor.id,
    action: "DOCUMENT_COMMENT_UPDATE",
    entityType: "DocumentComment",
    entityId: commentId,
    description: `${actor.email} ${typeof resolved === "boolean" ? (resolved ? "resolved" : "reopened") : "edited"} comment on document ${docId}`,
    metadata: { tenderId, docId, resolved: resolved ?? null, edited: hasBody },
  });

  return NextResponse.json({ comment: updated });
}
