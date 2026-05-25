import { NextResponse } from "next/server";
import { getSession, requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { logAction } from "../../../../../lib/audit";

export const dynamic = "force-dynamic";

const VALID_OUTCOMES = new Set(["WON", "LOST", "WITHDRAWN", "PENDING"]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  const userId = actor.id;

  await prismaReady;
  const { id } = await params;

  const existing = await prisma.tender.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const outcome = typeof body.bidOutcome === "string" ? body.bidOutcome.toUpperCase() : null;

  if (outcome !== null && !VALID_OUTCOMES.has(outcome)) {
    return NextResponse.json(
      { error: `bidOutcome must be one of: ${[...VALID_OUTCOMES].join(", ")}` },
      { status: 400 }
    );
  }

  const note = typeof body.bidOutcomeNote === "string" ? body.bidOutcomeNote.trim() || null : null;

  const tender = await prisma.tender.update({
    where: { id },
    data: {
      bidOutcome: outcome,
      bidOutcomeNote: note,
      bidOutcomeAt: outcome ? new Date() : null,
    },
    select: {
      id: true, title: true, status: true, bidOutcome: true,
      bidOutcomeNote: true, bidOutcomeAt: true, updatedAt: true,
    },
  });

  await logAction({
    userId,
    action: "TENDER_BID_OUTCOME_SET",
    entityType: "Tender",
    entityId: id,
    description: `Bid outcome set to ${outcome ?? "cleared"} for "${existing.title}"${note ? ` — ${note}` : ""}`,
    metadata: { tenderId: id, bidOutcome: outcome, bidOutcomeNote: note },
  });

  return NextResponse.json({ success: true, tender });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prismaReady;
  const { id } = await params;

  const tender = await prisma.tender.findFirst({
    where: { id, userId },
    select: { id: true, title: true, bidOutcome: true, bidOutcomeNote: true, bidOutcomeAt: true },
  });

  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
  return NextResponse.json(tender);
}
