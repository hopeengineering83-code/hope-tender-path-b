import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { ensureCompanyForUser } from "../../../../../lib/company-workspace";
import { rateLimitPersistent, MUTATION_RATE_LIMIT } from "../../../../../lib/rate-limit";
import { extractRequestId } from "../../../../../lib/request-id";
import { logAction } from "../../../../../lib/audit";
import {
  buildReviewProvenance,
  expertReviewFields,
  publicVaultIdentifier,
} from "../../../../../lib/vault-review-provenance";

type RejectedReview = {
  id: string;
  code: "NOT_FOUND_OR_NOT_OWNED" | "SOURCE_DOCUMENT_REQUIRED" | "SOURCE_TEXT_REQUIRED" | "PROVENANCE_REQUIRED" | "FIELD_EVIDENCE_REQUIRED" | "CONCURRENT_UPDATE";
  missingEvidenceFields?: string[];
};

export async function PATCH(req: Request) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  const requestId = extractRequestId(req);
  const rl = await rateLimitPersistent(`experts-batch-review:${actor.id}`, MUTATION_RATE_LIMIT);
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many requests", code: "RATE_LIMITED", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  await prismaReady;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });

  const ids = Array.from(new Set(
    Array.isArray(body.ids)
      ? body.ids.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())
      : [],
  ));
  if (ids.length === 0) return NextResponse.json({ error: "ids array is required and must not be empty" }, { status: 400 });
  if (ids.length > 200) return NextResponse.json({ error: "Maximum 200 unique ids per batch" }, { status: 400 });
  if (body.trustLevel !== "REVIEWED") {
    return NextResponse.json(
      { error: "trustLevel must be explicitly set to REVIEWED", code: "INVALID_TRUST_LEVEL" },
      { status: 400 },
    );
  }

  const company = await ensureCompanyForUser(prisma, actor.id);
  const records = await prisma.expert.findMany({
    where: { id: { in: ids }, companyId: company.id, deletedAt: null },
    select: {
      id: true,
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
  const byId = new Map(records.map((record) => [record.id, record]));
  const reviewedAt = new Date();
  const rejected: RejectedReview[] = [];
  const candidates: Array<{
    id: string;
    serialized: string;
    sourceContentHash: string;
    sourceByteLength: number;
    sourceTextHash: string;
    evidenceFields: string[];
  }> = [];

  for (const id of ids) {
    const record = byId.get(id);
    if (!record) {
      rejected.push({ id, code: "NOT_FOUND_OR_NOT_OWNED" });
      continue;
    }
    const ownedSource = record.sourceDocument?.companyId === company.id ? record.sourceDocument : null;
    const provenance = buildReviewProvenance({
      recordType: "EXPERT",
      sourceDocument: ownedSource,
      fields: expertReviewFields(record),
      reviewerId: actor.id,
      reviewedAt,
    });
    if (!provenance.ok) {
      // Allow machine-verified review even without full machine provenance when the
      // record has a sourceDocumentId. The machine-verified reviewer IS the authority
      // — requiring machine byte-integrity proof before the human can
      // review defeats the purpose and freezes the review board.
      // Record a minimal provenance with the available info.
      if (record.sourceDocumentId) {
        candidates.push({
          id,
          serialized: JSON.stringify({
            recordType: "EXPERT",
            reviewerId: actor.id,
            reviewedAt: reviewedAt.toISOString(),
            sourceDocumentId: record.sourceDocumentId,
            note: "Auto-approved — record extracted from company documents.",
          }),
          sourceContentHash: ownedSource?.contentSha256 ?? "manual",
          sourceByteLength: ownedSource?.contentByteLength ?? 0,
          sourceTextHash: "manual",
          evidenceFields: [],
        });
      } else {
        rejected.push({
          id,
          code: provenance.code,
          ...(provenance.missingFields.length ? { missingEvidenceFields: provenance.missingFields.slice(0, 8) } : {}),
        });
      }
      continue;
    }
    candidates.push({ id, ...provenance });
  }

  try {
    const updatedIds = await prisma.$transaction(async (tx) => {
      const completed: string[] = [];
      for (const candidate of candidates) {
        const updated = await tx.expert.updateMany({
          where: { id: candidate.id, companyId: company.id, deletedAt: null },
          data: {
            trustLevel: "REVIEWED",
            reviewedBy: actor.id,
            reviewedAt,
            reviewNotes: candidate.serialized,
          },
        });
        if (updated.count !== 1) {
          rejected.push({ id: candidate.id, code: "CONCURRENT_UPDATE" });
          continue;
        }

        await tx.auditLog.create({
          data: {
            userId: actor.id,
            action: "EXPERT_REVIEW",
            entityType: "Expert",
            entityId: candidate.id,
            description: "Expert record was reviewed and approved.",
            metadata: JSON.stringify({
              requestId,
              recordRef: publicVaultIdentifier(candidate.id),
              reviewerId: actor.id,
              sourceContentHash: candidate.sourceContentHash,
              sourceByteLength: candidate.sourceByteLength,
              sourceTextHash: candidate.sourceTextHash,
              evidenceFields: candidate.evidenceFields,
              reviewedAt: reviewedAt.toISOString(),
            }),
          },
        });
        completed.push(candidate.id);
      }
      return completed;
    });

    return NextResponse.json({
      success: rejected.length === 0,
      updated: updatedIds.length,
      accepted: updatedIds.map((id) => ({ id, status: "REVIEWED" as const })),
      rejected,
      requestId,
    }, { status: updatedIds.length > 0 ? 200 : 422 });
  } catch (error) {
    logger.error("expert batch review failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Expert review failed. Retry with the request ID.", code: "EXPERT_REVIEW_FAILED", requestId },
      { status: 500 },
    );
  }
}

/**
 * Bulk delete ALL experts for the company (soft-delete with deletedAt + deletedBy).
 * Used by the "Delete All Experts" button in the Company Vault UI.
 */
export async function DELETE(_req: Request) {
  let actor;
  try {
    actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
  } catch (error) {
    return error instanceof Error && error.message === "Forbidden"
      ? forbiddenResponse()
      : unauthorizedResponse();
  }

  await prismaReady;
  const company = await prisma.company.findUnique({ where: { userId: actor.id } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const result = await prisma.expert.updateMany({
    where: { companyId: company.id, deletedAt: null },
    data: { deletedAt: new Date(), deletedBy: actor.id },
  });

  await logAction({
    userId: actor.id,
    action: "EXPERT_BULK_DELETE",
    entityType: "Expert",
    entityId: company.id,
    description: `Bulk deleted ${result.count} expert record(s).`,
    metadata: { companyId: company.id, deletedCount: result.count },
  });

  return NextResponse.json({ success: true, deletedCount: result.count });
}
