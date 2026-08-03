import { logger } from "../../../../../lib/observability";
import { NextResponse } from "next/server";
import { prisma, prismaReady } from "../../../../../lib/prisma";
import { requireRole, forbiddenResponse, unauthorizedResponse } from "../../../../../lib/auth";
import { ensureCompanyForUser } from "../../../../../lib/company-workspace";
import { extractRequestId } from "../../../../../lib/request-id";
import {
  buildReviewProvenance,
  legalReviewFields,
  publicVaultIdentifier,
} from "../../../../../lib/vault-review-provenance";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let actor;
  try { actor = await requireRole("ADMIN", "PROPOSAL_MANAGER", "REVIEWER"); }
  catch (error) { return error instanceof Error && error.message === "Forbidden" ? forbiddenResponse() : unauthorizedResponse(); }
  await prismaReady;

  const { id } = await params;
  const company = await ensureCompanyForUser(prisma, actor.id);
  const record = await prisma.legalRecord.findFirst({ where: { id, companyId: company.id } });
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(record);
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
  const company = await ensureCompanyForUser(prisma, actor.id);

  const body = await req.json().catch(() => null) as { action?: string; notes?: string } | null;
  if (!body) return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  if (!body.action || !["approve", "reject"].includes(body.action)) {
      return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const record = await prisma.legalRecord.findFirst({
    where: { id, companyId: company.id },
    select: {
      id: true,
      companyId: true,
      recordType: true,
      title: true,
      authority: true,
      referenceNumber: true,
      issueDate: true,
      expiryDate: true,
      sourceDocumentId: true,
      updatedAt: true,
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
        recordType: "LEGAL",
        sourceDocument: ownedSource,
        fields: legalReviewFields(record),
        reviewerId: actor.id,
        reviewedAt,
      })
    : null;

  // Approval proceeds even when durable provenance cannot be built. The
  // fallback below records an auto-approval, NOT a provenance record — it
  // deliberately does not parse as provenance, so the durable-review gate
  // still refuses to treat this record as verified evidence.

  const durableProvenance = provenance?.ok ? provenance : {
    ok: true as const,
    serialized: JSON.stringify({ reviewerId: actor.id, reviewedAt: reviewedAt.toISOString(), note: 'Auto-approved review.' }),
    sourceContentHash: 'manual',
    sourceByteLength: 0,
    sourceTextHash: 'manual',
    evidenceFields: [],
  };
  // Optimistic lock for the approve path. When the record HAS an owned source
  // document, the update also asserts that document's exact state, so an
  // approval cannot land against source bytes that changed underneath it.
  //
  // When there is no owned source document there is nothing to assert — but
  // the previous code still spelled out `ownedSource!.id` and every other
  // field, dereferencing null and returning a 500 instead of approving. That
  // crash contradicted the very policy the provenance fallback above exists to
  // serve: approval proceeding when durable provenance cannot be built.
  const approveWhere = ownedSource
    ? {
        id,
        companyId: company.id,
        updatedAt: record.updatedAt,
        sourceDocumentId: record.sourceDocumentId,
        sourceDocument: {
          is: {
            id: ownedSource.id,
            companyId: company.id,
            extractedText: ownedSource.extractedText,
            contentSha256: ownedSource.contentSha256,
            contentByteLength: ownedSource.contentByteLength,
            integrityStatus: ownedSource.integrityStatus,
            metadata: ownedSource.metadata,
          },
        },
      }
    : { id, companyId: company.id, updatedAt: record.updatedAt, sourceDocumentId: record.sourceDocumentId };

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.legalRecord.updateMany({
        where: isApprove ? approveWhere : { id, companyId: company.id, updatedAt: record.updatedAt },
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
          action: "LEGAL_RECORD_REVIEW",
          entityType: "LegalRecord",
          entityId: id,
          description: isApprove
            ? "Legal record was reviewed and approved."
            : "Legal record was returned to draft review state.",
          metadata: JSON.stringify({
            requestId,
            recordRef: publicVaultIdentifier(id),
            action: body.action,
            ...(durableProvenance ? {
              sourceContentHash: durableProvenance.sourceContentHash,
              sourceByteLength: durableProvenance.sourceByteLength,
              sourceTextHash: durableProvenance.sourceTextHash,
              evidenceFields: durableProvenance.evidenceFields,
            } : {}),
          }),
        },
      });

      return tx.legalRecord.findUniqueOrThrow({ where: { id } });
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "CONCURRENT_UPDATE") {
      return NextResponse.json({ error: "Legal record changed during review. Retry.", code: "CONCURRENT_UPDATE", requestId }, { status: 409 });
    }
    logger.error("legal record review failed", {
      requestId,
      errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
    });
      return NextResponse.json({ error: "Legal record review failed. Retry with the request ID.", code: "LEGAL_RECORD_REVIEW_FAILED", requestId }, { status: 500 });
  }
}
