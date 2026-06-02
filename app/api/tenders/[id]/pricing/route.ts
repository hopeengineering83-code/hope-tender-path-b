// Pricing workbook (G8 fix)
//
// GET /api/tenders/[id]/pricing
//   Returns the workbook + cost lines + computed totals for one tender.
//
// PUT /api/tenders/[id]/pricing
//   Upsert workbook header (currency, validity, taxes, contingency,
//   scenario, leakage flag, notes).
//
// POST /api/tenders/[id]/pricing/lines     — add a cost line
// PATCH /api/tenders/[id]/pricing/lines/[lineId] — update one
// DELETE /api/tenders/[id]/pricing/lines/[lineId] — delete one
//   (line endpoints in their own files)
//
// Totals are computed server-side (subtotal → contingency → withholding
// → VAT → grandTotal) so the UI never has to. The client may show its
// own real-time preview but the server is authoritative.

import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse, forbiddenResponse } from "../../../../../lib/auth";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { rateLimit, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";

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

  const subtotal = workbook.lines.reduce((s, l) => s + (l.total || (l.quantity || 0) * (l.rate || 0)), 0);
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
    lines: workbook.lines.map((l) => ({
      id: l.id, category: l.category, label: l.label, quantity: l.quantity, unit: l.unit,
      rate: l.rate, expertId: l.expertId, total: l.total, notes: l.notes,
    })),
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireUser(); } catch { return unauthorizedResponse(); }
  if (!["ADMIN", "PROPOSAL_MANAGER", "REVIEWER", "VIEWER"].includes(actor.role)) return forbiddenResponse();

  const { id } = await params;
  await prismaReady;
  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const workbook = await loadWorkbook(id);
  return NextResponse.json({ workbook });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let actor;
  try { actor = await requireUser(); } catch { return unauthorizedResponse(); }
  if (!["ADMIN", "PROPOSAL_MANAGER"].includes(actor.role)) return forbiddenResponse();

  const rl = rateLimit(`pricing:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests", retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000) }, { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } });

  const { id } = await params;
  await prismaReady;
  const tender = await prisma.tender.findFirst({ where: { id, userId: actor.id }, select: { id: true } });
  if (!tender) return NextResponse.json({ error: "Tender not found" }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const data: Record<string, unknown> = {};
  const num = (v: unknown, def = 0): number => Number.isFinite(Number(v)) ? Number(v) : def;
  if (typeof body.currency === "string") data.currency = body.currency.slice(0, 8);
  if (body.validityDays !== undefined) data.validityDays = Math.max(0, Math.floor(num(body.validityDays, 90)));
  if (body.vatPercent !== undefined) data.vatPercent = Math.max(0, num(body.vatPercent, 0));
  if (body.withholdingPct !== undefined) data.withholdingPct = Math.max(0, num(body.withholdingPct, 0));
  if (body.contingencyPct !== undefined) data.contingencyPct = Math.max(0, num(body.contingencyPct, 0));
  if (typeof body.scenario === "string" && ["AGGRESSIVE", "BALANCED", "CONSERVATIVE"].includes(body.scenario)) data.scenario = body.scenario;
  if (typeof body.noPriceLeakage === "boolean") data.noPriceLeakage = body.noPriceLeakage;
  if (typeof body.notes === "string") data.notes = body.notes.slice(0, 2000);

  const workbook = await prisma.pricingWorkbook.upsert({
    where: { tenderId: id },
    update: data,
    create: { tenderId: id, ...data },
  });

  return NextResponse.json({ workbook: await loadWorkbook(id) ?? workbook });
}
