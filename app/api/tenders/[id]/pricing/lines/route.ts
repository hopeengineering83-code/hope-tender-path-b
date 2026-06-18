import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../../lib/prisma";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES = ["PERSONNEL", "REIMBURSABLE", "SUBCONSULTANT", "EQUIPMENT", "TRAVEL", "OTHER"];
const VALID_UNITS = ["DAY", "MONTH", "LUMP_SUM", "EACH", "KM"];
const MAX_QUANTITY = 1_000_000_000;
const MAX_RATE = 1_000_000_000_000;
const MAX_TOTAL = 1_000_000_000_000_000;

function boundedNumber(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(0, parsed));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();

  const rl = await rateLimitPersistent(`pricing-lines:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requests", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const { id } = await params;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });

  await prismaReady;
  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const expertId = typeof body.expertId === "string" && body.expertId.trim() ? body.expertId.trim() : null;
  if (expertId) {
    const ownedExpert = await prisma.expert.findFirst({
      where: { id: expertId, company: { userId: actor.id }, deletedAt: null },
      select: { id: true },
    });
    if (!ownedExpert) return NextResponse.json({ error: "Expert not found" }, { status: 404 });
  }

  let workbook = await prisma.pricingWorkbook.findUnique({ where: { tenderId: id }, select: { id: true } });
  if (!workbook) {
    workbook = await prisma.pricingWorkbook.create({ data: { tenderId: id }, select: { id: true } });
  }

  const category = typeof body.category === "string" && VALID_CATEGORIES.includes(body.category) ? body.category : "OTHER";
  const unit = typeof body.unit === "string" && VALID_UNITS.includes(body.unit) ? body.unit : "DAY";
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 200) : "";
  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });
  const quantity = boundedNumber(body.quantity, 1, MAX_QUANTITY);
  const rate = boundedNumber(body.rate, 0, MAX_RATE);
  const total = quantity * rate;
  if (!Number.isFinite(total) || total > MAX_TOTAL) {
    return NextResponse.json({ error: "Cost line total exceeds the permitted limit" }, { status: 400 });
  }

  const line = await prisma.costLine.create({
    data: {
      workbookId: workbook.id,
      category,
      label,
      quantity,
      unit,
      rate,
      expertId,
      total,
      notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 500) || null : null,
    },
  });

  return NextResponse.json({ line }, { status: 201 });
}
