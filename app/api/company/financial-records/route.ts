import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { rateLimit, MUTATION_RATE_LIMIT, API_RATE_LIMIT } from "../../../../lib/rate-limit";
import { extractRequestId } from "../../../../lib/request-id";
import { companyRecordRuntimeError } from "../../../../lib/company-record-route-error";

export const dynamic = "force-dynamic";

function str(value: unknown, max = 300): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export async function GET(req: Request) {
  const requestId = extractRequestId(req);
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
    catch (error) { return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const rl = rateLimit(`co-financial-get:${actor.id}`, API_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 });

    await prismaReady;
    const company = await ensureCompanyForUser(prisma, actor.id);
    const records = await prisma.financialRecord.findMany({
      where: { companyId: company.id },
      select: { id: true, recordType: true, fiscalYear: true, currency: true, amount: true, createdAt: true },
      orderBy: [{ fiscalYear: "desc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ ok: true, records });
  } catch (error) {
    return companyRecordRuntimeError({
      route: "company financial-records GET",
      code: "FINANCIAL_RECORDS_RUNTIME_ERROR",
      message: "Financial records could not be loaded.",
      requestId,
      error,
    });
  }
}

export async function POST(req: Request) {
  const requestId = extractRequestId(req);
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
    catch (error) { return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const rl = rateLimit(`co-financial-mut:${actor.id}`, MUTATION_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 });

    await prismaReady;
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 });

    const recordType = str(body.recordType, 100);
    const fiscalYear = Number(body.fiscalYear);
    if (!recordType) return NextResponse.json({ error: "recordType is required", code: "MISSING_RECORD_TYPE" }, { status: 400 });
    if (!Number.isInteger(fiscalYear) || fiscalYear < 1990 || fiscalYear > 2100) {
      return NextResponse.json({ error: "fiscalYear must be a valid year (1990–2100)", code: "INVALID_FISCAL_YEAR" }, { status: 400 });
    }

    const amount = body.amount == null ? null : Number(body.amount);
    if (amount !== null && !Number.isFinite(amount)) {
      return NextResponse.json({ error: "amount must be a valid number", code: "INVALID_AMOUNT" }, { status: 400 });
    }

    const company = await ensureCompanyForUser(prisma, actor.id);
    const record = await prisma.financialRecord.create({
      data: {
        companyId: company.id,
        recordType,
        fiscalYear,
        currency: body.currency ? str(body.currency, 10) : null,
        amount,
        notes: body.notes ? str(body.notes, 1000) : null,
      },
    });
    return NextResponse.json({ ok: true, record }, { status: 201 });
  } catch (error) {
    return companyRecordRuntimeError({
      route: "company financial-records POST",
      code: "FINANCIAL_RECORDS_RUNTIME_ERROR",
      message: "Financial record could not be saved.",
      requestId,
      error,
    });
  }
}

export async function DELETE(req: Request) {
  const requestId = extractRequestId(req);
  try {
    let actor;
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
    catch (error) { return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const rl = rateLimit(`co-financial-mut:${actor.id}`, MUTATION_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 });

    await prismaReady;
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required", code: "MISSING_ID" }, { status: 400 });

    const company = await ensureCompanyForUser(prisma, actor.id);
    const existing = await prisma.financialRecord.findFirst({ where: { id, companyId: company.id }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Record not found", code: "RECORD_NOT_FOUND" }, { status: 404 });

    await prisma.financialRecord.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return companyRecordRuntimeError({
      route: "company financial-records DELETE",
      code: "FINANCIAL_RECORDS_RUNTIME_ERROR",
      message: "Financial record could not be deleted.",
      requestId,
      error,
    });
  }
}
