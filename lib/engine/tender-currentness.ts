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
 * canonical currentness verdict. It mirrors the logic in
 * `lib/engine/analysis-state-resolver.ts` (`resolveTenderAnalysisState`) but
 * avoids the per-tender DB round-trip needed by the full resolver.
 *
 * The full resolver remains the per-tender authority (used by command center,
 * export gates, etc.). This helper is the workspace-wide batched projection
 * used by dashboard / analysis / compliance overview pages.
 */

import type { PrismaClient, Tender } from "@prisma/client";
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

export type TenderCurrentnessRow = TenderCurrentnessInput & {
  /** ID of the latest non-superseded promoted AI_ANALYZE job, if any. */
  canonicalJobId: string | null;
};

export type TenderCurrentnessVerdict = {
  tenderId: string;
  currentness: CanonicalAnalysisCurrentness;
  canonicalJobId: string | null;
};

/**
 * Returns the set of tender IDs that have a non-superseded, promoted
 * AI_ANALYZE job. This is the cheap batched signal we use to prove that a
 * persisted CLEAR status is still current (not stale, not superseded).
 *
 * A promoted job has `promotedAt != null`, `supersededBy == null`, and a
 * non-empty `analysisInputHash` (so it had real chunk content).
 */
export async function getPromotedAiJobTenderIds(
  prismaClient: PrismaClient | typeof import("@/lib/prisma").prisma,
  tenderIds: string[],
): Promise<Set<string>> {
  if (tenderIds.length === 0) return new Set();
  const jobs = await prismaClient.aiJob.findMany({
    where: {
      tenderId: { in: tenderIds },
      jobType: "AI_ANALYZE",
      supersededBy: null,
      promotedAt: { not: null },
      analysisInputHash: { not: null },
    },
    select: { tenderId: true },
    distinct: ["tenderId"],
  });
  return new Set(jobs.map((j) => j.tenderId).filter((id): id is string => Boolean(id)));
}

/**
 * Classify the canonical currentness for a batch of tenders.
 *
 * Verdict rules:
 *   - NOT_ANALYZED: zero requirements, or null/NOT_STARTED status.
 *   - CANONICAL_CLEAR: status is in CLEAR_EXTRACTION_STATES AND the tender
 *     has a non-superseded promoted AI job (proves currentness).
 *   - BLOCKED: anything else — including persisted CLEAR statuses that have
 *     no matching promoted AI job (stale/legacy/orphaned status).
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
  const promotedTenderIds = await getPromotedAiJobTenderIds(prismaClient, tenderIds);
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
    const hasPromotedJob = promotedTenderIds.has(row.tenderId);
    if (CLEAR_EXTRACTION_STATES.has(status) && hasPromotedJob) {
      verdicts.set(row.tenderId, {
        tenderId: row.tenderId,
        currentness: "CANONICAL_CLEAR",
        canonicalJobId: null, // Caller can resolve if needed
      });
    } else {
      // Persisted CLEAR with no promoted AI job → stale → BLOCKED.
      // Persisted BLOCKED status → BLOCKED.
      // Unknown status → BLOCKED (fail-closed).
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
