// POST /api/tenders/[id]/submission-plan/auto-classify
//
// Batch RECLASSIFY_TO_PLAN for a list of document IDs.
// Applies normalizeDocumentType to each, correcting the documentType and
// flagging official-original / control docs automatically. No audit note
// required because this is a non-destructive type correction — the document
// content and generation status are not changed.
//
// Body: { docIds: string[] }
// Response: { classified: number, skipped: number, details: [...] }
//
// Auth: ADMIN or PROPOSAL_MANAGER.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { logAction } from "../../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";
import { sanitizeError } from "../../../../../../lib/sanitize-error";
import { normalizeDocumentType, requiresOfficialOriginal, isControlDocument } from "../../../../../../lib/engine/document-type-normalizer";
import { getCanonicalReadinessSummary } from "../../../../../../lib/canonical-tender-readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`auto-classify:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: "Rate limit exceeded. Please wait and retry.", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  await prismaReady;
  const { id: tenderId } = await params;

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray((body as { docIds?: unknown }).docIds)) {
    return NextResponse.json({ ok: false, error: "Body must be { docIds: string[] }" }, { status: 400 });
  }
  const docIds: string[] = ((body as { docIds: unknown[] }).docIds as string[]).filter((d) => typeof d === "string").slice(0, 200);

  if (docIds.length === 0) {
    return NextResponse.json({ ok: true, classified: 0, skipped: 0, details: [] });
  }

  // Verify tender belongs to actor
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId: actor.id }, select: { id: true, title: true } });
  if (!tender) return NextResponse.json({ ok: false, error: "Tender not found" }, { status: 404 });

  const docs = await prisma.generatedDocument.findMany({
    where: { id: { in: docIds }, tenderId },
    select: { id: true, name: true, exactFileName: true, documentType: true, generationStatus: true },
  });

  let classified = 0;
  let skipped = 0;
  const details: { id: string; name: string; from: string | null; to: string; reviewStatus?: string }[] = [];

  for (const doc of docs) {
    if (doc.generationStatus === "SUPERSEDED") { skipped++; continue; }

    const normalized = normalizeDocumentType(doc.name, doc.exactFileName, doc.documentType);
    const newType = normalized.toUpperCase();
    const reviewStatus = requiresOfficialOriginal(normalized)
      ? "REPLACE_WITH_ORIGINAL"
      : isControlDocument(normalized)
        ? "NOT_EXPORTABLE"
        : undefined;

    await prisma.generatedDocument.update({
      where: { id: doc.id },
      data: { documentType: newType, ...(reviewStatus ? { reviewStatus, validationStatus: "PENDING" } : {}) },
    });

    details.push({ id: doc.id, name: doc.name, from: doc.documentType, to: newType, ...(reviewStatus ? { reviewStatus } : {}) });
    classified++;
  }

  if (classified > 0) {
    await logAction({
      userId: actor.id,
      action: "SUBMISSION_PLAN_AUTO_CLASSIFY",
      entityType: "Tender",
      entityId: tenderId,
      description: `Auto-classified ${classified} outside-plan document(s) for tender "${tender.title}"`,
      metadata: { classified, skipped, docIds },
    });
  }

  // Gap 4: re-query the canonical final-export authority after the mutation.
  const canonicalReadiness = classified > 0
    ? await getCanonicalReadinessSummary(prisma, actor.id, tenderId)
    : null;
  return NextResponse.json({ ok: true, classified, skipped, details, canonicalReadiness });
}
