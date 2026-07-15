/**
 * Canonical analysis-currentness helper for UI layers.
 *
 * The `analysisExtractionStatus` column alone is NOT sufficient to prove that
 * a tender's analysis is currently authoritative. A persisted `AI_SUCCEEDED`
 * string can be stale relative to source hashes, superseded by a newer job,
 * produced by a mixed/fallback run, or preceded by a newer failed analysis.
 *
 * This helper batches a single AiJob query across many tenders and combines
 * it with the persisted `analysisExtractionStatus` to produce a UI-safe
 * canonical currentness verdict. It mirrors the per-tender logic in
 * `lib/engine/analysis-state-resolver.ts` (`deriveAnalysisStateDetail`) but
 * avoids the per-tender DB round-trip needed by the full resolver.
 *
 * CANONICAL CURRENTNESS RULES (mirrors deriveAnalysisStateDetail):
 *   For each tender, take the LATEST AI_ANALYZE job (highest createdAt).
 *   - If no job exists: NOT_ANALYZED (unless legacy notes prove AI analysis,
 *     but we fail-closed at the workspace projection level — the per-tender
 *     resolver handles legacy notes).
 *   - If latest job.supersededBy !== null → BLOCKED (state SUPERSEDED)
 *   - If latest job.status !== "SUCCEEDED" → BLOCKED (PARTIAL_NEEDS_RESUME,
 *     FAILED, REGEX_FALLBACK_*, QUEUED, RUNNING, CANCELED)
 *   - If latest job.promotedAt === null → BLOCKED (unpromoted SUCCEEDED is
 *     treated as FAILED by the per-tender resolver)
 *   - If latest job.analysisInputHash is empty/whitespace → BLOCKED (no real
 *     chunk content was processed)
 *   - Otherwise, the analysis is current and authoritative. Combine with
 *     the persisted analysisExtractionStatus: if status is in
 *     CLEAR_EXTRACTION_STATES AND requirements exist → CANONICAL_CLEAR.
 *     If status is in BLOCKED_EXTRACTION_STATES or unknown → BLOCKED
 *     (fail-closed).
 *
 * The full per-tender resolver remains the authority (used by command center,
 * export gates, etc.). This helper is the workspace-wide batched projection
 * used by dashboard / analysis / compliance overview pages.
 */

import type { PrismaClient } from "@prisma/client";
import {
  CLEAR_EXTRACTION_STATES,
  BLOCKED_EXTRACTION_STATES,
} from "./tender-extraction-state";

export type CanonicalAnalysisCurrentness = "CANONICAL_CLEAR" | "BLOCKED" | "NOT_ANALYZED";

export type TenderCurrentnessInput = {
  tenderId: string;
  analysisExtractionStatus: string | null | undefined;
  requirementsCount: number;
};

export type TenderCurrentnessVerdict = {
  tenderId: string;
  currentness: CanonicalAnalysisCurrentness;
  /**
   * The ID of the latest non-superseded, SUCCEEDED, promoted AI_ANALYZE job
   * with a non-empty analysisInputHash. Null when no such job exists or when
   * the tender is NOT_ANALYZED/BLOCKED.
   */
  canonicalJobId: string | null;
};

/**
 * Find the latest AI_ANALYZE job per tender, returning the fields needed to
 * prove canonical currentness. We fetch ALL non-superseded AI_ANALYZE jobs
 * for the given tender IDs and pick the latest by createdAt in JS — this
 * matches the per-tender resolver's `orderBy: { createdAt: "desc" }, take: 1`
 * semantics without an N+1 query.
 *
 * We do NOT filter on status === "SUCCEEDED" at the SQL level because we
 * also need to see FAILED / PARTIAL_SUCCESS / RUNNING / QUEUED jobs to know
 * that the latest job is NOT a clean success. Filtering would hide that.
 *
 * We DO filter supersededBy: null because superseded jobs are never the
 * latest authoritative run (they were replaced).
 */
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
  // Pick the latest non-superseded job per tenderId. If a tender's latest job
  // is superseded, that tender is BLOCKED — but we still want to see the
  // superseded marker so we don't accidentally fall back to an older
  // non-superseded job and treat it as current.
  const latestPerTender = new Map<string, LatestJobRow>();
  for (const job of jobs) {
    if (!job.tenderId) continue;
    if (latestPerTender.has(job.tenderId)) continue; // first hit is latest (orderBy desc)
    latestPerTender.set(job.tenderId, job as LatestJobRow);
  }
  return latestPerTender;
}

