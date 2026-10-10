import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { rateLimit, MUTATION_RATE_LIMIT, API_RATE_LIMIT } from "../../../../lib/rate-limit";
import { extractRequestId } from "../../../../lib/request-id";
import { companyRecordRuntimeError } from "../../../../lib/company-record-route-error";
import { logAction } from "../../../../lib/audit";
import { manualSupportRecordDraftFields } from "../../../../lib/vault-review-inbox";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function parseBoundedInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function parsePage(value: string | null): number {
  return parseBoundedInt(value, 1);
}

function parseLimit(value: string | null): number {
  return Math.min(parseBoundedInt(value, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
}

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
    const url = new URL(req.url);
    const page = parsePage(url.searchParams.get("page"));
    const limit = parseLimit(url.searchParams.get("limit"));
    const company = await ensureCompanyForUser(prisma, actor.id);
    const where = { companyId: company.id };
    const [records, total] = await prisma.$transaction([
      prisma.financialRecord.findMany({
        where,
        select: { id: true, recordType: true, fiscalYear: true, currency: true, amount: true, trustLevel: true, createdAt: true },
        orderBy: [{ fiscalYear: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.financialRecord.count({ where }),
    ]);
    return NextResponse.json({ ok: true, records, page, limit, total, hasMore: page * limit < total });
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

    let sourceDocumentId: string | null = null;
    if (typeof body.sourceDocumentId === "string" && body.sourceDocumentId.trim()) {
      const docId = body.sourceDocumentId.trim();
      const doc = await prisma.companyDocument.findFirst({ where: { id: docId, companyId: company.id }, select: { id: true } });
      if (!doc) return NextResponse.json({ error: "sourceDocumentId does not reference a document in your Company Vault." }, { status: 400 });
      sourceDocumentId = doc.id;
    }

    const record = await prisma.financialRecord.create({
      data: {
        companyId: company.id,
        recordType,
        fiscalYear,
        currency: body.currency ? str(body.currency, 10) : null,
        amount,
        notes: body.notes ? str(body.notes, 1000) : null,
        ...manualSupportRecordDraftFields("FINANCIAL"),
        sourceDocumentId,
      },
    });
    await logAction({
      userId: actor.id,
      action: "FINANCIAL_RECORD_CREATE",
      entityType: "FinancialRecord",
      entityId: record.id,
      description: `Financial record "${record.recordType}" ${record.fiscalYear} created`,
      metadata: { companyId: company.id },
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
