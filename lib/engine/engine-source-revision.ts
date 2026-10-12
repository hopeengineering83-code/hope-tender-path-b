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
  requirementCount: number;
  vaultDocumentCount: number;
  evidenceRecordCount: number;
  /** DIRECTIVE 7: The promoted AI_ANALYZE jobId that this Engine run binds to. */
  promotedAnalysisJobId: string | null;
  /** DIRECTIVE 7: The analysisInputHash from the promoted AI_ANALYZE job. */
  analysisInputHash: string | null;
};

/**
 * Computes the canonical Engine input revision from current tender source
 * bytes and the complete tenant-owned Company Vault evidence revision set.
 *
 * DIRECTIVE 7: The revision now includes the promoted AI_ANALYZE jobId and
 * analysisInputHash. A new successful AI Analyze for the same tender bytes
 * produces a different promoted analysis identity, which invalidates an old
 * Engine job if its promoted analysis/requirement-set identity differs.
 *
 * The value is deliberately deterministic: duplicate requests for unchanged
 * source state converge on the same idempotency key, while any file-byte,
 * extraction, trust, provenance, deletion, expiry, or record revision change
 * produces a different revision. Engine-owned derived rows (requirements,
 * matches, matrices, Build Plans, and Tender workflow metadata) are excluded:
 * the Engine replaces those rows during a successful run, so including them
 * made every job invalidate its own revision at the post-run checkpoint.
 * Workers recompute this immutable-input value before and after execution so a
 * genuine source change still prevents stale output promotion.
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
        _count: { select: { requirements: true } },
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

  // DIRECTIVE 7: Query the promoted (SUCCEEDED) AI_ANALYZE job for this tender.
  // The Engine input revision must bind to the exact promoted analysis identity
  // so a new AI Analyze invalidates old Engine jobs.
  const promotedAnalysis = await client.aiJob.findFirst({
    where: {
      tenderId: input.tenderId,
      userId: input.userId,
      jobType: "AI_ANALYZE",
      status: "SUCCEEDED",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, analysisInputHash: true },
  }).catch(() => null);

  const payload = {
    version: 4, // DIRECTIVE 7: version bumped to include promoted analysis binding
    tender: {
      id: tender.id,
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
    // DIRECTIVE 7: Bind to the exact promoted AI_ANALYZE job. If the analysis
    // job changes (new manual AI Analyze), this produces a different revision,
    // invalidating old Engine jobs.
    promotedAnalysis: promotedAnalysis ? {
      jobId: promotedAnalysis.id,
      analysisInputHash: promotedAnalysis.analysisInputHash ?? null,
    } : null,
    company: {
      id: company.id,
      updatedAt: iso(company.updatedAt),
      // updatedAt is deliberately excluded below (for every vault record, not
      // just documents). It is write-bookkeeping, not evidence: an idempotent
      // re-verification pass (autoVerifyCompanyKnowledge, called on every
      // Engine run via prepareCompanyVaultForEngine) can touch a record's
      // updatedAt while writing back the exact same trustLevel/reviewedBy/
      // reviewedAt/reviewNotes/content hash it already had — isDurablySource
      // Verified is what actually decides "nothing changed" and it does not
      // depend on updatedAt. Hashing updatedAt anyway meant that harmless
      // touch still produced a new sourceRevision, which invalidated the
      // Engine job that had just produced a valid Build Plan and proposal,
      // forcing a full ENGINE_RUN -> PROPOSAL_GENERATION redo — including
      // superseding an already-finalized, byte-verified PDF — for a change
      // that never happened. Every field that DOES represent real content
      // (sha256/contentSha256, trustLevel, sourceDocumentId, reviewedBy,
      // reviewedAt, reviewNotes, status, expiryDate, deletedAt) stays hashed,
      // so a genuine change still produces a new revision.
      documents: sortById(documents).map((document) => ({
        id: document.id,
        sha256: document.contentSha256,
        byteLength: document.contentByteLength,
        integrityStatus: document.integrityStatus,
        extractionStatus: document.aiExtractionStatus,
      })),
      experts: sortById(experts).map(({ updatedAt: _updatedAt, ...record }) => ({
        ...record,
        reviewedAt: record.reviewedAt ? iso(record.reviewedAt) : null,
        deletedAt: record.deletedAt ? iso(record.deletedAt) : null,
      })),
      projects: sortById(projects).map(({ updatedAt: _updatedAt, ...record }) => ({
        ...record,
        reviewedAt: record.reviewedAt ? iso(record.reviewedAt) : null,
        deletedAt: record.deletedAt ? iso(record.deletedAt) : null,
      })),
      legalRecords: sortById(legalRecords).map(({ updatedAt: _updatedAt, ...record }) => ({
        ...record,
        reviewedAt: record.reviewedAt ? iso(record.reviewedAt) : null,
        expiryDate: record.expiryDate ? iso(record.expiryDate) : null,
      })),
      financialRecords: sortById(financialRecords).map(({ updatedAt: _updatedAt, ...record }) => ({
        ...record,
        reviewedAt: record.reviewedAt ? iso(record.reviewedAt) : null,
      })),
      complianceRecords: sortById(complianceRecords).map(({ updatedAt: _updatedAt, ...record }) => ({
        ...record,
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
    requirementCount: tender._count.requirements,
    vaultDocumentCount: documents.length,
    evidenceRecordCount:
      experts.length + projects.length + legalRecords.length + financialRecords.length + complianceRecords.length,
    // DIRECTIVE 7: Expose the promoted analysis identity so callers can verify
    // the Engine job is bound to the correct analysis.
    promotedAnalysisJobId: promotedAnalysis?.id ?? null,
    analysisInputHash: promotedAnalysis?.analysisInputHash ?? null,
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
