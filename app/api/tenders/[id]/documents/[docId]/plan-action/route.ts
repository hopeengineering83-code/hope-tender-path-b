import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../../lib/prisma";
import { logAction } from "../../../../../../../lib/audit";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../../../lib/request-id";
import { normalizeDocumentType, requiresOfficialOriginal, isControlDocument } from "../../../../../../../lib/engine/document-type-normalizer";
import { getCanonicalReadinessSummary } from "../../../../../../../lib/canonical-tender-readiness";

export const dynamic = "force-dynamic";

const PLAN_ACTIONS = ["RECLASSIFY_TO_PLAN", "MARK_NOT_EXPORTABLE", "SUPERSEDE_DUPLICATE", "EXCLUDE_OUTSIDE_PLAN"] as const;
type PlanAction = (typeof PLAN_ACTIONS)[number];
const NOTE_REQUIRED: ReadonlySet<PlanAction> = new Set(["MARK_NOT_EXPORTABLE", "SUPERSEDE_DUPLICATE", "EXCLUDE_OUTSIDE_PLAN"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const requestId = extractRequestId(req);
  const rl = await rateLimitPersistent(`plan-action:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Rate limit exceeded. Wait and retry.", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const { id: tenderId, docId } = await params;
  const body = await req.json().catch(() => null) as { action?: unknown; note?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });

  const action = String(body.action ?? "") as PlanAction;
  if (!PLAN_ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Invalid action", validActions: PLAN_ACTIONS }, { status: 400 });
  }
  const rawNote = typeof body.note === "string" ? body.note.trim() : "";
  if (NOTE_REQUIRED.has(action) && !rawNote) {
    return NextResponse.json({ error: "A short audit note is required for this action.", code: "NOTE_REQUIRED" }, { status: 400 });
  }
  const note = rawNote.slice(0, 500);

  await prismaReady;
  const doc = await prisma.generatedDocument.findFirst({
    where: { id: docId, tenderId, tender: { userId: actor.id } },
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

  // Gap 4: re-query the canonical final-export authority after the mutation.
  const canonicalReadiness = await getCanonicalReadinessSummary(prisma, actor.id, tenderId);
  return NextResponse.json({ success: true, action, detail: resultDetail, canonicalReadiness });
}
