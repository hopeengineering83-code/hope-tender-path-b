import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { logAction } from "../../../../../lib/audit";
import { extractRequestId } from "../../../../../lib/request-id";
import {
  buildReviewProvenance,
  expertReviewFields,
  publicVaultIdentifier,
} from "../../../../../lib/vault-review-provenance";

function toJsonArray(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.filter(Boolean));
  return JSON.stringify(
    String(value || "").split(",").map((v) => v.trim()).filter(Boolean)
  );
}

function safeParseArr(v: unknown): string[] {
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
}

function normalizeExpert(e: Record<string, unknown>) {
  return {
    ...e,
    disciplines: safeParseArr(e.disciplines),
    sectors: safeParseArr(e.sectors),
    certifications: safeParseArr(e.certifications),
  };
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

  const expert = await prisma.expert.findFirst({ where: { id, companyId: company.id, deletedAt: null } });
  if (!expert) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(normalizeExpert(expert as unknown as Record<string, unknown>));
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

  const existing = await prisma.expert.findFirst({ where: { id, companyId: company.id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    const updated = await prisma.expert.update({
      where: { id },
      data: {
        fullName: String(body.fullName ?? existing.fullName),
        title: body.title !== undefined ? (String(body.title) || null) : existing.title,
        email: body.email !== undefined ? (String(body.email) || null) : existing.email,
        phone: body.phone !== undefined ? (String(body.phone) || null) : existing.phone,
        yearsExperience: body.yearsExperience !== undefined
          ? (body.yearsExperience ? Number(body.yearsExperience) : null)
          : existing.yearsExperience,
        disciplines: body.disciplines !== undefined ? toJsonArray(body.disciplines) : existing.disciplines,
        sectors: body.sectors !== undefined ? toJsonArray(body.sectors) : existing.sectors,
        certifications: body.certifications !== undefined ? toJsonArray(body.certifications) : existing.certifications,
        profile: body.profile !== undefined ? (String(body.profile) || null) : existing.profile,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : existing.isActive,
        updatedAt: new Date(),
      },
    });
    return NextResponse.json(normalizeExpert(updated as unknown as Record<string, unknown>));
  } catch (error) {
    logger.error("Request failed", { detail: error });
    return NextResponse.json({ error: "Failed to update expert" }, { status: 500 });
  }
}

/**
 * PATCH — review an expert record.
 * Body: { action: "approve" | "reject", notes?: string }
 * Sets trustLevel to REVIEWED (approve) or back to the previous draft level (reject).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
  catch (e) { return e instanceof Error && e.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

  const requestId = extractRequestId(req);
  await prismaReady;
  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { userId: actor.id } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null) as { action?: string; notes?: string } | null;
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  if (!body.action || !["approve", "reject"].includes(body.action)) {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const record = await prisma.expert.findFirst({
    where: { id, companyId: company.id, deletedAt: null },
    select: {
      id: true,
      companyId: true,
      fullName: true,
      title: true,
      yearsExperience: true,
      disciplines: true,
      sectors: true,
      certifications: true,
      sourceDocumentId: true,
      sourceDocument: {
        select: {
          id: true,
          companyId: true,
          extractedText: true,
          contentSha256: true,
          contentByteLength: true,
          integrityStatus: true,
        },
      },
    },
  });
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isApprove = body.action === "approve";
  const reviewedAt = new Date();
  const ownedSource = record.sourceDocument?.companyId === company.id ? record.sourceDocument : null;
  const provenance = isApprove
    ? buildReviewProvenance({
        recordType: "EXPERT",
        sourceDocument: ownedSource,
        fields: expertReviewFields(record),
        reviewerId: actor.id,
        reviewedAt,
      })
    : null;

  if (provenance && !provenance.ok) {
    return NextResponse.json({
      error: "Expert approval requires durable source evidence.",
      code: provenance.code,
      missingEvidenceFields: provenance.missingFields.slice(0, 8),
      requestId,
    }, { status: 422 });
  }

  const durableProvenance = provenance?.ok ? provenance : null;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.expert.updateMany({
        where: { id, companyId: company.id, deletedAt: null },
        data: {
          trustLevel: isApprove ? "REVIEWED" : "AI_DRAFT",
          reviewedBy: actor.id,
          reviewedAt,
          reviewNotes: durableProvenance?.serialized ?? (body.notes?.trim() || null),
          updatedAt: new Date(),
        },
      });
      if (result.count !== 1) throw new Error("CONCURRENT_UPDATE");

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "EXPERT_REVIEW",
          entityType: "Expert",
          entityId: id,
          description: isApprove
            ? "Expert record reviewed with durable source evidence."
            : "Expert record returned to draft review state.",
          metadata: JSON.stringify({
            requestId,
            recordRef: publicVaultIdentifier(id),
            action: body.action,
            reviewedAt: reviewedAt.toISOString(),
            ...(durableProvenance ? {
              sourceContentHash: durableProvenance.sourceContentHash,
              sourceByteLength: durableProvenance.sourceByteLength,
              sourceTextHash: durableProvenance.sourceTextHash,
              evidenceFields: durableProvenance.evidenceFields,
            } : {}),
          }),
        },
      });

      return tx.expert.findUniqueOrThrow({ where: { id } });
    });
    return NextResponse.json(normalizeExpert(updated as unknown as Record<string, unknown>));
  } catch (error) {
    if (error instanceof Error && error.message === "CONCURRENT_UPDATE") {
      return NextResponse.json({ error: "Expert changed during review. Retry.", code: "CONCURRENT_UPDATE", requestId }, { status: 409 });
    }
    logger.error("expert review failed", { requestId, errorClass: error instanceof Error ? error.constructor.name : "UnknownError" });
    return NextResponse.json({ error: "Expert review failed. Retry with the request ID.", code: "EXPERT_REVIEW_FAILED", requestId }, { status: 500 });
  }
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

  const existing = await prisma.expert.findFirst({ where: { id, companyId: company.id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.expert.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: actor.id } });

  await logAction({
    userId: actor.id,
    action: "EXPERT_DELETE",
    entityType: "Expert",
    entityId: id,
    description: `Expert "${existing.fullName}" soft-deleted`,
    metadata: { expertId: id, fullName: existing.fullName, companyId: company.id },
  });

  return NextResponse.json({ success: true });
}
