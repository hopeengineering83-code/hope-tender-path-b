/**
 * AI Analyze Retry Service — provider-aware bounded exponential retry.
 *
 * Replaces fixed blind-timer retry with a server-side scheduler that:
 *   1. Persists retry state (count, next retry time, reason, last
 *      provider availability) in AiAnalyzeRetryState.
 *   2. Classifies failures as retryable vs non-retryable.
 *   3. Uses bounded exponential delay: 30s → 1m → 3m → 10m → stop.
 *   4. Only re-arms when at least one provider is actually eligible
 *      (not in cooldown, configured, attempt budget not exhausted).
 *   5. Resumes from successful AiAnalyzeChunk checkpoints — does NOT
 *      restart completed chunks.
 *   6. Does NOT create a second active job for the same tender + hash.
 *
 * Non-retryable failure categories (auto-retry NEVER fires):
 *   - EXTRACTION_CORRUPTED / EXTRACTION_NOT_READY / OCR_REQUIRED
 *   - TENDER_NOT_FOUND / OWNERSHIP_REVOKED / FORBIDDEN
 *   - CONTENT_HASH_CHANGED / ANALYSIS_VERSION_MISMATCH
 *   - GROUNDING_TOO_WEAK / EVIDENCE_GATE_FAILED
 *   - CONFIGURATION_INVALID (non-retryable provider config error)
 *
 * Retryable failure categories (auto-retry fires with backoff):
 *   - AI_PROVIDERS_EXHAUSTED / ATTEMPT_BUDGET_EXHAUSTED
 *   - RATE_LIMITED / PROVIDER_5XX / PROVIDER_TIMEOUT
 *   - PARTIAL_SUCCESS (some chunks completed, some failed)
 */

import { prisma, prismaReady } from "../prisma";
import { getMinCooldownExpiryMs } from "../ai-provider-health";
import { isProviderConfigured, CANONICAL_AI_PROVIDER_ORDER } from "../ai-provider-registry";

// ── Bounded exponential delay schedule ─────────────────────────────────
// 30s, 1m, 3m, 10m — then stop and require manual retry.
export const RETRY_DELAYS_MS = [30_000, 60_000, 180_000, 600_000] as const;
export const MAX_RETRY_COUNT = RETRY_DELAYS_MS.length; // 4

// ── Non-retryable failure categories ──────────────────────────────────
// These NEVER trigger auto-retry. The user must fix the root cause
// (re-upload, OCR, fix permissions, etc.) and manually click Retry.
export const NON_RETRYABLE_CATEGORIES = new Set([
  "EXTRACTION_CORRUPTED",
  "EXTRACTION_NOT_READY",
  "OCR_REQUIRED",
  "TENDER_NOT_FOUND",
  "OWNERSHIP_REVOKED",
  "FORBIDDEN",
  "CONTENT_HASH_CHANGED",
  "ANALYSIS_VERSION_MISMATCH",
  "GROUNDING_TOO_WEAK",
  "EVIDENCE_GATE_FAILED",
  "CONFIGURATION_INVALID",
  "UNAUTHORIZED",
  "INVALID_TENDER_STATE",
]);

// ── Retryable failure categories ──────────────────────────────────────
export const RETRYABLE_CATEGORIES = new Set([
  "AI_PROVIDERS_EXHAUSTED",
  "ATTEMPT_BUDGET_EXHAUSTED",
  "RATE_LIMITED",
  "PROVIDER_5XX",
  "PROVIDER_TIMEOUT",
  "PARTIAL_SUCCESS",
  "NETWORK_ERROR",
  "UNKNOWN",
]);

/**
 * Classify a failure as retryable or non-retryable.
 *
 * Returns { retryable, reason } — the caller persists this in
 * AiAnalyzeRetryState.failureCategory and .nonRetryable.
 */
