/**
 * AI Analyze Retry Service — provider-aware, durable, bounded-backoff retry.
 *
 * This is the SERVER-SIDE backstop for the durable AI_ANALYZE workflow. The
 * panel/tender-detail UI already auto-retries while a browser is open, but a
 * run that stops short when no one is watching would otherwise sit idle. This
 * scheduler persists retry state and lets a cron (app/api/cron/ai-analyze-retry)
 * re-arm jobs the moment a provider is eligible again.
 *
 * Guarantees:
 *   1. Retry state is durable (AiAnalyzeRetryState, one row per AiJob).
 *   2. Failures are classified retryable vs non-retryable — corrupted
 *      extraction, ownership/auth, content-hash drift, and weak grounding
 *      NEVER auto-retry.
 *   3. Bounded exponential delay: 30s → 1m → 3m → 10m → stop (4 attempts).
 *   4. Re-arm only when at least one provider is actually eligible.
 *   5. Resume from SUCCEEDED AiAnalyzeChunk checkpoints — never restart from 0.
 *   6. Never creates a second active job for the same tender + content hash.
 */
import { prisma, prismaReady } from "../prisma";
import { getMinCooldownExpiryMs } from "../ai-provider-health";
import { isProviderConfigured, CANONICAL_AI_PROVIDER_ORDER } from "../ai-provider-registry";

// Bounded exponential delay: 30s, 1m, 3m, 10m — then stop.
export const RETRY_DELAYS_MS = [30_000, 60_000, 180_000, 600_000] as const;
export const MAX_RETRY_COUNT = RETRY_DELAYS_MS.length;

// Non-retryable categories — NEVER auto-retry (a retry cannot fix these; they
// need OCR / re-upload / manual confirmation / a fresh run).
export const NON_RETRYABLE_CATEGORIES = new Set<string>([
  "EXTRACTION_CORRUPTED", "EXTRACTION_NOT_READY", "OCR_REQUIRED",
  "TENDER_NOT_FOUND", "OWNERSHIP_REVOKED", "FORBIDDEN",
  "CONTENT_HASH_CHANGED", "ANALYSIS_VERSION_MISMATCH",
  "GROUNDING_TOO_WEAK", "EVIDENCE_GATE_FAILED",
  "CONFIGURATION_INVALID", "UNAUTHORIZED", "INVALID_TENDER_STATE",
]);

// Retryable categories — transient/provider conditions a later attempt can clear.
export const RETRYABLE_CATEGORIES = new Set<string>([
  "AI_PROVIDERS_EXHAUSTED", "ATTEMPT_BUDGET_EXHAUSTED", "PROVIDER_EXHAUSTED",
  "RATE_LIMITED", "PROVIDER_5XX", "PROVIDER_TIMEOUT",
  "PARTIAL_SUCCESS", "NETWORK_ERROR", "UNKNOWN",
]);

export type FailureClassification = { retryable: boolean; category: string; reason: string };

/**
 * Decide whether a stopped run may auto-retry. Category wins first; the message
 * is a secondary signal for failures that arrived without a clean category.
 * Default for a genuinely-unknown failure is retryable (transient) — the
 * attempt cap still bounds it.
 */
