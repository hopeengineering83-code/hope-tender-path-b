import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { approveEvidenceDecision, invalidateEvidenceDecision, rejectEvidenceDecision } from "../../../../../../lib/engine/requirement-evidence";
import { extractRequestId } from "../../../../../../lib/request-id";
import { logger } from "../../../../../../lib/observability";

export const dynamic = "force-dynamic";

function safe(code: string, error: string, requestId: string, status: number) {
  return NextResponse.json({ ok: false, code, error, requestId }, { status });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; decisionId: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
  catch (error) { return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id: tenderId, decisionId } = await params;
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId: actor.id }, select: { id: true } });
  if (!tender) return safe("TENDER_NOT_FOUND", "Tender not found or not accessible.", requestId, 404);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "").toUpperCase();
    if (action === "APPROVE") {
      if (actor.role === "REVIEWER") return safe("EVIDENCE_APPROVAL_FORBIDDEN", "Reviewer may recommend evidence but cannot approve final evidence.", requestId, 403);
      const decision = await approveEvidenceDecision(tenderId, decisionId, { id: actor.id, role: actor.role });
      return NextResponse.json({ ok: true, decisionId: decision.id, status: decision.status });
    }
    if (action === "REJECT") {
      if (actor.role === "REVIEWER") return safe("EVIDENCE_REJECTION_FORBIDDEN", "Reviewer may recommend evidence but cannot reject final evidence.", requestId, 403);
      const decision = await rejectEvidenceDecision(tenderId, decisionId, { id: actor.id, role: actor.role });
      return NextResponse.json({ ok: true, decisionId: decision.id, status: decision.status });
    }
    if (action === "INVALIDATE") {
      if (actor.role === "REVIEWER") return safe("EVIDENCE_INVALIDATION_FORBIDDEN", "Reviewer may recommend evidence but cannot invalidate final evidence.", requestId, 403);
      const decision = await invalidateEvidenceDecision(tenderId, decisionId, String(body.reason ?? "Manual invalidation"));
      return NextResponse.json({ ok: true, decisionId: decision.id, status: decision.status });
    }
    return safe("EVIDENCE_ACTION_INVALID", "Use action APPROVE, REJECT, or INVALIDATE.", requestId, 400);
  } catch (error) {
    logger.error("[requirement-evidence:action] failed", { requestId, tenderId, decisionId, detail: error });
    return safe("EVIDENCE_ACTION_FAILED", "Evidence action failed. Re-check source and asset currency.", requestId, 422);
  }
}
