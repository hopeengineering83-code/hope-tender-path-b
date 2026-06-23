/**
 * AI Analyze Retry Service — provider-aware bounded exponential retry.
 *
 * Replaces fixed blind-timer retry with a server-side scheduler that:
 *   1. Persists retry state in AiAnalyzeRetryState.
 *   2. Classifies failures as retryable vs non-retryable.
 *   3. Uses bounded exponential delay: 30s → 1m → 3m → 10m → stop.
 *   4. Only re-arms when at least one provider is actually eligible.
 *   5. Resumes from successful AiAnalyzeChunk checkpoints.
 *   6. Does NOT create a second active job for the same tender + hash.
 */
import { prisma, prismaReady } from "../prisma";
import { getMinCooldownExpiryMs } from "../ai-provider-health";
import { isProviderConfigured, CANONICAL_AI_PROVIDER_ORDER } from "../ai-provider-registry";

// Bounded exponential delay: 30s, 1m, 3m, 10m — then stop.
export const RETRY_DELAYS_MS = [30_000, 60_000, 180_000, 600_000] as const;
export const MAX_RETRY_COUNT = RETRY_DELAYS_MS.length;

// Non-retryable categories — NEVER auto-retry
export const NON_RETRYABLE_CATEGORIES = new Set([
  "EXTRACTION_CORRUPTED", "EXTRACTION_NOT_READY", "OCR_REQUIRED",
  "TENDER_NOT_FOUND", "OWNERSHIP_REVOKED", "FORBIDDEN",
  "CONTENT_HASH_CHANGED", "ANALYSIS_VERSION_MISMATCH",
  "GROUNDING_TOO_WEAK", "EVIDENCE_GATE_FAILED",
  "CONFIGURATION_INVALID", "UNAUTHORIZED", "INVALID_TENDER_STATE",
]);

// Retryable categories
export const RETRYABLE_CATEGORIES = new Set([
  "AI_PROVIDERS_EXHAUSTED", "ATTEMPT_BUDGET_EXHAUSTED",
  "RATE_LIMITED", "PROVIDER_5XX", "PROVIDER_TIMEOUT",
  "PARTIAL_SUCCESS", "NETWORK_ERROR", "UNKNOWN",
]);

export function classifyFailure(
  errorMessage: string | undefined,
  failureCategory: string | undefined,
  jobStatus: string,
): { retryable: boolean; category: string; reason: string } {
  const cat = failureCategory ?? "UNKNOWN";
  const msg = (errorMessage ?? "").toLowerCase();

  if (NON_RETRYABLE_CATEGORIES.has(cat)) return { retryable: false, category: cat, reason: `Non-retryable: ${cat}` };
  if (/extraction.*corrupt|corrupted.*extraction/i.test(msg)) return { retryable: false, category: "EXTRACTION_CORRUPTED", reason: "Extraction is corrupted — OCR or re-upload required" };
  if (/ocr.*required|requires?\s+ocr/i.test(msg)) return { retryable: false, category: "OCR_REQUIRED", reason: "OCR required" };
  if (/not found|access denied|ownership/i.test(msg)) return { retryable: false, category: "TENDER_NOT_FOUND", reason: "Tender not found or access denied" };
  if (/content.*hash.*changed|hash.*mismatch/i.test(msg)) return { retryable: false, category: "CONTENT_HASH_CHANGED", reason: "Content hash changed — re-run analysis" };
  if (/grounding|source.*ungrounded|weak.*grounding/i.test(msg)) return { retryable: false, category: "GROUNDING_TOO_WEAK", reason: "Source grounding too weak" };
  if (/401|unauthorized|forbidden|403/i.test(msg)) return { retryable: false, category: "UNAUTHORIZED", reason: "Authentication failure (401/403)" };

  if (RETRYABLE_CATEGORIES.has(cat)) return { retryable: true, category: cat, reason: `Retryable: ${cat}` };
  if (jobStatus === "PARTIAL_SUCCESS") return { retryable: true, category: "PARTIAL_SUCCESS", reason: "Partial success — retry may complete remaining chunks" };
  return { retryable: true, category: "UNKNOWN", reason: "Unknown/transient failure" };
}

export function isAnyProviderEligible(): boolean {
  const configured = CANONICAL_AI_PROVIDER_ORDER.filter((p) => isProviderConfigured(p));
  if (configured.length === 0) return false;
  return getMinCooldownExpiryMs() === 0;
}

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

export async function getRetryState(jobId: string) {
  await prismaReady;
  return prisma.aiAnalyzeRetryState.findUnique({
    where: { jobId },
    select: { retryCount: true, nextRetryAt: true, retryReason: true, failureCategory: true, nonRetryable: true, lastProviderAvailable: true, lastCheckedAt: true },
  });
}

export async function findJobsDueForRetry(limit = 5): Promise<Array<{ jobId: string; tenderId: string; userId: string; contentHash: string; retryCount: number }>> {
  await prismaReady;
  if (!isAnyProviderEligible()) return [];
  const now = new Date();
  return prisma.aiAnalyzeRetryState.findMany({
    where: { nonRetryable: false, nextRetryAt: { lte: now }, job: { status: { in: ["PARTIAL_SUCCESS", "FAILED"] } } },
    take: limit, orderBy: { nextRetryAt: "asc" },
    select: { jobId: true, tenderId: true, userId: true, contentHash: true, retryCount: true },
  });
}

export async function rearmJobForRetry(jobId: string): Promise<boolean> {
  await prismaReady;
  if (!isAnyProviderEligible()) return false;

  const job = await prisma.aiJob.findUnique({ where: { id: jobId }, select: { id: true, tenderId: true, userId: true, status: true, analysisInputHash: true } });
  if (!job) return false;
  if (job.status !== "PARTIAL_SUCCESS" && job.status !== "FAILED") return false;

  // Verify content hash still matches current tender content
  const { computeAnalysisContentHash, buildTenderAnalysisContent } = await import("../engine/tender-analysis-content");
  const tender = await prisma.tender.findFirst({
    where: { id: job.tenderId!, userId: job.userId },
    include: { files: { select: { id: true, originalFileName: true, extractedText: true, createdAt: true } } },
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
      data: { nonRetryable: true, failureCategory: "CONTENT_HASH_CHANGED", retryReason: "Content hash changed — manual re-run required", nextRetryAt: null },
    });
    return false;
  }

  // Re-arm: set job back to QUEUED. SUCCEEDED chunks are preserved.
  await prisma.aiJob.update({ where: { id: jobId }, data: { status: "QUEUED", startedAt: null, finishedAt: null, errorMessage: null } });
  await prisma.aiAnalyzeRetryState.update({ where: { jobId }, data: { nextRetryAt: null } });
  return true;
}