export function classifyFailure(
  errorMessage: string | undefined,
  failureCategory: string | undefined,
  jobStatus: string,
): { retryable: boolean; category: string; reason: string } {
  const cat = failureCategory ?? "UNKNOWN";
  const msg = (errorMessage ?? "").toLowerCase();

  // Explicit non-retryable categories
  if (NON_RETRYABLE_CATEGORIES.has(cat)) {
    return { retryable: false, category: cat, reason: `Non-retryable: ${cat}` };
  }

  // Keyword-based non-retryable detection from error message
  if (/extraction.*corrupt|corrupted.*extraction/i.test(msg)) {
    return { retryable: false, category: "EXTRACTION_CORRUPTED", reason: "Extraction is corrupted — OCR or re-upload required" };
  }
  if (/ocr.*required|requires?\s+ocr/i.test(msg)) {
    return { retryable: false, category: "OCR_REQUIRED", reason: "OCR required" };
  }
  if (/not found|access denied|ownership/i.test(msg)) {
    return { retryable: false, category: "TENDER_NOT_FOUND", reason: "Tender not found or access denied" };
  }
  if (/content.*hash.*changed|hash.*mismatch/i.test(msg)) {
    return { retryable: false, category: "CONTENT_HASH_CHANGED", reason: "Content hash changed — re-run analysis" };
  }
  if (/grounding|source.*ungrounded|weak.*grounding/i.test(msg)) {
    return { retryable: false, category: "GROUNDING_TOO_WEAK", reason: "Source grounding too weak" };
  }
  if (/401|unauthorized|forbidden|403/i.test(msg)) {
    return { retryable: false, category: "UNAUTHORIZED", reason: "Authentication failure (401/403)" };
  }

  // Explicit retryable categories
  if (RETRYABLE_CATEGORIES.has(cat)) {
    return { retryable: true, category: cat, reason: `Retryable: ${cat}` };
  }

  // PARTIAL_SUCCESS is always retryable (some chunks may succeed on retry)
  if (jobStatus === "PARTIAL_SUCCESS") {
    return { retryable: true, category: "PARTIAL_SUCCESS", reason: "Partial success — retry may complete remaining chunks" };
  }

  // Default: retryable UNKNOWN (network errors, transient failures)
  return { retryable: true, category: "UNKNOWN", reason: "Unknown/transient failure" };
}

/**
 * Check if at least one provider is currently eligible (configured +
 * not cooling down). This is the server-side availability gate.
 */
export function isAnyProviderEligible(): boolean {
  const configured = CANONICAL_AI_PROVIDER_ORDER.filter((p) => isProviderConfigured(p));
  if (configured.length === 0) return false;
  const minCooldown = getMinCooldownExpiryMs();
  // getMinCooldownExpiryMs returns 0 if any provider is available now,
  // null if no providers are configured, or a positive number for the
  // wait time until the next provider becomes available.
  return minCooldown === 0;
}

/**
 * Record or update the retry state for a job after it terminates.
 *
 * Called by the AI_ANALYZE handler (via run-next) when a job ends as
 * PARTIAL_SUCCESS or FAILED. Persists:
 *   - retryCount (incremented on each retryable termination)
 *   - nextRetryAt (computed from RETRY_DELAYS_MS[retryCount])
 *   - retryReason (human-readable)
 *   - failureCategory (classified)
 *   - nonRetryable (true for non-retryable categories)
 *   - lastProviderAvailable + lastCheckedAt
 *
 * If nonRetryable or retryCount >= MAX_RETRY_COUNT, nextRetryAt is set
 * to null (no more automatic retries — user must click Retry Now).
 */
export async function recordRetryState(
  jobId: string,
  tenderId: string,
  userId: string,
  contentHash: string,
  errorMessage: string | undefined,
  failureCategory: string | undefined,
  jobStatus: string,
): Promise<{ retryable: boolean; nextRetryAt: Date | null; retryCount: number; category: string }> {
  await prismaReady;

  const classification = classifyFailure(errorMessage, failureCategory, jobStatus);
  const providerAvailable = isAnyProviderEligible();
  const now = new Date();

  // Find existing retry state for this job
  const existing = await prisma.aiAnalyzeRetryState.findUnique({
    where: { jobId },
  });

  const currentRetryCount = existing?.retryCount ?? 0;
  const newRetryCount = currentRetryCount + 1;

  // Determine nextRetryAt:
  // - Non-retryable → null (stop)
  // - RetryCount exceeded → null (stop, require manual retry)
  // - Provider not available → schedule based on backoff (the scheduler
  //   will check provider availability before actually re-arming)
  let nextRetryAt: Date | null = null;
  if (classification.retryable && newRetryCount <= MAX_RETRY_COUNT) {
    const delayIdx = Math.min(newRetryCount - 1, RETRY_DELAYS_MS.length - 1);
    const delayMs = RETRY_DELAYS_MS[delayIdx];
    nextRetryAt = new Date(now.getTime() + delayMs);
  }

  const data = {
    jobId,
    tenderId,
    userId,
    contentHash,
    retryCount: newRetryCount,
    nextRetryAt,
    retryReason: classification.reason,
    failureCategory: classification.category,
    nonRetryable: !classification.retryable,
    lastProviderAvailable: providerAvailable,
    lastCheckedAt: now,
  };

  await prisma.aiAnalyzeRetryState.upsert({
    where: { jobId },
    create: data,
    update: data,
  });

  return {
    retryable: classification.retryable,
    nextRetryAt,
    retryCount: newRetryCount,
    category: classification.category,
  };
}

/**
 * Get the retry state for a job (for the UI to display).
 */
