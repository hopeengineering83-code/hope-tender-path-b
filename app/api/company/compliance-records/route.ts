import { NextResponse } from "next/server";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../lib/auth";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { ensureCompanyForUser } from "../../../../lib/company-workspace";
import { rateLimit, MUTATION_RATE_LIMIT, API_RATE_LIMIT } from "../../../../lib/rate-limit";
import { extractRequestId } from "../../../../lib/request-id";
import { companyRecordRuntimeError } from "../../../../lib/company-record-route-error";
import { logAction } from "../../../../lib/audit";

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
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
    catch (error) { return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const rl = rateLimit(`co-compliance-get:${actor.id}`, API_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 });

    await prismaReady;
    const url = new URL(req.url);
    const page = parsePage(url.searchParams.get("page"));
    const limit = parseLimit(url.searchParams.get("limit"));
    const company = await ensureCompanyForUser(prisma, actor.id);
    const where = { companyId: company.id };
    const [records, total] = await prisma.$transaction([
      prisma.companyComplianceRecord.findMany({
      where,
      select: { id: true, complianceType: true, title: true, status: true, referenceNumber: true, expiryDate: true, trustLevel: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
      prisma.companyComplianceRecord.count({ where }),
    ]);
    return NextResponse.json({ ok: true, records, page, limit, total, hasMore: page * limit < total });
  } catch (error) {
    return companyRecordRuntimeError({
      route: "company compliance-records GET",
      code: "COMPLIANCE_RECORDS_RUNTIME_ERROR",
      message: "Compliance records could not be loaded.",
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

    const rl = rateLimit(`co-compliance-mut:${actor.id}`, MUTATION_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 });

    await prismaReady;
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 });

    const complianceType = str(body.complianceType, 100);
    const title = str(body.title, 300);
    if (!complianceType) return NextResponse.json({ error: "complianceType is required", code: "MISSING_COMPLIANCE_TYPE" }, { status: 400 });
    if (!title) return NextResponse.json({ error: "title is required", code: "MISSING_TITLE" }, { status: 400 });

    const company = await ensureCompanyForUser(prisma, actor.id);

    // Validate expiryDate before persistence. An invalid date string passed
    // to new Date() creates an Invalid Date object that Prisma may accept,
    // causing data integrity issues.
    let expiryDate: Date | null = null;
    if (body.expiryDate) {
      const parsed = new Date(String(body.expiryDate));
      if (isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: "expiryDate must be a valid date string", code: "INVALID_DATE", field: "expiryDate", requestId },
          { status: 400 },
        );
      }
      expiryDate = parsed;
    }

    let sourceDocumentId: string | null = null;
    if (typeof body.sourceDocumentId === "string" && body.sourceDocumentId.trim()) {
      const docId = body.sourceDocumentId.trim();
      const doc = await prisma.companyDocument.findFirst({ where: { id: docId, companyId: company.id }, select: { id: true } });
      if (!doc) return NextResponse.json({ error: "sourceDocumentId does not reference a document in your Company Vault." }, { status: 400 });
      sourceDocumentId = doc.id;
    }

    const record = await prisma.companyComplianceRecord.create({
      data: {
        companyId: company.id,
        complianceType,
        title,
        status: str(body.status, 50) || "ACTIVE",
        evidenceSummary: body.evidenceSummary ? str(body.evidenceSummary, 1000) : null,
        referenceNumber: body.referenceNumber ? str(body.referenceNumber, 100) : null,
        expiryDate,
        trustLevel: "REVIEWED",
        reviewedBy: actor.id,
        reviewedAt: new Date(),
        reviewNotes: "Manual compliance record created by authenticated user.",
        sourceDocumentId,
      },
    });
    await logAction({
      userId: actor.id,
      action: "COMPLIANCE_RECORD_CREATE",
      entityType: "CompanyComplianceRecord",
      entityId: record.id,
      description: `Compliance record "${record.title}" created`,
      metadata: { companyId: company.id },
    });
    return NextResponse.json({ ok: true, record }, { status: 201 });
  } catch (error) {
    return companyRecordRuntimeError({
      route: "company compliance-records POST",
      code: "COMPLIANCE_RECORDS_RUNTIME_ERROR",
      message: "Compliance record could not be saved.",
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

    const rl = rateLimit(`co-compliance-mut:${actor.id}`, MUTATION_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 });

    await prismaReady;
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required", code: "MISSING_ID" }, { status: 400 });

    const company = await ensureCompanyForUser(prisma, actor.id);
    const existing = await prisma.companyComplianceRecord.findFirst({ where: { id, companyId: company.id }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Record not found", code: "RECORD_NOT_FOUND" }, { status: 404 });

    await prisma.companyComplianceRecord.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return companyRecordRuntimeError({
      route: "company compliance-records DELETE",
      code: "COMPLIANCE_RECORDS_RUNTIME_ERROR",
      message: "Compliance record could not be deleted.",
      requestId,
      error,
    });
  }
}
