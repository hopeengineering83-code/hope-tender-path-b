/**
 * Workspace analysis-currentness PROJECTION for UI layers.
 *
 * ⚠️ INCOMPLETE PROJECTION — NOT A CANONICAL AUTHORITY ⚠️
 *
 * This helper is a workspace-wide batched projection used by dashboard,
 * analysis, and compliance overview pages. It is NOT a canonical authority
 * for "Clear" wording because it does NOT replicate the full per-tender
 * resolver (`lib/engine/analysis-state-resolver.ts` →
 * `resolveTenderAnalysisState` → `deriveAnalysisStateDetail`).
 *
 * What this projection DOES check (job-level only):
 *   - Fetches ALL AI_ANALYZE jobs for the tender IDs.
 *   - Picks the LATEST job per tenderId (first hit in createdAt desc).
 *   - Rejects if latestJob.supersededBy is set (state SUPERSEDED).
 *   - Rejects if latestJob.status !== "SUCCEEDED".
 *   - Rejects if latestJob.promotedAt is null.
 *   - Rejects if analysisInputHash is empty/whitespace after trim.
 *
 * What this projection DOES NOT check (per-tender resolver does):
 *   - AiAnalyzeChunk rows (chunk-level success/failure/partial coverage).
 *   - Content-hash equality between the job's analysisInputHash and the
 *     tender's current source/content hash (a successful promoted job for
 *     OLD source bytes can still pass this projection).
 *   - Fallback/mixed-result provenance (a job with staged fallback content
 *     can still appear SUCCEEDED at the job level).
 *   - Legacy notes-based analysis detection.
 *   - Section-detected-but-no-requirements edge case.
 *
 * VERDICT SEMANTICS:
 *   - NOT_ANALYZED: zero requirements, or null/NOT_STARTED status, or no
 *     AI_ANALYZE job exists.
 *   - PROVISIONAL_NOT_BLOCKED: the latest job LOOKS clean at the job level
 *     (SUCCEEDED + promoted + non-superseded + non-empty hash) AND the
 *     persisted status is in CLEAR_EXTRACTION_STATES. This is NOT a
 *     canonical Clear verdict — the per-tender resolver may still find
 *     chunk-level or content-hash blockers. Consumers MUST NOT render this
 *     as "Clear" wording. Use it only to compute a lower-bound count of
 *     tenders that are PROVABLY blocked (everything that is NOT
 *     PROVISIONAL_NOT_BLOCKED).
 *   - BLOCKED: anything else — including persisted CLEAR statuses whose
 *     latest job is superseded/failed/partial/running/queued/unpromoted/
 *     empty-hash, OR persisted BLOCKED status, OR unknown status.
 *
 * The full per-tender resolver (`resolveTenderAnalysisState`) remains the
 * canonical authority for command center / export gates. This projection
 * is the workspace-wide lower-bound blocker count.
 */

import type { PrismaClient } from "@prisma/client";
import {
  CLEAR_EXTRACTION_STATES,
  BLOCKED_EXTRACTION_STATES,
} from "./tender-extraction-state";

export type TenderWorkspaceCurrentness =
  | "PROVISIONAL_NOT_BLOCKED"
  | "BLOCKED"
  | "NOT_ANALYZED";

export type TenderCurrentnessInput = {
  tenderId: string;
  analysisExtractionStatus: string | null | undefined;
  requirementsCount: number;
};

export type TenderCurrentnessVerdict = {
  tenderId: string;
  currentness: TenderWorkspaceCurrentness;
  /**
   * The ID of the latest non-superseded, SUCCEEDED, promoted AI_ANALYZE job
   * with a non-empty analysisInputHash. Null when no such job exists or when
   * the tender is NOT_ANALYZED/BLOCKED.
   *
   * NOTE: This job ID is the latest job that LOOKS clean at the job level.
   * It is NOT a canonical Clear authority — the per-tender resolver may
   * still find chunk-level or content-hash blockers.
   */
  canonicalJobId: string | null;
};

type LatestJobRow = {
  id: string;
  tenderId: string | null;
  status: string;
  analysisInputHash: string | null;
  promotedAt: Date | null;
  supersededBy: string | null;
  createdAt: Date;
};

