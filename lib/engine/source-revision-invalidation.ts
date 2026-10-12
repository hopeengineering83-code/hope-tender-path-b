import type { Prisma } from "@prisma/client";
import { computeTenderMutationLockKey } from "./advisory-lock-key";

export type SourceRevisionReason =
  | "SOURCE_FILE_ADDED"
  | "SOURCE_FILE_REPLACED"
  | "SOURCE_FILE_REEXTRACTED"
  | "SOURCE_FILE_DELETED"
  | "SOURCE_BYTES_CHANGED"
  | "TENDER_METADATA_CORRECTED";

export type SourceRevisionInvalidationResult = {
  requirements: number;
  expertMatches: number;
  projectMatches: number;
  complianceRows: number;
  complianceGaps: number;
  documents: number;
  buildPlans: number;
  exportPackages: number;
  sectionMaps: number;
  facts: number;
  aiJobs: number;
  aiChunks: number;
  retryStates: number;
};

/**
 * Invalidate all source-derived release state under the same stable tender lock
 * used by AI promotion and engine persistence. Historical rows are preserved:
 * they are marked stale/superseded or deselected, never silently deleted.
 *
 * Active AI work is also canceled in the same transaction. Otherwise a worker
 * that started before the source revision could promote results derived from
 * obsolete bytes after the rest of the tender had already been invalidated.
 */
export async function invalidateTenderForSourceRevision(
  tx: Prisma.TransactionClient,
  tenderId: string,
  reason: SourceRevisionReason,
): Promise<SourceRevisionInvalidationResult> {
  const lockKey = computeTenderMutationLockKey(tenderId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

  const now = new Date();
  const safeReason = `Tender source revision changed (${reason}).`;

  const [
    requirements,
    expertMatches,
    projectMatches,
    complianceRows,
    complianceGaps,
    documents,
    buildPlans,
    exportPackages,
    sectionMaps,
    facts,
    aiJobs,
    aiChunks,
    retryStates,
  ] = await Promise.all([
    tx.tenderRequirement.updateMany({
      where: { tenderId },
      data: {
        isResolved: false,
        sourceConfidence: 0,
        sourceExtractionMethod: `stale:${reason.toLowerCase()}`,
      },
    }),
    tx.tenderExpertMatch.updateMany({
      where: { tenderId },
      data: { isSelected: false },
    }),
    tx.tenderProjectMatch.updateMany({
      where: { tenderId },
      data: { isSelected: false },
    }),
    tx.complianceMatrix.updateMany({
      where: { tenderId },
      data: { supportLevel: "STALE" },
    }),
    tx.complianceGap.updateMany({
      where: { tenderId },
      data: { isResolved: false, resolvedNote: null },
    }),
    tx.generatedDocument.updateMany({
      where: { tenderId, generationStatus: { not: "SUPERSEDED" } },
      data: {
        generationStatus: "SUPERSEDED",
        validationStatus: "SUPERSEDED",
        reviewStatus: "SUPERSEDED",
        reviewNotes: `Superseded because tender source revision changed (${reason}).`,
        reviewedBy: null,
        reviewedAt: null,
      },
    }),
    tx.buildPlan.updateMany({
      where: { tenderId, status: { not: "SUPERSEDED" } },
      data: {
        status: "SUPERSEDED",
        confirmedAt: null,
        confirmedBy: null,
        confirmedById: null,
        confirmedRevision: null,
        confirmedContentHash: null,
      },
    }),
    tx.exportPackage.updateMany({
      where: { tenderId },
      data: {
        status: "STALE",
        integrityStatus: "UNKNOWN",
        integrityVerifiedAt: null,
      },
    }),
    tx.sectionEvidenceMap.updateMany({
      where: { tenderId, status: { not: "SUPERSEDED" } },
      data: {
        status: "SUPERSEDED",
        reviewerStatus: "PENDING",
        reviewerNote: `Stale after tender source revision (${reason}).`,
      },
    }),
    tx.tenderFactsLedger.updateMany({
      where: { tenderId, sourceStatus: "active" },
      data: { sourceStatus: "stale", reviewState: "pending" },
    }),
    tx.aiJob.updateMany({
      where: { tenderId, status: { in: ["QUEUED", "RUNNING"] } },
      data: {
        status: "CANCELED",
        errorMessage: safeReason,
        finishedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
      },
    }),
    tx.aiAnalyzeChunk.updateMany({
      where: { tenderId, status: { in: ["QUEUED", "RUNNING"] } },
      data: {
        status: "SKIPPED",
        failureCategory: "SOURCE_REVISION_CHANGED",
        errorMessage: safeReason,
        finishedAt: now,
      },
    }),
    tx.aiAnalyzeRetryState.updateMany({
      where: { tenderId },
      data: {
        nonRetryable: true,
        nextRetryAt: null,
        retryReason: "SOURCE_REVISION_CHANGED",
        failureCategory: "SOURCE_REVISION_CHANGED",
        lastProviderAvailable: false,
        lastCheckedAt: now,
      },
    }),
  ]);

  await tx.matchScoreBreakdown.updateMany({
    where: { tenderId },
    data: { source: "STALE_SOURCE_REVISION" },
  });
  await tx.evaluatorObjection.updateMany({
    where: { tenderId },
    data: {
      status: "OPEN",
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
    },
  });
  await tx.submissionPlanState.updateMany({
    where: { tenderId },
    data: {
      provenance: "STALE_SOURCE_REVISION",
      confirmationStatus: "NOT_CONFIRMED",
      confirmedAt: null,
    },
  });
  await tx.tender.update({
    where: { id: tenderId },
    data: {
      status: "ANALYSIS_REQUIRED",
      stage: "ANALYSIS",
      analysisExtractionStatus: "SOURCE_REVISION_CHANGED",
      readinessScore: 0,
      analysisSummary: null,
    },
  });

  return {
    requirements: requirements.count,
    expertMatches: expertMatches.count,
    projectMatches: projectMatches.count,
    complianceRows: complianceRows.count,
    complianceGaps: complianceGaps.count,
    documents: documents.count,
    buildPlans: buildPlans.count,
    exportPackages: exportPackages.count,
    sectionMaps: sectionMaps.count,
    facts: facts.count,
    aiJobs: aiJobs.count,
    aiChunks: aiChunks.count,
    retryStates: retryStates.count,
  };
}
