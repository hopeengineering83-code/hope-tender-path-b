// POST /api/tenders/[id]/reclassify-documents
// Reclassifies mistyped GeneratedDocument rows.
// Auth: ADMIN or PROPOSAL_MANAGER or tender owner

import { NextResponse } from "next/server";
import { requireRole, getSession } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";
import { normalizeDocumentType, requiresOfficialOriginal, isControlDocument } from "../../../../../lib/engine/document-type-normalizer";
import { MUTATION_RATE_LIMIT, rateLimit } from "../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = rateLimit(`reclassify:${ip}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  let actorId: string;
  try {
    const actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
    actorId = actor.id;
  } catch {
    // Fall back to tender-owner check
    const userId = await getSession();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    actorId = userId;
  }

  await prismaReady;
  const { id: tenderId } = await params;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const dryRun = body.dryRun === true;

  // Verify tender ownership. The fallback `?? findFirst({ where: { id } })`
  // was removed (audit SEC-001, 2026-06-20) — it allowed any authenticated
  // user (including VIEWER, who per RBAC only has TENDER_READ) to reclassify
  // GeneratedDocument rows on ANY user's tender. The owner-scoped findFirst
  // is the only safe lookup; if the tender doesn't belong to the actor,
  // return 404 (not 403, to avoid leaking existence).
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId: actorId }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const docs = await prisma.generatedDocument.findMany({
    where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
    select: { id: true, name: true, exactFileName: true, documentType: true, reviewStatus: true },
  });

  const changes: Array<{ id: string; name: string; from: string; to: string; reviewStatusChange?: string }> = [];

  for (const doc of docs) {
    const normalized = normalizeDocumentType(doc.name, doc.exactFileName, doc.documentType);
    const currentType = (doc.documentType ?? "OTHER").toUpperCase();
    const newType = normalized.toUpperCase();

    if (newType !== currentType && normalized !== "OTHER") {
      const change: { id: string; name: string; from: string; to: string; reviewStatusChange?: string } = {
        id: doc.id,
        name: doc.name,
        from: currentType,
        to: newType,
      };

      let newReviewStatus: string | undefined;
      if (requiresOfficialOriginal(normalized) && doc.reviewStatus !== "REPLACE_WITH_ORIGINAL" && doc.reviewStatus !== "NOT_EXPORTABLE") {
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
  }

  if (!dryRun && changes.length > 0) {
    await logAction({
      userId: actorId,
      action: "DOCUMENT_RECLASSIFY",
      entityType: "Tender",
      entityId: tenderId,
      description: `Reclassified ${changes.length} document(s): ${changes.map((c) => `${c.name} (${c.from} → ${c.to})`).join(", ").slice(0, 500)}`,
    });
  }

  return NextResponse.json({ success: true, dryRun, changed: changes.length, changes });
}
