import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { logAction } from "../../../../../lib/audit";

function toJsonArray(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.filter(Boolean));
  return JSON.stringify(
    String(value || "").split(",").map((v) => v.trim()).filter(Boolean)
  );
}

function safeParseArr(v: unknown): string[] {
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
}

function normalizeProject(p: Record<string, unknown>) {
  return { ...p, serviceAreas: safeParseArr(p.serviceAreas) };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  await prismaReady;

  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { userId: actor.id } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const project = await prisma.project.findFirst({ where: { id, companyId: company.id, deletedAt: null } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(normalizeProject(project as unknown as Record<string, unknown>));
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Company knowledge mutations require ADMIN or PROPOSAL_MANAGER — REVIEWER
  // and VIEWER are read-only roles (per lib/security/rbac.ts COMPANY_KNOWLEDGE_MGMT).
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  await prismaReady;

  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { userId: actor.id } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existing = await prisma.project.findFirst({ where: { id, companyId: company.id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    const updated = await prisma.project.update({
      where: { id },
      data: {
        name: String(body.name ?? existing.name),
        clientName: body.clientName !== undefined ? (String(body.clientName) || null) : existing.clientName,
        country: body.country !== undefined ? (String(body.country) || null) : existing.country,
        sector: body.sector !== undefined ? (String(body.sector) || null) : existing.sector,
        serviceAreas: body.serviceAreas !== undefined ? toJsonArray(body.serviceAreas) : existing.serviceAreas,
        summary: body.summary !== undefined ? (String(body.summary) || null) : existing.summary,
        contractValue: body.contractValue !== undefined
          ? (body.contractValue ? Number(body.contractValue) : null)
          : existing.contractValue,
        currency: body.currency !== undefined ? (String(body.currency) || null) : existing.currency,
        updatedAt: new Date(),
      },
    });
    return NextResponse.json(normalizeProject(updated as unknown as Record<string, unknown>));
  } catch (error) {
    logger.error("Request failed", { detail: error });
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

/**
 * PATCH — review a project record.
 * Body: { action: "approve" | "reject", notes?: string }
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { userId: actor.id } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existing = await prisma.project.findFirst({ where: { id, companyId: company.id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null) as { action?: string; notes?: string } | null;
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  if (!body.action || !["approve", "reject"].includes(body.action)) {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const isApprove = body.action === "approve";
  const reviewedAt = new Date();

  // Build durable provenance for the review action (same as batch endpoint).
  let reviewNotes = body.notes ?? null;
  if (isApprove) {
    const fullRecord = await prisma.project.findFirst({
      where: { id, companyId: company.id, deletedAt: null },
      include: { sourceDocument: { select: { id: true, companyId: true, extractedText: true, originalFileName: true } } },
    });
    if (fullRecord) {
      const { buildReviewProvenance, projectReviewFields } = await import("../../../../../lib/vault-review-provenance");
      const ownedSource = fullRecord.sourceDocument?.companyId === company.id ? fullRecord.sourceDocument : null;
      const provenance = buildReviewProvenance({
        recordType: "PROJECT",
        sourceDocument: ownedSource,
        fields: projectReviewFields(fullRecord),
        reviewerId: actor.id,
        reviewedAt,
      });
      if (provenance.ok) {
        reviewNotes = provenance.serialized;
      }
    }
  }

  const updated = await prisma.project.update({
    where: { id },
    data: {
      trustLevel: isApprove ? "REVIEWED" : "AI_DRAFT",
      reviewedBy: actor.id,
      reviewedAt,
      reviewNotes,
      updatedAt: new Date(),
    },
  });

  await logAction({
    userId: actor.id,
    action: "PROJECT_REVIEW",
    entityType: "Project",
    entityId: id,
    description: `Project "${existing.name}" ${isApprove ? "approved" : "rejected"}${body.notes ? ` — ${body.notes}` : ""}`,
    metadata: { projectId: id, action: body.action },
  });

  return NextResponse.json(normalizeProject(updated as unknown as Record<string, unknown>));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  await prismaReady;
  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { userId: actor.id } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existing = await prisma.project.findFirst({ where: { id, companyId: company.id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.project.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: actor.id } });

  await logAction({
    userId: actor.id,
    action: "PROJECT_DELETE",
    entityType: "Project",
    entityId: id,
    description: `Project "${existing.name}" soft-deleted`,
    metadata: { projectId: id, name: existing.name, companyId: company.id },
  });

  return NextResponse.json({ success: true });
}
