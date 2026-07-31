import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

function iso(value: Date): string {
  return value.toISOString();
}

function sortById<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id));
}

export type EngineSourceRevision = {
  sourceRevision: string;
  tenderFileCount: number;
  vaultDocumentCount: number;
  evidenceRecordCount: number;
};

/**
 * Computes the canonical Engine input revision from current tender source
 * bytes and the complete tenant-owned Company Vault evidence revision set.
 *
 * The value is deliberately deterministic: duplicate requests for unchanged
 * source state converge on the same idempotency key, while any file-byte,
 * extraction, trust, provenance, deletion, expiry, or record revision change
 * produces a different revision. Workers recompute this value before and after
 * execution so stale jobs cannot promote authoritative output.
 */
export async function computeEngineSourceRevision(
  client: PrismaClient,
  input: { tenderId: string; userId: string; companyId?: string | null },
): Promise<EngineSourceRevision | null> {
  const [tender, company] = await Promise.all([
    client.tender.findFirst({
      where: { id: input.tenderId, userId: input.userId },
      select: {
        id: true,
        updatedAt: true,
        analysisExtractionStatus: true,
        files: {
          select: {
            id: true,
            updatedAt: true,
            sha256: true,
            byteSize: true,
            contentSha256: true,
            contentByteLength: true,
            integrityStatus: true,
            extractionMethod: true,
            extractionScore: true,
            deletionStatus: true,
          },
        },
      },
    }),
    input.companyId
      ? client.company.findFirst({
          where: { id: input.companyId, userId: input.userId },
          select: { id: true, updatedAt: true },
        })
      : client.company.findUnique({
          where: { userId: input.userId },
          select: { id: true, updatedAt: true },
        }),
  ]);

  if (!tender || !company) return null;

  const [documents, experts, projects, legalRecords, financialRecords, complianceRecords] = await Promise.all([
    client.companyDocument.findMany({
      where: { companyId: company.id },
      select: {
        id: true,
        updatedAt: true,
        contentSha256: true,
        contentByteLength: true,
        integrityStatus: true,
        aiExtractionStatus: true,
      },
    }),
    client.expert.findMany({
      where: { companyId: company.id },
      select: {
        id: true,
        updatedAt: true,
        trustLevel: true,
        sourceDocumentId: true,
        reviewedBy: true,
        reviewedAt: true,
        reviewNotes: true,
        deletedAt: true,
      },
    }),
    client.project.findMany({
      where: { companyId: company.id },
      select: {
        id: true,
        updatedAt: true,
        trustLevel: true,
        sourceDocumentId: true,
        reviewedBy: true,
        reviewedAt: true,
        reviewNotes: true,
        deletedAt: true,
      },
    }),
    client.legalRecord.findMany({
      where: { companyId: company.id },
      select: {
        id: true,
        updatedAt: true,
        trustLevel: true,
        sourceDocumentId: true,
        reviewedBy: true,
        reviewedAt: true,
        reviewNotes: true,
        status: true,
        expiryDate: true,
      },
    }),
    client.financialRecord.findMany({
      where: { companyId: company.id },
      select: {
        id: true,
        updatedAt: true,
        trustLevel: true,
        sourceDocumentId: true,
        reviewedBy: true,
        reviewedAt: true,
        reviewNotes: true,
      },
    }),
    client.companyComplianceRecord.findMany({
      where: { companyId: company.id },
      select: {
        id: true,
        updatedAt: true,
        trustLevel: true,
        sourceDocumentId: true,
        reviewedBy: true,
        reviewedAt: true,
        reviewNotes: true,
        status: true,
        expiryDate: true,
      },
    }),
  ]);

  const payload = {
    version: 1,
    tender: {
      id: tender.id,
      updatedAt: iso(tender.updatedAt),
      analysisExtractionStatus: tender.analysisExtractionStatus,
      files: sortById(tender.files).map((file) => ({
        id: file.id,
        updatedAt: iso(file.updatedAt),
        sha256: file.contentSha256 ?? file.sha256,
        byteLength: file.contentByteLength ?? file.byteSize,
        integrityStatus: file.integrityStatus,
        extractionMethod: file.extractionMethod,
        extractionScore: file.extractionScore,
        deletionStatus: file.deletionStatus,
      })),
    },
    company: {
      id: company.id,
      updatedAt: iso(company.updatedAt),
      documents: sortById(documents).map((document) => ({
        id: document.id,
        updatedAt: iso(document.updatedAt),
        sha256: document.contentSha256,
        byteLength: document.contentByteLength,
        integrityStatus: document.integrityStatus,
        extractionStatus: document.aiExtractionStatus,
      })),
      experts: sortById(experts).map((record) => ({
        ...record,
        updatedAt: iso(record.updatedAt),
        reviewedAt: record.reviewedAt ? iso(record.reviewedAt) : null,
        deletedAt: record.deletedAt ? iso(record.deletedAt) : null,
      })),
      projects: sortById(projects).map((record) => ({
        ...record,
        updatedAt: iso(record.updatedAt),
        reviewedAt: record.reviewedAt ? iso(record.reviewedAt) : null,
        deletedAt: record.deletedAt ? iso(record.deletedAt) : null,
      })),
      legalRecords: sortById(legalRecords).map((record) => ({
        ...record,
        updatedAt: iso(record.updatedAt),
        reviewedAt: record.reviewedAt ? iso(record.reviewedAt) : null,
        expiryDate: record.expiryDate ? iso(record.expiryDate) : null,
      })),
      financialRecords: sortById(financialRecords).map((record) => ({
        ...record,
        updatedAt: iso(record.updatedAt),
        reviewedAt: record.reviewedAt ? iso(record.reviewedAt) : null,
      })),
      complianceRecords: sortById(complianceRecords).map((record) => ({
        ...record,
        updatedAt: iso(record.updatedAt),
        reviewedAt: record.reviewedAt ? iso(record.reviewedAt) : null,
        expiryDate: record.expiryDate ? iso(record.expiryDate) : null,
      })),
    },
  };

  const sourceRevision = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");

  return {
    sourceRevision,
    tenderFileCount: tender.files.length,
    vaultDocumentCount: documents.length,
    evidenceRecordCount:
      experts.length + projects.length + legalRecords.length + financialRecords.length + complianceRecords.length,
  };
}

export function engineIdempotencyKey(input: {
  userId: string;
  tenderId: string;
  sourceRevision: string;
}): string {
  return createHash("sha256")
    .update(`ENGINE_RUN\u0000${input.userId}\u0000${input.tenderId}\u0000${input.sourceRevision}`)
    .digest("hex");
}
