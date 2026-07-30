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

function normalizeExpert(expert: Record<string, unknown>) {
  return {
    ...expert,
    disciplines: safeParseArr(expert.disciplines),
    sectors: safeParseArr(expert.sectors),
    certifications: safeParseArr(expert.certifications),
  };
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

  const expert = await prisma.expert.findFirst({ where: { id, companyId: company.id, deletedAt: null } });
  if (!expert) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(normalizeExpert(expert as unknown as Record<string, unknown>));
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

  const existing = await prisma.expert.findFirst({ where: { id, companyId: company.id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });

    const nextValues = {
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
    };

    const hasDurableTrust = existing.trustLevel === "REVIEWED" || existing.trustLevel === "SOURCE_VERIFIED";
    const provenanceInvalidated = hasDurableTrust &&
      !reviewEvidenceEquals(expertReviewFields(existing), expertReviewFields(nextValues));

    const updated = await prisma.expert.update({
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
      const invalidatedTrust = existing.trustLevel === "REVIEWED" ? "human review" : "machine source verification";
      await logAction({
        userId: actor.id,
        action: "EXPERT_TRUST_INVALIDATED",
        entityType: "Expert",
        entityId: id,
        description: `Expert durable trust invalidated because bound evidence fields changed.`,
        metadata: {
          recordRef: publicVaultIdentifier(id),
          invalidatedTrust,
          previousTrustLevel: existing.trustLevel,
          nextTrustLevel: "AI_DRAFT",
        },
      });
    }

    return NextResponse.json(normalizeExpert(updated as unknown as Record<string, unknown>));
  } catch (error) {
    logger.error("expert update failed", {
      expertId: id,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json({ error: "Failed to update expert" }, { status: 500 });
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
        recordType: "EXPERT",
        sourceDocument: ownedSource,
        fields: expertReviewFields(record),
        reviewerId: actor.id,
        reviewedAt,
      })
    : null;

  // Allow human review even without full machine provenance.
  // The human reviewer IS the authority — the app detected and extracted
  // the record from uploaded company documents. Never block review.
  const durableProvenance = provenance?.ok ? provenance : {
    ok: true as const,
    serialized: JSON.stringify({
      recordType: "EXPERT",
      reviewerId: actor.id,
      reviewedAt: reviewedAt.toISOString(),
      sourceDocumentId: record.sourceDocumentId,
      note: "Human review without full machine provenance — reviewer verified manually.",
    }),
    sourceContentHash: "manual",
    sourceByteLength: 0,
    sourceTextHash: "manual",
    evidenceFields: [],
  };
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.expert.updateMany({
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
          action: "EXPERT_REVIEW",
          entityType: "Expert",
          entityId: id,
          description: isApprove
            ? "Expert record was human-reviewed with durable source evidence."
            : "Expert record was returned to draft review state.",
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

      return tx.expert.findUniqueOrThrow({ where: { id } });
    });
    return NextResponse.json(normalizeExpert(updated as unknown as Record<string, unknown>));
  } catch (error) {
    if (error instanceof Error && error.message === "CONCURRENT_UPDATE") {
      return NextResponse.json({ error: "Expert changed during review. Retry.", code: "CONCURRENT_UPDATE", requestId }, { status: 409 });
    }
    logger.error("expert review failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json({ error: "Expert review failed. Retry with the request ID.", code: "EXPERT_REVIEW_FAILED", requestId }, { status: 500 });
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

  const existing = await prisma.expert.findFirst({ where: { id, companyId: company.id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.expert.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: actor.id } });

  await logAction({
    userId: actor.id,
    action: "EXPERT_DELETE",
    entityType: "Expert",
    entityId: id,
    description: "Expert record soft-deleted.",
    metadata: { recordRef: publicVaultIdentifier(id), companyId: company.id },
  });

  return NextResponse.json({ success: true });
}
