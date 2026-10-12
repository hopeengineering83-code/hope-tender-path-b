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
    try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
    catch (error) { return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

    const rl = rateLimit(`co-legal-get:${actor.id}`, API_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 });

    await prismaReady;
    const url = new URL(req.url);
    const page = parsePage(url.searchParams.get("page"));
    const limit = parseLimit(url.searchParams.get("limit"));
    const company = await ensureCompanyForUser(prisma, actor.id);
    const where = { companyId: company.id };
    const [records, total] = await prisma.$transaction([
      prisma.legalRecord.findMany({
      where,
      select: { id: true, recordType: true, title: true, authority: true, referenceNumber: true, status: true, issueDate: true, expiryDate: true, trustLevel: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
      prisma.legalRecord.count({ where }),
    ]);
    return NextResponse.json({ ok: true, records, page, limit, total, hasMore: page * limit < total });
  } catch (error) {
    return companyRecordRuntimeError({
      route: "company legal-records GET",
      code: "LEGAL_RECORDS_RUNTIME_ERROR",
      message: "Legal records could not be loaded.",
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

    const rl = rateLimit(`co-legal-mut:${actor.id}`, MUTATION_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 });

    await prismaReady;
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid JSON body", code: "INVALID_JSON" }, { status: 400 });

    const recordType = str(body.recordType, 100);
    const title = str(body.title, 300);
    if (!recordType) return NextResponse.json({ error: "recordType is required", code: "MISSING_RECORD_TYPE" }, { status: 400 });
    if (!title) return NextResponse.json({ error: "title is required", code: "MISSING_TITLE" }, { status: 400 });

    const company = await ensureCompanyForUser(prisma, actor.id);

    // Validate issueDate and expiryDate before persistence.
    let issueDate: Date | null = null;
    let expiryDate: Date | null = null;
    if (body.issueDate) {
      const parsed = new Date(String(body.issueDate));
      if (isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: "issueDate must be a valid date string", code: "INVALID_DATE", field: "issueDate", requestId },
          { status: 400 },
        );
      }
      issueDate = parsed;
    }
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

    // Optional sourceDocumentId — traceable to the uploaded CompanyDocument
    // it was derived from, mirroring Expert/Project manual creation.
    let sourceDocumentId: string | null = null;
    if (typeof body.sourceDocumentId === "string" && body.sourceDocumentId.trim()) {
      const docId = body.sourceDocumentId.trim();
      const doc = await prisma.companyDocument.findFirst({ where: { id: docId, companyId: company.id }, select: { id: true } });
      if (!doc) return NextResponse.json({ error: "sourceDocumentId does not reference a document in your Company Vault." }, { status: 400 });
      sourceDocumentId = doc.id;
    }

    // Creation and evidence review are separate authority events. A manual
    // entry remains an explicit draft until a reviewer approves its current,
    // owned source bytes through the review route.
    const record = await prisma.legalRecord.create({
      data: {
        companyId: company.id,
        recordType,
        title,
        authority: body.authority ? str(body.authority, 200) : null,
        referenceNumber: body.referenceNumber ? str(body.referenceNumber, 100) : null,
        status: str(body.status, 50) || "ACTIVE",
        issueDate,
        expiryDate,
        ...manualSupportRecordDraftFields("LEGAL"),
        sourceDocumentId,
      },
    });
    await logAction({
      userId: actor.id,
      action: "LEGAL_RECORD_CREATE",
      entityType: "LegalRecord",
      entityId: record.id,
      description: `Legal record "${record.title}" created`,
      metadata: { companyId: company.id },
    });
    return NextResponse.json({ ok: true, record }, { status: 201 });
  } catch (error) {
    return companyRecordRuntimeError({
      route: "company legal-records POST",
      code: "LEGAL_RECORDS_RUNTIME_ERROR",
      message: "Legal record could not be saved.",
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

    const rl = rateLimit(`co-legal-mut:${actor.id}`, MUTATION_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429 });

    await prismaReady;
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required", code: "MISSING_ID" }, { status: 400 });

    const company = await ensureCompanyForUser(prisma, actor.id);
    const existing = await prisma.legalRecord.findFirst({ where: { id, companyId: company.id }, select: { id: true } });
    if (!existing) return NextResponse.json({ error: "Record not found", code: "RECORD_NOT_FOUND" }, { status: 404 });

    await prisma.legalRecord.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return companyRecordRuntimeError({
      route: "company legal-records DELETE",
      code: "LEGAL_RECORDS_RUNTIME_ERROR",
      message: "Legal record could not be deleted.",
      requestId,
      error,
    });
  }
}
