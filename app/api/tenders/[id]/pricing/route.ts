import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

type WorkbookSummary = {
  id: string;
  tenderId: string;
  currency: string;
  validityDays: number;
  vatPercent: number;
  withholdingPct: number;
  contingencyPct: number;
  scenario: string;
  noPriceLeakage: boolean;
  notes: string | null;
  totals: {
    subtotal: number;
    contingency: number;
    withholding: number;
    vat: number;
    grandTotal: number;
    lineCount: number;
  };
  lines: Array<{ id: string; category: string; label: string; quantity: number; unit: string; rate: number; expertId: string | null; total: number; notes: string | null }>;
};

async function loadWorkbook(tenderId: string): Promise<WorkbookSummary | null> {
  await prismaReady;
  const workbook = await prisma.pricingWorkbook.findUnique({
    where: { tenderId },
    include: { lines: { orderBy: { createdAt: "asc" } } },
  });
  if (!workbook) return null;

  const subtotal = workbook.lines.reduce((sum, line) => sum + (line.total || (line.quantity || 0) * (line.rate || 0)), 0);
  const contingency = subtotal * (workbook.contingencyPct / 100);
  const withholding = (subtotal + contingency) * (workbook.withholdingPct / 100);
  const vat = (subtotal + contingency) * (workbook.vatPercent / 100);
  const grandTotal = subtotal + contingency + vat - withholding;

  return {
    id: workbook.id,
    tenderId: workbook.tenderId,
    currency: workbook.currency,
    validityDays: workbook.validityDays,
    vatPercent: workbook.vatPercent,
    withholdingPct: workbook.withholdingPct,
    contingencyPct: workbook.contingencyPct,
    scenario: workbook.scenario,
    noPriceLeakage: workbook.noPriceLeakage,
    notes: workbook.notes,
    totals: { subtotal, contingency, withholding, vat, grandTotal, lineCount: workbook.lines.length },
    lines: workbook.lines.map((line) => ({
      id: line.id,
      category: line.category,
      label: line.label,
      quantity: line.quantity,
      unit: line.unit,
      rate: line.rate,
      expertId: line.expertId,
      total: line.total,
      notes: line.notes,
    })),
  };
}

function boundedNumber(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(0, parsed));
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER"].includes(actor.role)) return forbiddenResponse();

  const { id } = await params;
  await prismaReady;
  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  return NextResponse.json({ workbook: await loadWorkbook(id) });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try {
    actor = await requireUser();
  } catch {
    return unauthorizedResponse();
  }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();

  const rl = await rateLimitPersistent(`pricing:${actor.id}`, MUTATION_RATE_LIMIT);
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

  const data: Record<string, unknown> = {};
  if (typeof body.currency === "string") {
    const currency = body.currency.trim().toUpperCase();
    if (!/^[A-Z]{3,8}$/.test(currency)) return NextResponse.json({ error: "currency must contain 3 to 8 letters" }, { status: 400 });
    data.currency = currency;
  }
  if (body.validityDays !== undefined) data.validityDays = Math.floor(boundedNumber(body.validityDays, 90, 3_650));
  if (body.vatPercent !== undefined) data.vatPercent = boundedNumber(body.vatPercent, 0, 100);
  if (body.withholdingPct !== undefined) data.withholdingPct = boundedNumber(body.withholdingPct, 0, 100);
  if (body.contingencyPct !== undefined) data.contingencyPct = boundedNumber(body.contingencyPct, 0, 100);
  if (typeof body.scenario === "string" && ["AGGRESSIVE", "BALANCED", "CONSERVATIVE"].includes(body.scenario)) data.scenario = body.scenario;
  if (typeof body.noPriceLeakage === "boolean") data.noPriceLeakage = body.noPriceLeakage;
  if (typeof body.notes === "string") data.notes = body.notes.trim().slice(0, 2_000) || null;

  const workbook = await prisma.pricingWorkbook.upsert({
    where: { tenderId: id },
    update: data,
    create: { tenderId: id, ...data },
  });

  return NextResponse.json({ workbook: await loadWorkbook(id) ?? workbook });
}
