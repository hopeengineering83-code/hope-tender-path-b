import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { logAction } from "../../../../../../lib/audit";
import { extractRequestId } from "../../../../../../lib/request-id";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

type Body = {
  requirementId?: string;
  evidenceType?: string;
  evidenceId?: string;
  evidenceReference?: string;
  reason?: string;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as Body;
  if (!body.requirementId) return NextResponse.json({ ok: false, error: "requirementId is required" }, { status: 400 });

  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
  if (!tender) return NextResponse.json({ ok: false, error: "Tender not found" }, { status: 404 });

  const requirement = await prisma.tenderRequirement.findFirst({ where: { id: body.requirementId, tenderId: id }, select: { id: true, title: true } });
  if (!requirement) return NextResponse.json({ ok: false, error: "Requirement not found for this tender" }, { status: 404 });

  const evidenceType = String(body.evidenceType ?? "UNKNOWN").toUpperCase();
  const evidenceReference = String(body.evidenceReference ?? body.evidenceId ?? "").trim();
  const reason = String(body.reason ?? "Rejected by reviewer; not safe to use as confirmed evidence.").trim();

  await logAction({
    userId: actor.id,
    action: "REQUIREMENT_EVIDENCE_SUGGESTION_REJECTED",
    entityType: "Tender",
    entityId: id,
    description: `Rejected suggested ${evidenceType.toLowerCase()} evidence for requirement: ${requirement.title}`,
    metadata: { requirementId: requirement.id, evidenceType, evidenceId: body.evidenceId ?? null, evidenceReference, reason },
    requestId,
  });

  return NextResponse.json({ ok: true, success: true, rejected: { requirementId: requirement.id, evidenceType, evidenceReference, reason } });
}
