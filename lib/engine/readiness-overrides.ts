// Durable, auditable readiness override records used by the central generation
// readiness gate (lib/engine/generation-readiness-gate.ts):
//
//   - FallbackApprovalRecord    — condition I (regex-fallback approval bound to
//                                 the exact tender + job + content hash)
//   - ExtractionQualityOverride — condition B (human override of a WEAK, not
//                                 corrupted, extraction for one tender file)
//
// These are deliberately small helpers so routes and the gate share one set of
// queries and one definition of "valid override".

import type { PrismaClient } from "@prisma/client";

// Weak-extraction overrides go stale: a re-extraction or a long gap should force
// a fresh human decision rather than silently riding an old approval.
export const EXTRACTION_OVERRIDE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * True when a regex-fallback approval exists that is bound to the EXACT current
 * tender + eligible job + recomputed content hash. Any change to the job or the
 * tender content moves the key, so a stale approval simply no longer matches.
 */
export async function hasBoundFallbackApproval(
  prisma: PrismaClient,
  args: { tenderId: string; jobId: string; contentHash: string },
): Promise<boolean> {
  const row = await prisma.fallbackApprovalRecord.findUnique({
    where: {
      tenderId_jobId_contentHash: {
        tenderId: args.tenderId,
        jobId: args.jobId,
        contentHash: args.contentHash,
      },
    },
    select: { id: true },
  });
  return !!row;
}

/**
 * Record (idempotently) a regex-fallback approval bound to the exact tender +
 * job + content hash. Re-approving the same triple is a no-op update of the
 * reason/route/timestamp.
 */
export async function recordFallbackApproval(
  prisma: PrismaClient,
  args: {
    tenderId: string;
    jobId: string;
    contentHash: string;
    approverId: string;
    reason: string;
    approvalRoute?: string;
  },
): Promise<void> {
  const reason = args.reason.trim().slice(0, 500) || "Human-approved regex fallback";
  const approvalRoute = (args.approvalRoute ?? "manual").slice(0, 60);
  await prisma.fallbackApprovalRecord.upsert({
    where: {
      tenderId_jobId_contentHash: {
        tenderId: args.tenderId,
        jobId: args.jobId,
        contentHash: args.contentHash,
      },
    },
    create: { tenderId: args.tenderId, jobId: args.jobId, contentHash: args.contentHash, approverId: args.approverId, reason, approvalRoute, approvedAt: new Date() },
    update: { approverId: args.approverId, reason, approvalRoute, approvedAt: new Date() },
  });
}

/**
 * True when a non-stale weak-extraction override exists for the given tender
 * file. Corrupted extraction is never overridable — callers must only consult
 * this for WEAK (not corrupted) files.
 */
export async function hasActiveExtractionOverride(
  prisma: PrismaClient,
  args: { tenderId: string; tenderFileId: string; now?: Date },
): Promise<boolean> {
  const row = await prisma.extractionQualityOverride.findUnique({
    where: { tenderId_tenderFileId: { tenderId: args.tenderId, tenderFileId: args.tenderFileId } },
    select: { overriddenAt: true },
  });
  if (!row) return false;
  const now = (args.now ?? new Date()).getTime();
  return now - row.overriddenAt.getTime() <= EXTRACTION_OVERRIDE_MAX_AGE_MS;
}

/** Remove all fallback approvals for a tender (e.g. when a human revokes). */
export async function revokeFallbackApprovals(prisma: PrismaClient, tenderId: string): Promise<void> {
  await prisma.fallbackApprovalRecord.deleteMany({ where: { tenderId } });
}

/** Record (idempotently) a weak-extraction override for one tender file. */
export async function recordExtractionQualityOverride(
  prisma: PrismaClient,
  args: {
    tenderId: string;
    tenderFileId: string;
    qualityScore: number;
    overrideReason: string;
    overriddenBy: string;
  },
): Promise<void> {
  const overrideReason = args.overrideReason.trim().slice(0, 500) || "Human override of weak extraction";
  await prisma.extractionQualityOverride.upsert({
    where: { tenderId_tenderFileId: { tenderId: args.tenderId, tenderFileId: args.tenderFileId } },
    create: { tenderId: args.tenderId, tenderFileId: args.tenderFileId, qualityScore: args.qualityScore, overrideReason, overriddenBy: args.overriddenBy, overriddenAt: new Date() },
    update: { qualityScore: args.qualityScore, overrideReason, overriddenBy: args.overriddenBy, overriddenAt: new Date() },
  });
}
