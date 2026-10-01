// POST /api/tenders/[id]/reclassify-documents
// Reclassifies mistyped GeneratedDocument rows.
// Auth: ADMIN or PROPOSAL_MANAGER only.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { normalizeDocumentType, requiresOfficialOriginal, isControlDocument } from "../../../../../lib/engine/document-type-normalizer";
import { MUTATION_RATE_LIMIT, rateLimit } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";
import { getCanonicalReadinessSummary } from "../../../../../lib/canonical-tender-readiness";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  // Retain this explicit alias because the repository security regression pins
  // the owner-scoped lookup to actorId. It is derived only after role approval;
  // there is no session-only or tender-owner fallback.
  const actorId = actor.id;
  const requestId = extractRequestId(req);
  const limit = rateLimit(`reclassify:${actorId}`, MUTATION_RATE_LIMIT);
  if (!limit.allowed) {
    const retryAfter = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Rate limit exceeded", code: "RATE_LIMITED", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  const { id: tenderId } = await params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body.dryRun === true;

  // Mutation remains both role-restricted and owner-scoped. A foreign tender
  // returns 404 so the endpoint does not disclose its existence.
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actorId },
    select: { id: true },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const docs = await prisma.generatedDocument.findMany({
    where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
    select: { id: true, name: true, exactFileName: true, documentType: true, reviewStatus: true },
  });

  const changes: Array<{
    id: string;
    name: string;
    from: string;
    to: string;
    reviewStatusChange?: string;
  }> = [];

  for (const doc of docs) {
    const normalized = normalizeDocumentType(doc.name, doc.exactFileName, doc.documentType);
    const currentType = (doc.documentType ?? "OTHER").toUpperCase();
    const newType = normalized.toUpperCase();

    if (newType === currentType || normalized === "OTHER") continue;

    const change: {
      id: string;
      name: string;
      from: string;
      to: string;
      reviewStatusChange?: string;
    } = {
      id: doc.id,
      name: doc.name,
      from: currentType,
      to: newType,
    };

    let newReviewStatus: string | undefined;
    if (
      requiresOfficialOriginal(normalized)
      && doc.reviewStatus !== "REPLACE_WITH_ORIGINAL"
      && doc.reviewStatus !== "NOT_EXPORTABLE"
    ) {
      newReviewStatus = "REPLACE_WITH_ORIGINAL";
      change.reviewStatusChange = `${doc.reviewStatus ?? "null"} → REPLACE_WITH_ORIGINAL`;
    } else if (isControlDocument(normalized) && doc.reviewStatus !== "NOT_EXPORTABLE") {
      newReviewStatus = "NOT_EXPORTABLE";
      change.reviewStatusChange = `${doc.reviewStatus ?? "null"} → NOT_EXPORTABLE`;
    }

    changes.push(change);

    if (!dryRun) {
      await prisma.generatedDocument.update({
        where: { id: doc.id },
        data: {
          documentType: newType,
          ...(newReviewStatus ? { reviewStatus: newReviewStatus, validationStatus: "PENDING" } : {}),
        },
      });
    }
  }

  if (!dryRun && changes.length > 0) {
    await logAction({
      userId: actorId,
      action: "DOCUMENT_RECLASSIFY",
      entityType: "Tender",
      entityId: tenderId,
      description: `Reclassified ${changes.length} document(s): ${changes.map((change) => `${change.name} (${change.from} → ${change.to})`).join(", ").slice(0, 500)}`,
      metadata: { tenderId, changed: changes.length },
      requestId,
    });
  }

  // Gap 4: re-query the canonical final-export authority after the mutation.
  // Only re-query when actual changes were applied (not on dryRun or no-op).
  const canonicalReadiness = (!dryRun && changes.length > 0)
    ? await getCanonicalReadinessSummary(prisma, actorId, tenderId)
    : null;
  return NextResponse.json({ success: true, dryRun, changed: changes.length, changes, canonicalReadiness });
}