/**
 * Classify the canonical currentness for a batch of tenders.
 *
 * Verdict rules (mirrors deriveAnalysisStateDetail):
 *   - NOT_ANALYZED: zero requirements, or null/NOT_STARTED status, or no
 *     AI_ANALYZE job exists for the tender.
 *   - CANONICAL_CLEAR: latest AI_ANALYZE job is non-superseded, status is
 *     "SUCCEEDED", promotedAt is set, analysisInputHash is non-empty, AND
 *     the persisted status is in CLEAR_EXTRACTION_STATES.
 *   - BLOCKED: anything else — including persisted CLEAR statuses whose
 *     latest job is superseded/failed/partial/running/queued/unpromoted/
 *     empty-hash, OR persisted BLOCKED status, OR unknown status.
 *
 * Unknown statuses (not in CLEAR_EXTRACTION_STATES, not in BLOCKED_EXTRACTION_STATES)
 * are always BLOCKED — fail-closed. This catches stale-hash, partial-provider,
 * mixed-fallback, misspellings, and any future status not yet promoted to CLEAR.
 */
export async function classifyTenderCurrentnessBatch(
  prismaClient: PrismaClient | typeof import("@/lib/prisma").prisma,
  rows: TenderCurrentnessInput[],
): Promise<Map<string, TenderCurrentnessVerdict>> {
  const tenderIds = rows.map((r) => r.tenderId);
  const latestJobPerTender = await getLatestAiJobPerTender(prismaClient, tenderIds);
  const verdicts = new Map<string, TenderCurrentnessVerdict>();
  for (const row of rows) {
    // Step 1: zero requirements OR null/NOT_STARTED status → NOT_ANALYZED
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

    // Step 2: no AI job exists → cannot prove currentness → BLOCKED
    // (per-tender resolver may detect legacy notes, but workspace projection
    // fails closed — legacy analyses are stale by definition)
    if (!latestJob) {
      verdicts.set(row.tenderId, {
        tenderId: row.tenderId,
        currentness: "BLOCKED",
        canonicalJobId: null,
      });
      continue;
    }

    // Step 3: latest job is superseded → BLOCKED (state SUPERSEDED in resolver)
    if (latestJob.supersededBy) {
      verdicts.set(row.tenderId, {
        tenderId: row.tenderId,
        currentness: "BLOCKED",
        canonicalJobId: null,
      });
      continue;
    }

    // Step 4: latest job is not SUCCEEDED → BLOCKED
    // (PARTIAL_SUCCESS, FAILED, QUEUED, RUNNING, CANCELED all fail closed)
    if (latestJob.status !== "SUCCEEDED") {
      verdicts.set(row.tenderId, {
        tenderId: row.tenderId,
        currentness: "BLOCKED",
        canonicalJobId: null,
      });
      continue;
    }

    // Step 5: SUCCEEDED but not promoted → BLOCKED (resolver treats as FAILED)
    if (!latestJob.promotedAt) {
      verdicts.set(row.tenderId, {
        tenderId: row.tenderId,
        currentness: "BLOCKED",
        canonicalJobId: null,
      });
      continue;
    }

    // Step 6: analysisInputHash must be non-empty (not just non-null).
    // An empty string means no real chunk content was processed.
    const hash = (latestJob.analysisInputHash ?? "").trim();
    if (!hash) {
      verdicts.set(row.tenderId, {
        tenderId: row.tenderId,
        currentness: "BLOCKED",
        canonicalJobId: null,
      });
      continue;
    }

    // Step 7: latest job is current and authoritative. Combine with the
    // persisted status string. Only render CANONICAL_CLEAR when the status
    // is in the explicit CLEAR allowlist. Unknown statuses are BLOCKED.
    if (CLEAR_EXTRACTION_STATES.has(status)) {
      verdicts.set(row.tenderId, {
        tenderId: row.tenderId,
        currentness: "CANONICAL_CLEAR",
        canonicalJobId: latestJob.id,
      });
    } else {
      // Persisted status is BLOCKED or unknown → BLOCKED (fail-closed)
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
 * Check if a tender is a critical blocker (not analyzed or blocked).
 * Same as `isExtractionCritical` but uses the canonical-currentness verdict.
 */
export function isCanonicalCurrentnessCritical(
  verdict: TenderCurrentnessVerdict,
): boolean {
  return verdict.currentness !== "CANONICAL_CLEAR";
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