export async function getRetryState(jobId: string) {
  await prismaReady;
  return prisma.aiAnalyzeRetryState.findUnique({
    where: { jobId },
    select: {
      retryCount: true,
      nextRetryAt: true,
      retryReason: true,
      failureCategory: true,
      nonRetryable: true,
      lastProviderAvailable: true,
      lastCheckedAt: true,
    },
  });
}

/**
 * Find jobs that are due for automatic retry.
 *
 * Called by a scheduler (Vercel cron / GitHub Actions → run-next with
 * a special flag). Returns jobs where:
 *   - nonRetryable = false
 *   - nextRetryAt <= now
 *   - the AiJob is in PARTIAL_SUCCESS or FAILED status
 *   - at least one provider is currently eligible
 *
 * The scheduler re-arms each due job by setting it back to QUEUED
 * (preserving SUCCEEDED chunks for resume). It does NOT create a new
 * job — it reuses the existing one.
 */
export async function findJobsDueForRetry(limit = 5): Promise<Array<{
  jobId: string;
  tenderId: string;
  userId: string;
  contentHash: string;
  retryCount: number;
}>> {
  await prismaReady;

  if (!isAnyProviderEligible()) {
    return []; // No provider available — don't re-arm anything
  }

  const now = new Date();
  const dueStates = await prisma.aiAnalyzeRetryState.findMany({
    where: {
      nonRetryable: false,
      nextRetryAt: { lte: now },
      job: {
        status: { in: ["PARTIAL_SUCCESS", "FAILED"] },
      },
    },
    take: limit,
    orderBy: { nextRetryAt: "asc" },
    select: {
      jobId: true,
      tenderId: true,
      userId: true,
      contentHash: true,
      retryCount: true,
    },
  });

  return dueStates;
}

/**
 * Re-arm a job for retry — set it back to QUEUED so run-next can claim it.
 *
 * IMPORTANT: This does NOT create a new job. It reuses the existing
 * AiJob row, preserving:
 *   - SUCCEEDED AiAnalyzeChunk rows (resume from checkpoint)
 *   - analysisInputHash (content-hash validation — no retry if hash changed)
 *   - the retryCount in AiAnalyzeRetryState
 *
 * Before re-arming, verifies:
 *   - The job is still PARTIAL_SUCCESS or FAILED (not SUCCEEDED)
 *   - The content hash still matches the current tender content
 *   - At least one provider is currently eligible
 *
 * Returns true if the job was re-armed, false if it was skipped.
 */
export async function rearmJobForRetry(jobId: string): Promise<boolean> {
  await prismaReady;

  if (!isAnyProviderEligible()) {
    return false; // No provider available — don't re-arm
  }

  const job = await prisma.aiJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      tenderId: true,
      userId: true,
      status: true,
      analysisInputHash: true,
    },
  });

  if (!job) return false;
  if (job.status !== "PARTIAL_SUCCESS" && job.status !== "FAILED") return false;

  // Verify content hash still matches current tender content.
  // This is the critical "no retry if content hash changed" guard.
  // We re-compute the hash from the tender's current files and compare
  // against the job's analysisInputHash. If they differ, the tender
  // content changed — the user must manually re-run analysis.
  const { computeAnalysisContentHash, buildTenderAnalysisContent } = await import("../engine/tender-analysis-content");
  const tender = await prisma.tender.findFirst({
    where: { id: job.tenderId!, userId: job.userId },
    include: { files: { select: { id: true, originalFileName: true, extractedText: true, createdAt: true } } },
  });
  if (!tender) return false; // Tender deleted or ownership revoked

  const company = await prisma.company.findUnique({
    where: { userId: job.userId },
    include: { documents: { select: { category: true, originalFileName: true, extractedText: true }, take: 5, orderBy: { createdAt: "desc" } } },
  }).catch(() => null);

  const currentContent = buildTenderAnalysisContent(tender, company ?? undefined);
  const currentHash = computeAnalysisContentHash(currentContent);

  if (currentHash !== job.analysisInputHash) {
    // Content hash changed — mark non-retryable so the scheduler stops
    await prisma.aiAnalyzeRetryState.update({
      where: { jobId },
      data: {
        nonRetryable: true,
        failureCategory: "CONTENT_HASH_CHANGED",
        retryReason: "Content hash changed — manual re-run required",
        nextRetryAt: null,
      },
    });
    return false;
  }

  // Re-arm: set job back to QUEUED. SUCCEEDED chunks are preserved
  // (createAnalysisJob's resume logic skips them).
  await prisma.aiJob.update({
    where: { id: jobId },
    data: {
      status: "QUEUED",
      startedAt: null,
      finishedAt: null,
      errorMessage: null,
    },
  });

  // Clear nextRetryAt — the scheduler will set it again if this retry
  // also fails.
  await prisma.aiAnalyzeRetryState.update({
    where: { jobId },
    data: { nextRetryAt: null },
  });

  return true;
}