export function classifyFailure(
  errorMessage: string | undefined,
  failureCategory: string | undefined,
  jobStatus: string,
): FailureClassification {
  const cat = failureCategory ?? "UNKNOWN";
  const msg = (errorMessage ?? "").toLowerCase();

  if (NON_RETRYABLE_CATEGORIES.has(cat)) return { retryable: false, category: cat, reason: `Non-retryable: ${cat}` };
  if (/extraction.*corrupt|corrupted.*extraction/i.test(msg)) return { retryable: false, category: "EXTRACTION_CORRUPTED", reason: "Extraction is corrupted — OCR or re-upload required" };
  if (/ocr.*required|requires?\s+ocr/i.test(msg)) return { retryable: false, category: "OCR_REQUIRED", reason: "OCR required before analysis can succeed" };
  if (/not found|access denied|ownership/i.test(msg)) return { retryable: false, category: "TENDER_NOT_FOUND", reason: "Tender not found or access denied" };
  if (/content.*hash.*changed|hash.*mismatch/i.test(msg)) return { retryable: false, category: "CONTENT_HASH_CHANGED", reason: "Tender content changed — re-run analysis" };
  if (/grounding|weak.*grounding|ungrounded/i.test(msg)) return { retryable: false, category: "GROUNDING_TOO_WEAK", reason: "Mandatory requirements lack source grounding" };
  if (/\b401\b|\b403\b|unauthorized|forbidden/i.test(msg)) return { retryable: false, category: "UNAUTHORIZED", reason: "Authentication/authorization failure" };

  // A partial run carries no explicit category — label it PARTIAL_SUCCESS
  // (more meaningful than the generic UNKNOWN bucket) before the catch-all.
  if (jobStatus === "PARTIAL_SUCCESS" && (cat === "UNKNOWN" || cat === "PARTIAL_SUCCESS")) {
    return { retryable: true, category: "PARTIAL_SUCCESS", reason: "Partial success — retry may complete remaining chunks" };
  }
  if (RETRYABLE_CATEGORIES.has(cat)) return { retryable: true, category: cat, reason: `Retryable: ${cat}` };
  return { retryable: true, category: "UNKNOWN", reason: "Unknown/transient failure — retry may clear it" };
}

/**
 * Server-side provider eligibility. True only when at least one provider is
 * configured AND no provider is cooling down. This is what gates BOTH whether
 * we schedule a retry timer and whether the cron actually re-arms.
 */
export function isAnyProviderEligible(): boolean {
  const configured = CANONICAL_AI_PROVIDER_ORDER.filter((p) => isProviderConfigured(p));
  if (configured.length === 0) return false;
  return getMinCooldownExpiryMs() === 0;
}

/**
 * Persist retry state after a job ends PARTIAL_SUCCESS/FAILED. Computes the
 * next backoff slot (null once non-retryable or the attempt cap is reached).
 */
export async function recordRetryState(
  jobId: string, tenderId: string, userId: string, contentHash: string,
  errorMessage: string | undefined, failureCategory: string | undefined, jobStatus: string,
): Promise<{ retryable: boolean; nextRetryAt: Date | null; retryCount: number; category: string }> {
  await prismaReady;
  const classification = classifyFailure(errorMessage, failureCategory, jobStatus);
  const providerAvailable = isAnyProviderEligible();
  const now = new Date();
  const existing = await prisma.aiAnalyzeRetryState.findUnique({ where: { jobId } });
  const newRetryCount = (existing?.retryCount ?? 0) + 1;

  let nextRetryAt: Date | null = null;
  if (classification.retryable && newRetryCount <= MAX_RETRY_COUNT) {
    const delayIdx = Math.min(newRetryCount - 1, RETRY_DELAYS_MS.length - 1);
    nextRetryAt = new Date(now.getTime() + RETRY_DELAYS_MS[delayIdx]);
  }

  const data = {
    jobId, tenderId, userId, contentHash,
    retryCount: newRetryCount, nextRetryAt,
    retryReason: classification.reason,
    failureCategory: classification.category,
    nonRetryable: !classification.retryable,
    lastProviderAvailable: providerAvailable,
    lastCheckedAt: now,
  };

  await prisma.aiAnalyzeRetryState.upsert({ where: { jobId }, create: data, update: data });
  return { retryable: classification.retryable, nextRetryAt, retryCount: newRetryCount, category: classification.category };
}

/**
 * Convenience wrapper used by run-next: loads the job + its failed-chunk
 * category and persists retry state. Returns null if the job is gone or has no
 * tender (nothing to retry). Best-effort — callers should not let a failure
 * here break the worker loop.
 */
export async function recordRetryStateForJob(
  jobId: string,
  jobStatus: string,
): Promise<{ retryable: boolean; nextRetryAt: Date | null; retryCount: number; category: string } | null> {
  await prismaReady;
  const job = await prisma.aiJob.findUnique({
    where: { id: jobId },
    select: {
      id: true, tenderId: true, userId: true, analysisInputHash: true, errorMessage: true,
      analyzeChunks: { where: { status: "FAILED" }, select: { failureCategory: true }, take: 1 },
    },
  });
  if (!job || !job.tenderId) return null;
  const failureCategory = job.analyzeChunks[0]?.failureCategory ?? undefined;
  return recordRetryState(
    job.id, job.tenderId, job.userId, job.analysisInputHash ?? "",
    job.errorMessage ?? undefined, failureCategory, jobStatus,
  );
}

