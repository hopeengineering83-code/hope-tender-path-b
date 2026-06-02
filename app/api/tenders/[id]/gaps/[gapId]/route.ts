import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { logAction } from "../../../../../../lib/audit";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; gapId: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const rl = rateLimit(`gap-update:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  await prismaReady;
  const { id: tenderId, gapId } = await params;
  const userId = actor.id;

  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId } });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gap = await prisma.complianceGap.findFirst({ where: { id: gapId, tenderId } });
  if (!gap) return NextResponse.json({ error: "Gap not found" }, { status: 404 });

  const body = await req.json().catch(() => null) as { isResolved?: boolean; resolvedNote?: string; mitigationPlan?: string } | null;
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });

  if (body.resolvedNote !== undefined && typeof body.resolvedNote === "string" && body.resolvedNote.length > 2000) {
    return NextResponse.json({ error: "resolvedNote must be 2000 characters or fewer" }, { status: 400 });
  }
  if (body.mitigationPlan !== undefined && typeof body.mitigationPlan === "string" && body.mitigationPlan.length > 2000) {
    return NextResponse.json({ error: "mitigationPlan must be 2000 characters or fewer" }, { status: 400 });
  }

  const updated = await prisma.complianceGap.update({
    where: { id: gapId },
    data: {
      isResolved: body.isResolved !== undefined ? body.isResolved : gap.isResolved,
      resolvedNote: body.resolvedNote !== undefined ? body.resolvedNote : gap.resolvedNote,
      mitigationPlan: body.mitigationPlan !== undefined ? body.mitigationPlan : gap.mitigationPlan,
      updatedAt: new Date(),
    },
  });

  await logAction({
    userId,
    action: "UPDATE",
    entityType: "ComplianceGap",
    entityId: gapId,
    description: `${updated.isResolved ? "Resolved" : "Reopened"} compliance gap "${gap.title}"`,
  });

  return NextResponse.json(updated);
}
