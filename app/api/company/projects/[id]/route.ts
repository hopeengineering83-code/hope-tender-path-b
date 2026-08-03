import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { logAction } from "../../../../../lib/audit";
import { extractRequestId } from "../../../../../lib/request-id";
import {
  buildReviewProvenance,
  projectReviewFields,
  publicVaultIdentifier,
  reviewEvidenceEquals,
} from "../../../../../lib/vault-review-provenance";

function toJsonArray(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.filter(Boolean));
  return JSON.stringify(
    String(value || "").split(",").map((item) => item.trim()).filter(Boolean),
  );
}

function safeParseArr(value: unknown): string[] {
  try { return JSON.parse(value as string) as string[]; } catch { return []; }
}

function normalizeProject(project: Record<string, unknown>) {
  return { ...project, serviceAreas: safeParseArr(project.serviceAreas) };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (error) { return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
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
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (error) { return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  await prismaReady;

  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { userId: actor.id } });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existing = await prisma.project.findFirst({ where: { id, companyId: company.id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });

    const nextValues = {
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
    };

    const hasDurableTrust = existing.trustLevel === "REVIEWED" || existing.trustLevel === "SOURCE_VERIFIED";
    const provenanceInvalidated = hasDurableTrust &&
      !reviewEvidenceEquals(projectReviewFields(existing), projectReviewFields(nextValues));

    const updated = await prisma.project.update({
      where: { id },
      data: {
        ...nextValues,
        ...(provenanceInvalidated
          ? {
              trustLevel: "AI_DRAFT",
              reviewedBy: null,
              reviewedAt: null,
              reviewNotes: null,
            }
          : {}),
        updatedAt: new Date(),
      },
    });

    if (provenanceInvalidated) {
      const invalidatedTrust = existing.trustLevel === "REVIEWED" ? "machine-verified review" : "source verification";
      await logAction({
        userId: actor.id,
        action: "PROJECT_TRUST_INVALIDATED",
        entityType: "Project",
        entityId: id,
        description: "Project durable trust invalidated because bound evidence fields changed.",
        metadata: {
          recordRef: publicVaultIdentifier(id),
          invalidatedTrust,
          previousTrustLevel: existing.trustLevel,
          nextTrustLevel: "AI_DRAFT",
        },
      });
    }

    return NextResponse.json(normalizeProject(updated as unknown as Record<string, unknown>));
  } catch (error) {
    logger.error("project update failed", {
      projectId: id,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
  catch (error) { return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

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

  const record = await prisma.project.findFirst({
    where: { id, companyId: company.id, deletedAt: null },
    select: {
      id: true,
      companyId: true,
      name: true,
      clientName: true,
      country: true,
      sector: true,
      serviceAreas: true,
      contractValue: true,
      currency: true,
      sourceDocumentId: true,
      sourceDocument: {
        select: {
          id: true,
          companyId: true,
          extractedText: true,
          contentSha256: true,
          contentByteLength: true,
          integrityStatus: true,
          metadata: true,
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
        recordType: "PROJECT",
        sourceDocument: ownedSource,
        fields: projectReviewFields(record),
        reviewerId: actor.id,
        reviewedAt,
      })
    : null;

  // Source-less auto-approval is forbidden (Gap 3). When no verified source
  // exists, the record stays UNVERIFIED — never REVIEWED, never reviewedBy,
  // never reviewedAt, never a fabricated "manual" hash. The user must upload
  // the source document so the Engine can source-verify it automatically.
  if (!provenance?.ok) {
    return NextResponse.json(
      { ok: false, error: "Cannot approve without a verified source document. Upload the source document so the Engine can source-verify it automatically.", code: "SOURCE_REQUIRED_FOR_APPROVAL" },
      { status: 422 },
    );
  }
  const durableProvenance = provenance;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.project.updateMany({
        where: { id, companyId: company.id, deletedAt: null },
        data: isApprove
          ? {
              trustLevel: "REVIEWED",
              reviewedBy: actor.id,
              reviewedAt,
              reviewNotes: durableProvenance!.serialized,
              updatedAt: new Date(),
            }
          : {
              trustLevel: "AI_DRAFT",
              reviewedBy: null,
              reviewedAt: null,
              reviewNotes: body.notes?.trim() || null,
              updatedAt: new Date(),
            },
      });
      if (result.count !== 1) throw new Error("CONCURRENT_UPDATE");

      await tx.auditLog.create({
        data: {
          userId: actor.id,
          action: "PROJECT_REVIEW",
          entityType: "Project",
          entityId: id,
          description: isApprove
            ? "Project record was reviewed and approved."
            : "Project record was returned to draft review state.",
          metadata: JSON.stringify({
            requestId,
            recordRef: publicVaultIdentifier(id),
            action: body.action,
            ...(isApprove ? { reviewerId: actor.id, reviewedAt: reviewedAt.toISOString() } : {}),
            ...(durableProvenance ? {
              sourceContentHash: durableProvenance.sourceContentHash,
              sourceByteLength: durableProvenance.sourceByteLength,
              sourceTextHash: durableProvenance.sourceTextHash,
              evidenceFields: durableProvenance.evidenceFields,
            } : {}),
          }),
        },
      });

      return tx.project.findUniqueOrThrow({ where: { id } });
    });
    return NextResponse.json(normalizeProject(updated as unknown as Record<string, unknown>));
  } catch (error) {
    if (error instanceof Error && error.message === "CONCURRENT_UPDATE") {
      return NextResponse.json({ error: "Project changed during review. Retry.", code: "CONCURRENT_UPDATE", requestId }, { status: 409 });
    }
    logger.error("project review failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json({ error: "Project review failed. Retry with the request ID.", code: "PROJECT_REVIEW_FAILED", requestId }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER"); }
  catch (error) { return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }

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
    description: "Project record soft-deleted.",
    metadata: { recordRef: publicVaultIdentifier(id), companyId: company.id },
  });

  return NextResponse.json({ success: true });
}
