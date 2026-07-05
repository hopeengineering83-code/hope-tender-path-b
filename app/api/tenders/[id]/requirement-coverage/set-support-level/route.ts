import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { logAction } from "../../../../../../lib/audit";
import { extractRequestId } from "../../../../../../lib/request-id";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

type Body = {
  requirementId?: string;
  supportLevel?: string;
  notes?: string;
};

function normalizeSupportLevel(value: unknown): string {
  const normalized = String(value ?? "PARTIAL").toUpperCase();
  if (["FULL", "SUBSTANTIAL", "PARTIAL", "NONE", "NOT_APPLICABLE"].includes(normalized)) return normalized;
  return "PARTIAL";
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = extractRequestId(req);
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as Body;
  if (!body.requirementId) return NextResponse.json({ ok: false, error: "requirementId is required" }, { status: 400 });

  const supportLevel = normalizeSupportLevel(body.supportLevel);
  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
  if (!tender) return NextResponse.json({ ok: false, error: "Tender not found" }, { status: 404 });

  const requirement = await prisma.tenderRequirement.findFirst({ where: { id: body.requirementId, tenderId: id }, select: { id: true, title: true } });
  if (!requirement) return NextResponse.json({ ok: false, error: "Requirement not found for this tender" }, { status: 404 });

  const notes = body.notes ?? `Reviewer manually set coverage to ${supportLevel}.`;
  const existing = await prisma.complianceMatrix.findFirst({
    where: { tenderId: id, requirementId: requirement.id, evidenceType: "MANUAL_REVIEWER_CONFIRMATION" },
    select: { id: true },
  });

  const row = existing
    ? await prisma.complianceMatrix.update({ where: { id: existing.id }, data: { evidenceSource: "REVIEWER_CONFIRMED", evidenceReference: `manual-${supportLevel.toLowerCase()}`, supportLevel, notes, updatedAt: new Date() } })
    : await prisma.complianceMatrix.create({ data: { tenderId: id, requirementId: requirement.id, evidenceType: "MANUAL_REVIEWER_CONFIRMATION", evidenceSource: "REVIEWER_CONFIRMED", evidenceReference: `manual-${supportLevel.toLowerCase()}`, supportLevel, notes } });

  await logAction({
    userId: actor.id,
    action: "REQUIREMENT_SUPPORT_LEVEL_SET",
    entityType: "Tender",
    entityId: id,
    description: `Set requirement coverage to ${supportLevel}: ${requirement.title}`,
    metadata: { requirementId: requirement.id, complianceMatrixId: row.id, supportLevel },
    requestId,
  });

  return NextResponse.json({ ok: true, success: true, row, supportLevel });
}
