// PATCH / DELETE /api/tenders/[id]/pricing/lines/[lineId]
// Updates or removes a single CostLine. Server recomputes `total`
// when quantity or rate changes so the row stays consistent.

import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../../lib/prisma";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES = ["PERSONNEL", "REIMBURSABLE", "SUBCONSULTANT", "EQUIPMENT", "TRAVEL", "OTHER"];
const VALID_UNITS = ["DAY", "MONTH", "LUMP_SUM", "EACH", "KM"];

async function authoriseLine(actorId: string, tenderId: string, lineId: string) {
  await prismaReady;
  const tender = await prisma.tender.findFirst({ where: { id: tenderId, userId: actorId }, select: { id: true } });
  if (!tender) return null;
  const line = await prisma.costLine.findFirst({
    where: { id: lineId, workbook: { tenderId } },
  });
  return line;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  let actor;
  try { actor = await requireUser(); } catch { return unauthorizedResponse(); }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();

  const rl = rateLimit(`pricing-line:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  const { id, lineId } = await params;
  const existing = await authoriseLine(actor.id, id, lineId);
  if (!existing) return NextResponse.json({ error: "Cost line not found" }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const num = (v: unknown, def: number) => Number.isFinite(Number(v)) ? Number(v) : def;

  const data: Record<string, unknown> = {};
  if (typeof body.category === "string" && VALID_CATEGORIES.includes(body.category)) data.category = body.category;
  if (typeof body.label === "string") data.label = body.label.slice(0, 200);
  if (body.quantity !== undefined) data.quantity = Math.max(0, num(body.quantity, existing.quantity));
  if (typeof body.unit === "string" && VALID_UNITS.includes(body.unit)) data.unit = body.unit;
  if (body.rate !== undefined) data.rate = Math.max(0, num(body.rate, existing.rate));
  if ("expertId" in body) data.expertId = typeof body.expertId === "string" ? body.expertId : null;
  if ("notes" in body) data.notes = typeof body.notes === "string" ? body.notes.slice(0, 500) : null;

  // Recompute total whenever quantity OR rate changed.
  const nextQty = (data.quantity as number | undefined) ?? existing.quantity;
  const nextRate = (data.rate as number | undefined) ?? existing.rate;
  data.total = nextQty * nextRate;

  const line = await prisma.costLine.update({ where: { id: lineId }, data });
  return NextResponse.json({ line });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; lineId: string }> }) {
  let actor;
  try { actor = await requireUser(); } catch { return unauthorizedResponse(); }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();

  const rl = rateLimit(`pricing-line:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  const { id, lineId } = await params;
  const existing = await authoriseLine(actor.id, id, lineId);
  if (!existing) return NextResponse.json({ error: "Cost line not found" }, { status: 404 });

  await prisma.costLine.delete({ where: { id: lineId } });
  return NextResponse.json({ success: true });
}