export async function getRetryState(jobId: string) {
  await prismaReady;
  return prisma.aiAnalyzeRetryState.findUnique({
    where: { jobId },
    select: {
      retryCount: true, nextRetryAt: true, retryReason: true, failureCategory: true,
      nonRetryable: true, lastProviderAvailable: true, lastCheckedAt: true,
    },
  });
}

/**
 * Scheduler query: rows that are retryable, due, AND whose job is still in a
 * terminal-stopped state — but only when a provider is currently eligible.
 */
export async function findJobsDueForRetry(
  limit = 5,
): Promise<Array<{ jobId: string; tenderId: string; userId: string; contentHash: string; retryCount: number }>> {
  await prismaReady;
  if (!isAnyProviderEligible()) return [];
  const now = new Date();
  return prisma.aiAnalyzeRetryState.findMany({
    where: {
      nonRetryable: false,
      nextRetryAt: { lte: now },
      job: { status: { in: ["PARTIAL_SUCCESS", "FAILED"] } },
    },
    take: limit,
    orderBy: { nextRetryAt: "asc" },
    select: { jobId: true, tenderId: true, userId: true, contentHash: true, retryCount: true },
  });
}

/**
 * Re-arm a stopped job for another attempt: verify a provider is eligible and
 * the tender content hash is unchanged (a changed hash makes the run
 * non-retryable — the old chunks no longer describe the current document),
 * then flip the job back to QUEUED. SUCCEEDED AiAnalyzeChunk rows are preserved
 * so executeAnalysis resumes from the last completed chunk. Returns true when
 * the job was re-queued.
 */
export async function rearmJobForRetry(jobId: string): Promise<boolean> {
  await prismaReady;
  if (!isAnyProviderEligible()) return false;

  const job = await prisma.aiJob.findUnique({
    where: { id: jobId },
    select: { id: true, tenderId: true, userId: true, status: true, analysisInputHash: true },
  });
  if (!job || !job.tenderId) return false;
  if (job.status !== "PARTIAL_SUCCESS" && job.status !== "FAILED") return false;

  // Verify the tender content still hashes to the same value the job ran on.
  const { computeAnalysisContentHash, buildTenderAnalysisContent } = await import("../engine/tender-analysis-content");
  const tender = await prisma.tender.findFirst({
    where: { id: job.tenderId, userId: job.userId },
    include: { files: { select: { id: true, originalFileName: true, extractedText: true, classification: true, createdAt: true } } },
  });
  if (!tender) return false;

  const company = await prisma.company.findUnique({
    where: { userId: job.userId },
    include: { documents: { select: { category: true, originalFileName: true, extractedText: true }, take: 5, orderBy: { createdAt: "desc" } } },
  }).catch(() => null);

  const currentHash = computeAnalysisContentHash(buildTenderAnalysisContent(tender, company ?? undefined));
  if (currentHash !== job.analysisInputHash) {
    await prisma.aiAnalyzeRetryState.update({
      where: { jobId },
      data: {
        nonRetryable: true,
        failureCategory: "CONTENT_HASH_CHANGED",
        retryReason: "Tender content changed since the run — a fresh analysis is required",
        nextRetryAt: null,
      },
    }).catch(() => {});
    return false;
  }

  // Re-arm. claimJobForCaller only claims QUEUED rows; SUCCEEDED chunks stay
  // intact so the next run continues from the last completed chunk.
  await prisma.aiJob.update({
    where: { id: jobId },
    data: { status: "QUEUED", startedAt: null, finishedAt: null, errorMessage: null },
  });
  await prisma.aiAnalyzeRetryState.update({ where: { jobId }, data: { nextRetryAt: null } }).catch(() => {});
  return true;
}
