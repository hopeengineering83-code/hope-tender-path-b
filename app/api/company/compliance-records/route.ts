// GET  /api/company/compliance-records — list all compliance records
// POST /api/company/compliance-records — create a new compliance record
// DELETE /api/company/compliance-records?id=<id> — delete a record
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

    const rl = rateLimit(`co-compliance-get:${actor.id}`, API_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    await prismaReady;
    const company = await ensureCompanyForUser(prisma, actor.id);

    const records = await prisma.companyComplianceRecord.findMany({
      where: { companyId: company.id },
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

    const rl = rateLimit(`co-compliance-mut:${actor.id}`, MUTATION_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    await prismaReady;
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

    const complianceType = str(body.complianceType, 100);
    const title = str(body.title, 300);
    if (!complianceType) return NextResponse.json({ error: "complianceType is required" }, { status: 400 });
    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

    const company = await ensureCompanyForUser(prisma, actor.id);

    const record = await prisma.companyComplianceRecord.create({
      data: {
        companyId: company.id,
        complianceType,
        title,
        status: str(body.status, 50) || "ACTIVE",
        evidenceSummary: body.evidenceSummary ? str(body.evidenceSummary, 1000) : null,
        referenceNumber: body.referenceNumber ? str(body.referenceNumber, 100) : null,
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

    const rl = rateLimit(`co-compliance-mut:${actor.id}`, MUTATION_RATE_LIMIT);
    if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

    await prismaReady;
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const company = await ensureCompanyForUser(prisma, actor.id);
    const existing = await prisma.companyComplianceRecord.findFirst({ where: { id, companyId: company.id } });
    if (!existing) return NextResponse.json({ error: "Record not found" }, { status: 404 });

    await prisma.companyComplianceRecord.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: sanitizeError(error) }, { status: 500 });
  }
}
