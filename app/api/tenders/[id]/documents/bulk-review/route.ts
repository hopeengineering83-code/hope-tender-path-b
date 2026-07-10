import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../../lib/auth";
import { logAction } from "../../../../../../lib/audit";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";
import { generatedDocumentHasContent } from "../../../../../../lib/generated-document-content";

const VALID_STATUSES = ["APPROVED", "REJECTED", "PENDING", "NEEDS_REVISION", "READY_FOR_EXPORT", "CHANGES_REQUESTED"];
const MAX_BULK_DOCUMENTS = 200;
const MAX_REVIEW_NOTES = 5_000;
const MAX_REVIEW_ACTION = 80;

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

  if (!["ADMIN", "PROPOSAL_MANAGER", "REVIEWER"].includes(actor.role)) {
    return forbiddenResponse();
  }

  const rl = await rateLimitPersistent(`bulk-review:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requests", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const { id: tenderId } = await params;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });

  const reviewStatus = typeof body.reviewStatus === "string" ? body.reviewStatus : "";
  if (!VALID_STATUSES.includes(reviewStatus)) {
    return NextResponse.json(
      { error: `Invalid reviewStatus. Expected one of: ${VALID_STATUSES.join(", ")}.` },
      { status: 400 },
    );
  }

  const reviewNotes = typeof body.reviewNotes === "string" ? body.reviewNotes.trim() : null;
  if (reviewNotes && reviewNotes.length > MAX_REVIEW_NOTES) {
    return NextResponse.json({ error: `reviewNotes must not exceed ${MAX_REVIEW_NOTES} characters` }, { status: 400 });
  }

  const reviewAction = typeof body.reviewAction === "string" ? body.reviewAction.trim() : reviewStatus;
  if (!reviewAction || reviewAction.length > MAX_REVIEW_ACTION || !/^[A-Z0-9_ -]+$/i.test(reviewAction)) {
    return NextResponse.json({ error: "reviewAction is invalid" }, { status: 400 });
  }

  const requestedIds = Array.isArray(body.onlyDocumentIds)
    ? body.onlyDocumentIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : null;
  const onlyDocumentIds = requestedIds ? Array.from(new Set(requestedIds.map((value) => value.trim()))) : null;
  if (onlyDocumentIds && onlyDocumentIds.length > MAX_BULK_DOCUMENTS) {
    return NextResponse.json({ error: `onlyDocumentIds must not contain more than ${MAX_BULK_DOCUMENTS} entries` }, { status: 400 });
  }
  const skipAlreadyAtTarget = body.skipAlreadyAtTarget !== false;

  await prismaReady;

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, userId: actor.id },
    select: { id: true, title: true, analysisExtractionStatus: true },
  });
  if (!tender) return NextResponse.json({ error: "Tender not found or not accessible." }, { status: 404 });

  // Soft-gate: only the READY_FOR_EXPORT transition is constrained by the
  // central generation/export gate. Other review states (APPROVED, REJECTED,
  // NEEDS_REVISION, etc.) are legitimate during broken-analysis recovery and
  // must remain available. READY_FOR_EXPORT semantically claims "safe to
  // deliver"; allowing it while the gate is failing would create a misleading
  // DB state (UI shows ready, /export still returns 409). The actual
  // deliverable paths (/export, /download) re-enforce the gate fail-closed,
  // so this is defense-in-depth, not a leak fix.
  if (reviewStatus === "READY_FOR_EXPORT") {
    // Block on PARTIAL_EXTRACTION_AI_ANALYZED
    if (tender.analysisExtractionStatus === "PARTIAL_EXTRACTION_AI_ANALYZED") {
      return NextResponse.json({ error: "Cannot approve documents for export: AI analysis ran on partial extraction. Re-extract and re-run AI Analyze.", code: "ANALYSIS_FROM_PARTIAL_EXTRACTION" }, { status: 422 });
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
        error: `Cannot mark documents READY_FOR_EXPORT: ${centralGate.blockerDetail}`,
        code: centralGate.blockerCode,
      }, { status: 409 });
    }
  }

  // When the target review status is READY_FOR_EXPORT or APPROVED, we must
  // only operate on documents that are actually GENERATED (not PLANNED) and
  // have real content. PLANNED/empty rows must never be marked export-ready.
  // Per spec rules 6 & 7: validation must not approve empty/placeholder
  // content, and approval must not mark docs export-ready if validation
  // failed or content is missing.
  const requiresContentGate = reviewStatus === "READY_FOR_EXPORT" || reviewStatus === "APPROVED";

  const docs = await prisma.generatedDocument.findMany({
    where: {
      tenderId,
      generationStatus: { not: "SUPERSEDED" },
      ...(requiresContentGate ? { generationStatus: "GENERATED" } : {}),
      ...(onlyDocumentIds ? { id: { in: onlyDocumentIds } } : {}),
    },
    take: MAX_BULK_DOCUMENTS,
    select: {
      id: true,
      name: true,
      reviewStatus: true,
      exactFileName: true,
      generationStatus: true,
      validationStatus: true,
      storagePath: true,
      fileContent: true,
    },
  });

  if (docs.length === 0) {
    return NextResponse.json({ updated: 0, skipped: 0, results: [], note: "No active documents to update." });
  }

  // Per spec rule 7: READY_FOR_EXPORT requires validation passed AND content
  // exists. Reject the entire batch if any doc fails these checks — fail
  // closed rather than partially approving a batch with mixed states.
  if (reviewStatus === "READY_FOR_EXPORT") {
    const rejected: Array<{ id: string; name: string; reason: string; code: string }> = [];
    for (const doc of docs) {
      if (doc.generationStatus !== "GENERATED") {
        rejected.push({ id: doc.id, name: doc.name, reason: `Document generationStatus is ${doc.generationStatus ?? "null"}, not GENERATED.`, code: "GENERATION_REQUIRED_BEFORE_EXPORT" });
        continue;
      }
      if (!generatedDocumentHasContent(doc)) {
        rejected.push({ id: doc.id, name: doc.name, reason: "Document has no content (fileContent and storagePath are both empty). Generate the document first.", code: "CONTENT_REQUIRED_BEFORE_EXPORT" });
        continue;
      }
      // validationStatus must be VALIDATED or PASSED (or empty for legacy
      // docs that predate the validationStatus field). PENDING, FAILED,
      // NEEDS_REVALIDATION, and SUPERSEDED all block READY_FOR_EXPORT.
      const vs = (doc.validationStatus ?? "").toUpperCase();
      if (vs && vs !== "VALIDATED" && vs !== "PASSED") {
        rejected.push({ id: doc.id, name: doc.name, reason: `Document validationStatus is ${vs}, not VALIDATED. Run validation first.`, code: "VALIDATION_REQUIRED_BEFORE_EXPORT" });
        continue;
      }
    }
    if (rejected.length > 0) {
      return NextResponse.json({
        error: `Cannot mark ${rejected.length} document(s) READY_FOR_EXPORT: validation/generation/content checks failed.`,
        code: "VALIDATION_REQUIRED_BEFORE_EXPORT",
        rejected,
        rejectedCount: rejected.length,
        totalCandidates: docs.length,
      }, { status: 422 });
    }
  }

  const results: Array<{ id: string; name: string; priorStatus: string; newStatus: string; action: "UPDATED" | "SKIPPED" }> = [];

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

  const updated = results.filter((result) => result.action === "UPDATED").length;
  const skipped = results.filter((result) => result.action === "SKIPPED").length;

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
