// GET  /api/company/legal-records — list all legal records
// POST /api/company/legal-records — create a new legal record
// DELETE /api/company/legal-records?id=<id> — delete a record
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

    const rl = rateLimit(`co-legal-get:${actor.id}`, API_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    await prismaReady;
    const company = await ensureCompanyForUser(prisma, actor.id);

    const records = await prisma.legalRecord.findMany({
      where: { companyId: company.id },
      select: { id: true, recordType: true, title: true, authority: true, referenceNumber: true, status: true, issueDate: true, expiryDate: true, createdAt: true },
      orderBy: { createdAt: "desc" },
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

    const rl = rateLimit(`co-legal-mut:${actor.id}`, MUTATION_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    await prismaReady;
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const recordType = str(body.recordType, 100);
    const title = str(body.title, 300);
    if (!recordType) return NextResponse.json({ error: "recordType is required" }, { status: 400 });
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

    const company = await ensureCompanyForUser(prisma, actor.id);

    const record = await prisma.legalRecord.create({
      data: {
        companyId: company.id,
        recordType,
        title,
        authority: body.authority ? str(body.authority, 200) : null,
        referenceNumber: body.referenceNumber ? str(body.referenceNumber, 100) : null,
        status: str(body.status, 50) || "ACTIVE",
        issueDate: body.issueDate ? new Date(String(body.issueDate)) : null,
        expiryDate: body.expiryDate ? new Date(String(body.expiryDate)) : null,
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

    const rl = rateLimit(`co-legal-mut:${actor.id}`, MUTATION_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    await prismaReady;
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const company = await ensureCompanyForUser(prisma, actor.id);
    const existing = await prisma.legalRecord.findFirst({ where: { id, companyId: company.id } });
    if (!existing) return NextResponse.json({ error: "Record not found" }, { status: 404 });

    await prisma.legalRecord.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 });
  }
}
