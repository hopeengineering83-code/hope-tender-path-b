import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../../lib/prisma";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES = ["PERSONNEL", "REIMBURSABLE", "SUBCONSULTANT", "EQUIPMENT", "TRAVEL", "OTHER"];
const VALID_UNITS = ["DAY", "MONTH", "LUMP_SUM", "EACH", "KM"];
const MAX_QUANTITY = 1_000_000_000;
const MAX_RATE = 1_000_000_000_000;
const MAX_TOTAL = 1_000_000_000_000_000;

async function authoriseLine(actorId: string, tenderId: string, lineId: string) {
  await prismaReady;
  return prisma.costLine.findFirst({
    where: { id: lineId, workbook: { tenderId, tender: { userId: actorId } } },
  });
}

function boundedNumber(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(0, parsed));
}

async function mutationLimit(actorId: string) {
  const result = await rateLimitPersistent(`pricing-line:${actorId}`, MUTATION_RATE_LIMIT);
  if (result.allowed) return null;
  const retryAfter = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: "Too many requests", retryAfter },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();

  const limited = await mutationLimit(actor.id);
  if (limited) return limited;

  const { id, lineId } = await params;
  const existing = await authoriseLine(actor.id, id, lineId);
  if (!existing) return NextResponse.json({ error: "Cost line not found" }, { status: 404 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (typeof body.category === "string" && VALID_CATEGORIES.includes(body.category)) data.category = body.category;
  if (typeof body.label === "string") {
    const label = body.label.trim().slice(0, 200);
    if (!label) return NextResponse.json({ error: "label must not be empty" }, { status: 400 });
    data.label = label;
  }
  if (body.quantity !== undefined) data.quantity = boundedNumber(body.quantity, existing.quantity, MAX_QUANTITY);
  if (typeof body.unit === "string" && VALID_UNITS.includes(body.unit)) data.unit = body.unit;
  if (body.rate !== undefined) data.rate = boundedNumber(body.rate, existing.rate, MAX_RATE);
  if ("notes" in body) data.notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) || null : null;

  if ("expertId" in body) {
    const expertId = typeof body.expertId === "string" && body.expertId.trim() ? body.expertId.trim() : null;
    if (expertId) {
      const ownedExpert = await prisma.expert.findFirst({
        where: { id: expertId, company: { userId: actor.id }, deletedAt: null },
        select: { id: true },
      });
      if (!ownedExpert) return NextResponse.json({ error: "Expert not found" }, { status: 404 });
    }
    data.expertId = expertId;
  }

  const nextQty = (data.quantity as number | undefined) ?? existing.quantity;
  const nextRate = (data.rate as number | undefined) ?? existing.rate;
  const total = nextQty * nextRate;
  if (!Number.isFinite(total) || total > MAX_TOTAL) {
    return NextResponse.json({ error: "Cost line total exceeds the permitted limit" }, { status: 400 });
  }
  data.total = total;

  const line = await prisma.costLine.update({ where: { id: lineId }, data });
  return NextResponse.json({ line });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();

  const limited = await mutationLimit(actor.id);
  if (limited) return limited;

  const { id, lineId } = await params;
  const existing = await authoriseLine(actor.id, id, lineId);
  if (!existing) return NextResponse.json({ error: "Cost line not found" }, { status: 404 });

  await prisma.costLine.delete({ where: { id: lineId } });
  return NextResponse.json({ success: true });
}
