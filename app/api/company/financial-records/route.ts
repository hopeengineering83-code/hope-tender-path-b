// GET  /api/company/financial-records — list all financial records
// POST /api/company/financial-records — create a new financial record
// DELETE /api/company/financial-records?id=<id> — delete a record
//
// Auth: ADMIN, PROPOSAL_MANAGER
// Rate: MUTATION_RATE_LIMIT

import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { rateLimit, MUTATION_RATE_LIMIT, API_RATE_LIMIT } from "../../../../lib/rate-limit";
import { sanitizeError } from "../../../../lib/sanitize-error";

export const dynamic = "force-dynamic";

function str(v: unknown, max = 300): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export async function GET(_req: Request) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const rl = rateLimit(`co-financial-get:${actor.id}`, API_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    await prismaReady;
    const company = await ensureCompanyForUser(prisma, actor.id);

    const records = await prisma.financialRecord.findMany({
      where: { companyId: company.id },
      select: { id: true, recordType: true, fiscalYear: true, currency: true, amount: true, createdAt: true },
      orderBy: [{ fiscalYear: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({ ok: true, records });
  } catch (error) {
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const rl = rateLimit(`co-financial-mut:${actor.id}`, MUTATION_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    await prismaReady;
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const recordType = str(body.recordType, 100);
    const fiscalYearRaw = Number(body.fiscalYear);
    if (!recordType) return NextResponse.json({ error: "recordType is required" }, { status: 400 });
    if (!Number.isInteger(fiscalYearRaw) || fiscalYearRaw < 1990 || fiscalYearRaw > 2100) {
      return NextResponse.json({ error: "fiscalYear must be a valid year (1990–2100)" }, { status: 400 });
    }

    const company = await ensureCompanyForUser(prisma, actor.id);

    const record = await prisma.financialRecord.create({
      data: {
        companyId: company.id,
        recordType,
        fiscalYear: fiscalYearRaw,
        currency: body.currency ? str(body.currency, 10) : "USD",
        amount: body.amount != null ? Number(body.amount) : null,
        notes: body.notes ? str(body.notes, 1000) : null,
      },
    });

    return NextResponse.json({ ok: true, record }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
    catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const rl = rateLimit(`co-financial-mut:${actor.id}`, MUTATION_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    await prismaReady;
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const company = await ensureCompanyForUser(prisma, actor.id);
    const existing = await prisma.financialRecord.findFirst({ where: { id, companyId: company.id } });
    if (!existing) return NextResponse.json({ error: "Record not found" }, { status: 404 });

    await prisma.financialRecord.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 });
  }
}
