// POST /api/tenders/[id]/documents/[docId]/plan-action
//
// Per-row recovery actions for the Submission Plan Completeness panel so an
// OUTSIDE_PLAN / mistyped generated document is never a dead end. Each action
// maps to the same export-exclusion model used by the canonical readiness
// engine (lib/engine/document-output-state.ts), so a row marked here is
// consistently excluded from the final ZIP and the readiness counts.
//
// Actions:
//   RECLASSIFY_TO_PLAN  — re-type the row via the document-type normalizer so a
//                         mistyped row lands on its real plan slot. Control /
//                         official-original types are flagged accordingly.
//   MARK_NOT_EXPORTABLE — keep the row visible as a control record but exclude
//                         it from the final package (reviewStatus NOT_EXPORTABLE).
//   SUPERSEDE_DUPLICATE — supersede a duplicate row (generationStatus SUPERSEDED).
//   EXCLUDE_OUTSIDE_PLAN — supersede a row that does not belong to this tender's plan.
//
// SUPERSEDE_DUPLICATE / EXCLUDE_OUTSIDE_PLAN / MARK_NOT_EXPORTABLE require a
// short audit note. Nothing here generates or fakes a document.
//
// Auth: ADMIN / PROPOSAL_MANAGER, scoped to a tender the actor can access.

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../../lib/prisma";
import { logAction } from "../../../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../../../lib/request-id";
import { normalizeDocumentType, requiresOfficialOriginal, isControlDocument } from "../../../../../../../lib/engine/documents/document-type-normalizer";

export const dynamic = "force-dynamic";

const PLAN_ACTIONS = ["RECLASSIFY_TO_PLAN", "MARK_NOT_EXPORTABLE", "SUPERSEDE_DUPLICATE", "EXCLUDE_OUTSIDE_PLAN"] as const;
type PlanAction = (typeof PLAN_ACTIONS)[number];
const NOTE_REQUIRED: ReadonlySet<PlanAction> = new Set(["MARK_NOT_EXPORTABLE", "SUPERSEDE_DUPLICATE", "EXCLUDE_OUTSIDE_PLAN"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const requestId = extractRequestId(req);
  const rl = rateLimit(`plan-action:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json({ error: "Rate limit exceeded. Wait and retry.", retryAfter }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }

  await prismaReady;
  const { id: tenderId, docId } = await params;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  const action = String((body as { action?: unknown }).action ?? "") as PlanAction;
  if (!PLAN_ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Invalid action", validActions: PLAN_ACTIONS }, { status: 400 });
  }
  const rawNote = typeof (body as { note?: unknown }).note === "string" ? (body as { note: string }).note.trim() : "";
  if (NOTE_REQUIRED.has(action) && rawNote.length === 0) {
    return NextResponse.json({ error: "A short audit note is required for this action.", code: "NOTE_REQUIRED" }, { status: 400 });
  }
  const note = rawNote.slice(0, 500);

  // Scope to a tender the actor can access (owner, else any tender for ADMIN/PM).
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId: actor.id }, select: { id: true } })
    ?? await prisma.tender.findFirst({ where: { id: tenderId }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const doc = await prisma.generatedDocument.findFirst({
    where: { id: docId, tenderId },
    select: { id: true, name: true, exactFileName: true, documentType: true, generationStatus: true, reviewStatus: true },
  });
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  let resultDetail = "";
  if (action === "RECLASSIFY_TO_PLAN") {
    const normalized = normalizeDocumentType(doc.name, doc.exactFileName, doc.documentType);
    const newType = normalized.toUpperCase();
    const reviewStatus = requiresOfficialOriginal(normalized)
      ? "REPLACE_WITH_ORIGINAL"
      : isControlDocument(normalized)
        ? "NOT_EXPORTABLE"
        : undefined;
    await prisma.generatedDocument.update({
      where: { id: docId },
      data: { documentType: newType, ...(reviewStatus ? { reviewStatus, validationStatus: "PENDING" } : {}) },
    });
    resultDetail = `reclassified ${doc.documentType ?? "OTHER"} → ${newType}${reviewStatus ? ` (${reviewStatus})` : ""}`;
  } else if (action === "MARK_NOT_EXPORTABLE") {
    await prisma.generatedDocument.update({
      where: { id: docId },
      data: { reviewStatus: "NOT_EXPORTABLE", reviewNotes: note },
    });
    resultDetail = "marked NOT_EXPORTABLE (kept as control record, excluded from final package)";
  } else {
    // SUPERSEDE_DUPLICATE / EXCLUDE_OUTSIDE_PLAN — fully retire the row.
    await prisma.generatedDocument.update({
      where: { id: docId },
      data: {
        generationStatus: "SUPERSEDED",
        validationStatus: "SUPERSEDED",
        reviewStatus: "NOT_EXPORTABLE",
        reviewNotes: note,
      },
    });
    resultDetail = action === "SUPERSEDE_DUPLICATE" ? "superseded as duplicate" : "excluded as outside submission plan";
  }

  await logAction({
    userId: actor.id,
    action: "SUBMISSION_PLAN_ROW_ACTION",
    entityType: "GeneratedDocument",
    entityId: docId,
    description: `${actor.email} ${action} on "${doc.name}" — ${resultDetail}${note ? `: ${note}` : ""}`.slice(0, 500),
    metadata: { tenderId, docId, action, note: note || null },
    requestId,
  });

  return NextResponse.json({ success: true, action, detail: resultDetail });
}
