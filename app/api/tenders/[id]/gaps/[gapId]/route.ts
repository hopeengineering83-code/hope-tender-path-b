import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { logAction } from "../../../../../../lib/audit";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; gapId: string }> },
) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse();
  }

  const rl = await rateLimitPersistent(`gap-update:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requests", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  const { id: tenderId, gapId } = await params;

  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId: actor.id }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gap = await prisma.complianceGap.findFirst({ where: { id: gapId, tenderId } });
  if (!gap) return NextResponse.json({ error: "Gap not found" }, { status: 404 });

  const body = await req.json().catch(() => null) as { isResolved?: unknown; resolvedNote?: unknown; mitigationPlan?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  if (body.isResolved !== undefined && typeof body.isResolved !== "boolean") {
    return NextResponse.json({ error: "isResolved must be a boolean" }, { status: 400 });
  }
  if (body.resolvedNote !== undefined && typeof body.resolvedNote !== "string") {
    return NextResponse.json({ error: "resolvedNote must be a string" }, { status: 400 });
  }
  if (body.mitigationPlan !== undefined && typeof body.mitigationPlan !== "string") {
    return NextResponse.json({ error: "mitigationPlan must be a string" }, { status: 400 });
  }

  const resolvedNote = typeof body.resolvedNote === "string" ? body.resolvedNote.trim() : undefined;
  const mitigationPlan = typeof body.mitigationPlan === "string" ? body.mitigationPlan.trim() : undefined;
  if (resolvedNote && resolvedNote.length > 2_000) {
    return NextResponse.json({ error: "resolvedNote must be 2000 characters or fewer" }, { status: 400 });
  }
  if (mitigationPlan && mitigationPlan.length > 2_000) {
    return NextResponse.json({ error: "mitigationPlan must be 2000 characters or fewer" }, { status: 400 });
  }

  const updated = await prisma.complianceGap.update({
    where: { id: gapId },
    data: {
      isResolved: typeof body.isResolved === "boolean" ? body.isResolved : gap.isResolved,
      resolvedNote: resolvedNote !== undefined ? resolvedNote || null : gap.resolvedNote,
      mitigationPlan: mitigationPlan !== undefined ? mitigationPlan || null : gap.mitigationPlan,
      updatedAt: new Date(),
    },
  });

  await logAction({
    userId: actor.id,
    action: "UPDATE",
    entityType: "ComplianceGap",
    entityId: gapId,
    description: `${updated.isResolved ? "Resolved" : "Reopened"} compliance gap "${gap.title}"`,
    metadata: { tenderId },
  });

  return NextResponse.json(updated);
}