export async function getLatestAiJobPerTender(
  prismaClient: PrismaClient | typeof import("@/lib/prisma").prisma,
  tenderIds: string[],
): Promise<Map<string, LatestJobRow>> {
  if (tenderIds.length === 0) return new Map();
  const jobs = await prismaClient.aiJob.findMany({
    where: {
      tenderId: { in: tenderIds },
      jobType: "AI_ANALYZE",
    },
    select: {
      id: true,
      tenderId: true,
      status: true,
      analysisInputHash: true,
      promotedAt: true,
      supersededBy: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const latestPerTender = new Map<string, LatestJobRow>();
  for (const job of jobs) {
    if (!job.tenderId) continue;
    if (latestPerTender.has(job.tenderId)) continue;
    latestPerTender.set(job.tenderId, job as LatestJobRow);
  }
  return latestPerTender;
}

/**
 * Classify the workspace currentness for a batch of tenders.
 *
 * Returns a lower-bound blocker projection. Consumers MUST NOT render
 * PROVISIONAL_NOT_BLOCKED as "Clear" wording — the per-tender resolver
 * may still find chunk-level or content-hash blockers.
 */
export async function classifyTenderCurrentnessBatch(
  prismaClient: PrismaClient | typeof import("@/lib/prisma").prisma,
  rows: TenderCurrentnessInput[],
): Promise<Map<string, TenderCurrentnessVerdict>> {
  const tenderIds = rows.map((r) => r.tenderId);
  const latestJobPerTender = await getLatestAiJobPerTender(prismaClient, tenderIds);
  const verdicts = new Map<string, TenderCurrentnessVerdict>();
  for (const row of rows) {
    if (!row.requirementsCount || row.requirementsCount === 0) {
      verdicts.set(row.tenderId, {
        tenderId: row.tenderId,
        currentness: "NOT_ANALYZED",
        canonicalJobId: null,
      });
      continue;
    }
    if (!row.analysisExtractionStatus || row.analysisExtractionStatus === "NOT_STARTED") {
      verdicts.set(row.tenderId, {
        tenderId: row.tenderId,
        currentness: "NOT_ANALYZED",
        canonicalJobId: null,
      });
      continue;
    }

    const status = row.analysisExtractionStatus;
    const latestJob = latestJobPerTender.get(row.tenderId);

    if (!latestJob) {
      verdicts.set(row.tenderId, {
        tenderId: row.tenderId,
        currentness: "BLOCKED",
        canonicalJobId: null,
      });
      continue;
    }
    if (latestJob.supersededBy) {
      verdicts.set(row.tenderId, {
        tenderId: row.tenderId,
        currentness: "BLOCKED",
        canonicalJobId: null,
      });
      continue;
    }
    if (latestJob.status !== "SUCCEEDED") {
      verdicts.set(row.tenderId, {
        tenderId: row.tenderId,
        currentness: "BLOCKED",
        canonicalJobId: null,
      });
      continue;
    }
    if (!latestJob.promotedAt) {
      verdicts.set(row.tenderId, {
        tenderId: row.tenderId,
        currentness: "BLOCKED",
        canonicalJobId: null,
      });
      continue;
    }
    const hash = (latestJob.analysisInputHash ?? "").trim();
    if (!hash) {
      verdicts.set(row.tenderId, {
        tenderId: row.tenderId,
        currentness: "BLOCKED",
        canonicalJobId: null,
      });
      continue;
    }

    if (CLEAR_EXTRACTION_STATES.has(status)) {
      // PROVISIONAL_NOT_BLOCKED — NOT a canonical Clear verdict. The
      // per-tender resolver may still find chunk-level or content-hash
      // blockers. Consumers MUST NOT render this as "Clear".
      verdicts.set(row.tenderId, {
        tenderId: row.tenderId,
        currentness: "PROVISIONAL_NOT_BLOCKED",
        canonicalJobId: latestJob.id,
      });
    } else {
      verdicts.set(row.tenderId, {
        tenderId: row.tenderId,
        currentness: "BLOCKED",
        canonicalJobId: null,
      });
    }
  }
  return verdicts;
}

/**
 * Returns true if a tender is PROVABLY a critical blocker at the workspace
 * projection level. This is a LOWER BOUND — the per-tender resolver may
 * find additional blockers.
 *
 * Returns true for NOT_ANALYZED and BLOCKED verdicts.
 * Returns false for PROVISIONAL_NOT_BLOCKED (which is NOT a Clear verdict —
 * it just means "no job-level blocker detected at the workspace level").
 */
export function isCanonicalCurrentnessCritical(
  verdict: TenderCurrentnessVerdict,
): boolean {
  return verdict.currentness !== "PROVISIONAL_NOT_BLOCKED";
}

/**
 * Returns true if a status string is in the canonical CLEAR allowlist.
 * Exposed for tests; consumers should use `classifyTenderCurrentnessBatch`.
 */
export function isStatusInClearAllowlist(status: string | null | undefined): boolean {
  return Boolean(status) && CLEAR_EXTRACTION_STATES.has(status as string);
}

/**
 * Returns true if a status string is in the canonical BLOCKED denylist.
 * Exposed for tests; unknown statuses are also treated as BLOCKED by the
 * fail-closed policy in `classifyTenderCurrentnessBatch`.
 */
export function isStatusInBlockedDenylist(status: string | null | undefined): boolean {
  return Boolean(status) && BLOCKED_EXTRACTION_STATES.has(status as string);
}
