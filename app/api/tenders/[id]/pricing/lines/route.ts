// POST /api/tenders/[id]/pricing/lines  — add a single CostLine row
//
// Used by the pricing workbook UI when the user adds a new role / cost
// item. Computes total = quantity * rate server-side so the row is
// immediately consistent.

import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES = ["PERSONNEL", "REIMBURSABLE", "SUBCONSULTANT", "EQUIPMENT", "TRAVEL", "OTHER"];
const VALID_UNITS = ["DAY", "MONTH", "LUMP_SUM", "EACH", "KM"];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireUser(); } catch { return unauthorizedResponse(); }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();

  const rl = rateLimit(`pricing-lines:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  const { id } = await params;
  await prismaReady;
  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  let workbook = await prisma.pricingWorkbook.findUnique({ where: { tenderId: id }, select: { id: true } });
  if (!workbook) {
    workbook = await prisma.pricingWorkbook.create({ data: { tenderId: id }, select: { id: true } });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const num = (v: unknown, def = 0): number => Number.isFinite(Number(v)) ? Number(v) : def;
  const category = typeof body.category === "string" && VALID_CATEGORIES.includes(body.category) ? body.category : "OTHER";
  const unit = typeof body.unit === "string" && VALID_UNITS.includes(body.unit) ? body.unit : "DAY";
  const label = typeof body.label === "string" ? body.label.slice(0, 200) : "";
  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
  const quantity = Math.max(0, num(body.quantity, 1));
  const rate = Math.max(0, num(body.rate, 0));
  const total = quantity * rate;

  const line = await prisma.costLine.create({
    data: {
      workbookId: workbook.id,
      category,
      label,
      quantity,
      unit,
      rate,
      expertId: typeof body.expertId === "string" ? body.expertId : null,
      total,
      notes: typeof body.notes === "string" ? body.notes.slice(0, 500) : null,
    },
  });

  return NextResponse.json({ line });
}
