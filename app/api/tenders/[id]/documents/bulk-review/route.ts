import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../../lib/auth";
import { logAction } from "../../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";

/**
 * Bulk Review action endpoint (PR TT).
 *
 * THE PROBLEM
 * Real production: the user generated a 12-document submission package,
 * then hit "Download" and saw:
 *
 *   "Final export blocked: 8 documents are not ready for export.
 *    • Company profile and capability statement.docx — reviewStatus is
 *      PENDING, expected READY_FOR_EXPORT
 *    • Technical-Proposal.docx — reviewStatus is PENDING, expected
 *      READY_FOR_EXPORT
 *    • [...] and 6 more"
 *
 * The fix is to walk into each of the 8 documents individually and
 * mark each as READY_FOR_EXPORT — 8 round trips, each with confirm
 * dialog and reload. That's a usability cliff.
 *
 * THIS ENDPOINT
 * Single POST that updates EVERY generated document on the tender to
 * the requested reviewStatus in one atomic transaction. Each update
 * still emits a DocumentReview audit row preserving the priorStatus
 * and newStatus, so the audit trail is identical to clicking each
 * document individually.
 *
 * Body shape:
 *   {
 *     reviewStatus: "READY_FOR_EXPORT" | "APPROVED" | "REJECTED" |
 *                   "PENDING" | "NEEDS_REVISION" | "CHANGES_REQUESTED",
 *     reviewNotes?: string,             // optional, applied to all
 *     reviewAction?: string,             // optional, defaults to reviewStatus
 *     onlyDocumentIds?: string[],        // optional, scope to subset
 *     skipAlreadyAtTarget?: boolean      // skip docs already at target
 *   }
 *
 * RBAC: same as per-doc review — REVIEWER+ only. VIEWERs cannot
 * approve. ADMIN can approve.
 *
 * Returns: { updated: number, skipped: number, results: [...] }
 */

const VALID_STATUSES = ["APPROVED", "REJECTED", "PENDING", "NEEDS_REVISION", "READY_FOR_EXPORT", "CHANGES_REQUESTED"];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }

  const canReview = ["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(actor.role);
  if (!canReview) return forbiddenResponse();

  const rl = rateLimit(`bulk-review:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  const { id: tenderId } = await params;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  const reviewStatus = typeof body.reviewStatus === "string" ? body.reviewStatus : "";
  if (!VALID_STATUSES.includes(reviewStatus)) {
    return NextResponse.json(
      { error: `Invalid reviewStatus. Expected one of: ${VALID_STATUSES.join(", ")}.` },
      { status: 400 },
    );
  }

  const reviewNotes = typeof body.reviewNotes === "string" ? body.reviewNotes : null;
  const reviewAction = typeof body.reviewAction === "string" ? body.reviewAction : reviewStatus;
  const onlyDocumentIds = Array.isArray(body.onlyDocumentIds)
    ? (body.onlyDocumentIds as unknown[]).filter((v): v is string => typeof v === "string")
    : null;
  const skipAlreadyAtTarget = body.skipAlreadyAtTarget !== false; // default true

  await prismaReady;

  // Verify tender ownership / membership.
  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: { id: true, title: true },
  });
  if (!tender) {
    return NextResponse.json({ error: "Tender not found or not accessible." }, { status: 404 });
  }

  // Pull active (non-superseded) generated documents.
  const docs = await prisma.generatedDocument.findMany({
    where: {
      tenderId,
      generationStatus: { not: "SUPERSEDED" },
      ...(onlyDocumentIds ? { id: { in: onlyDocumentIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      reviewStatus: true,
      exactFileName: true,
      generationStatus: true,
    },
  });

  if (docs.length === 0) {
    return NextResponse.json({ updated: 0, skipped: 0, results: [], note: "No active documents to update." });
  }

  const results: Array<{ id: string; name: string; priorStatus: string; newStatus: string; action: "UPDATED" | "SKIPPED" }> = [];

  // Atomic — either every doc gets updated + audit row, or none.
  await prisma.$transaction(async (tx) => {
    for (const doc of docs) {
      if (skipAlreadyAtTarget && doc.reviewStatus === reviewStatus) {
        results.push({ id: doc.id, name: doc.name, priorStatus: doc.reviewStatus, newStatus: doc.reviewStatus, action: "SKIPPED" });
        continue;
      }

      const priorStatus = doc.reviewStatus;
      await tx.generatedDocument.update({
        where: { id: doc.id },
        data: {
          reviewStatus,
          reviewNotes: reviewNotes !== null ? reviewNotes : undefined,
          reviewedBy: actor.id,
          reviewedAt: new Date(),
        },
      });

      await tx.documentReview.create({
        data: {
          documentId: doc.id,
          reviewerId: actor.id,
          action: reviewAction,
          notes: reviewNotes,
          priorStatus,
          newStatus: reviewStatus,
        },
      });

      results.push({ id: doc.id, name: doc.name, priorStatus, newStatus: reviewStatus, action: "UPDATED" });
    }
  });

  const updated = results.filter((r) => r.action === "UPDATED").length;
  const skipped = results.filter((r) => r.action === "SKIPPED").length;

  await logAction({
    userId: actor.id,
    action: "DOCUMENT_REVIEW",
    entityType: "Tender",
    entityId: tenderId,
    description: `${actor.email} bulk-reviewed ${updated} document(s) on "${tender.title}" → ${reviewStatus}${skipped > 0 ? ` (${skipped} already at target — skipped)` : ""}.`,
    metadata: {
      tenderId,
      reviewStatus,
      reviewAction,
      updatedCount: updated,
      skippedCount: skipped,
      totalCandidates: docs.length,
      onlyDocumentIdsRequested: onlyDocumentIds?.length ?? null,
    },
  });

  return NextResponse.json({
    success: true,
    updated,
    skipped,
    total: docs.length,
    reviewStatus,
    results,
  });
}
