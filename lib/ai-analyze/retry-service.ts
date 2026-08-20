/**
 * AI Analyze Retry Service — provider-aware, durable, bounded-backoff retry.
 *
 * This is the SERVER-SIDE backstop for the durable AI_ANALYZE workflow. The
 * panel/tender-detail UI already auto-retries while a browser is open, but a
 * run that stops short when no one is watching would otherwise sit idle. This
 * scheduler persists retry state and lets the run-next cron (which fires every
 * 5 minutes via vercel.json) re-arm jobs the moment a provider is eligible
 * again. The re-arm logic lives inside /api/ai-jobs/run-next for automated
 * callers (Vercel cron / worker secret), so no separate cron entry is needed
 * (Vercel Hobby caps crons at 2).
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

// ─── Two kinds of "do not retry" ─────────────────────────────────────────────
//
// These used to be one set, and merging them is what left users permanently
// locked out of AI Analyze.
//
// TERMINAL failures are about the SOURCE or the CALLER: the document changed,
// the extraction is corrupt, the tender is gone, this user may not touch it.
// Nothing an operator does to provider configuration makes them retryable,
// because the thing that failed is not the provider. They stay non-retryable
// forever, and that is correct.
//
// PROVIDER-CLASS failures are about the PROVIDER or its CONFIGURATION: a bad
// API key, a model that no longer exists, an account that needs paying, a chain
// with nothing configured. These were in the same set — CONFIGURATION_INVALID
// and UNAUTHORIZED both sat in the terminal list — so a run that failed because
// an API key was wrong was recorded with nonRetryable: true, and
// createAnalysisJob then refused every future attempt on that content hash.
// Fixing the key changed nothing: the tender stayed dead, permanently, because
// of a provider fault that had already been repaired.
//
// They are separated below. Provider-class failures still stop AUTOMATIC retry
// — there is no point in a cron re-running a job against a key that is still
// wrong — but a NEW, AUTHENTICATED, MANUAL retry re-checks provider health and
// re-arms, provided the source bytes, content hash, ownership and provenance
// are all unchanged.

/**
 * Failures caused by the source document or the caller. Never retryable, by
 * any path, because a retry cannot change what failed.
 */
export const TERMINAL_FAILURE_CATEGORIES = new Set<string>([
  "EXTRACTION_CORRUPTED", "EXTRACTION_NOT_READY", "OCR_REQUIRED",
  "TENDER_NOT_FOUND", "OWNERSHIP_REVOKED", "FORBIDDEN",
  "CONTENT_HASH_CHANGED", "SOURCE_BYTES_CHANGED", "ANALYSIS_VERSION_MISMATCH",
  "GROUNDING_TOO_WEAK", "EVIDENCE_GATE_FAILED", "PROVENANCE_INTEGRITY_FAILED",
  "INVALID_TENDER_STATE",
]);

/**
 * Failures caused by the provider or its configuration. These stop automatic
 * retry but MUST NOT permanently block a manual one — an operator changing
 * provider configuration is exactly the event that makes them retryable again.
 */
export const PROVIDER_CONFIG_FAILURE_CATEGORIES = new Set<string>([
  "CONFIGURATION_INVALID", "PROVIDER_UNAUTHORIZED", "PROVIDER_AUTH_FAILED",
  "BILLING_BLOCKED", "MODEL_UNAVAILABLE", "NO_PROVIDER_CONFIGURED",
  "ALL_PROVIDERS_COOLING", "AI_PROVIDERS_EXHAUSTED",
]);

// Everything that must not auto-retry, from either cause.
export const NON_RETRYABLE_CATEGORIES = new Set<string>([
  ...TERMINAL_FAILURE_CATEGORIES,
  ...PROVIDER_CONFIG_FAILURE_CATEGORIES,
]);

/**
 * True when the recorded failure is genuinely terminal — the source or the
 * caller, not the provider. This is the ONLY thing allowed to block a fresh
 * manual retry.
 */
export function isTerminalFailureCategory(category: string | null | undefined): boolean {
  return category != null && TERMINAL_FAILURE_CATEGORIES.has(category);
}

/** True when the failure was the provider's or its configuration's fault. */
export function isProviderConfigFailureCategory(category: string | null | undefined): boolean {
  return category != null && PROVIDER_CONFIG_FAILURE_CATEGORIES.has(category);
}

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

  // A provider rejecting OUR API KEY and a user being denied access to SOMEONE
  // ELSE'S TENDER both used to land here as "UNAUTHORIZED" and both became
  // permanently non-retryable. They are opposite situations: one is an operator
  // fixing a key, the other is a user who must never see the record. Provider
  // auth is matched first, on provider-specific wording, and classified as a
  // provider-config failure so a manual retry can re-arm it once the key is
  // fixed. Everything else that says "unauthorized" stays terminal.
  if (/invalid api key|api key not valid|incorrect api key|invalid_api_key|authentication_error|provider.*(401|403)|(401|403).*provider/i.test(msg)) {
    return { retryable: false, category: "PROVIDER_AUTH_FAILED", reason: "Provider rejected the API key — fix provider configuration, then retry" };
  }
  if (/insufficient.?(balance|quota)|payment required|billing details|credit balance/i.test(msg)) {
    return { retryable: false, category: "BILLING_BLOCKED", reason: "Provider requires payment — configure a free provider, then retry" };
  }
  if (/model not found|unknown model|model_not_found|decommissioned|no such model/i.test(msg)) {
    return { retryable: false, category: "MODEL_UNAVAILABLE", reason: "Configured model is unavailable — fix the model, then retry" };
  }
  if (/\b401\b|\b403\b|unauthorized|forbidden/i.test(msg)) return { retryable: false, category: "OWNERSHIP_REVOKED", reason: "Caller is not authorized for this tender" };

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
  // ACTIVE files + UNBOUNDED vault — must reproduce the canonical analysisInputHash
  // the job was stored with (route/createAnalysisJob build from ACTIVE files + the
  // full vault; snapshot/gate recompute the same). A divergent input set here would
  // make currentHash !== job.analysisInputHash for tenders with a soft-deleted file
  // or >5 vault docs, wrongly marking the job non-retryable ("CONTENT_HASH_CHANGED").
  const tender = await prisma.tender.findFirst({
    where: { id: job.tenderId, userId: job.userId },
    include: { files: { where: { deletionStatus: "ACTIVE" }, select: { id: true, originalFileName: true, extractedText: true, classification: true, createdAt: true } } },
  });
  if (!tender) return false;

  const company = await prisma.company.findUnique({
    where: { userId: job.userId },
    include: { documents: { select: { category: true, originalFileName: true, extractedText: true } } },
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

// ─── Manual retry re-arm ─────────────────────────────────────────────────────
//
// A manual "Retry AI Analyze" is a NEW authenticated request from the owner,
// not a continuation of the old automatic schedule. It therefore asks a
// different question from the cron: not "has the backoff elapsed?" but "is the
// reason this stopped still true right now?".
//
// A provider-class failure is re-checked against CURRENT provider health,
// because the operator changing a key or a model is precisely the event that
// makes the old failure obsolete. A terminal failure is not re-checked, because
// nothing about provider configuration can undo a changed document.
//
// The integrity conditions are unconditional: whatever the failure category,
// re-arming requires the same owner, the same source bytes, the same content
// hash and intact provenance. Those are what make resuming from existing
// SUCCEEDED chunks sound — they are evidence about a specific document, and
// they may only be reused if it is still that document.

export type ManualRearmDecision = {
  allowed: boolean;
  reason:
    | "OK"
    | "TERMINAL_FAILURE"
    | "SOURCE_INTEGRITY_CHANGED"
    | "NO_PROVIDER_AVAILABLE";
  category: string | null;
  /** Operator/user-facing explanation. Safe to surface — no secrets. */
  message: string;
  /** True when the block would clear by fixing provider configuration. */
  clearableByProviderFix: boolean;
};

export type ManualRearmInput = {
  /** The recorded failure category from AiAnalyzeRetryState. */
  failureCategory: string | null | undefined;
  /** The persisted nonRetryable flag. Advisory here, never the final word. */
  nonRetryable: boolean;
  /** Whether source bytes, content hash, ownership and provenance still match. */
  sourceIntegrityIntact: boolean;
  /** Whether at least one provider is usable right now. */
  providerAvailable: boolean;
};

/**
 * Decide whether a new manual retry may re-arm a stopped job.
 *
 * The persisted `nonRetryable` flag is deliberately NOT consulted as the
 * decision. It records what was true when the run stopped, which is a fact
 * about the past; whether a retry can succeed now is a fact about the present.
 * Treating the stored flag as the answer is what made a repaired provider
 * fault permanent.
 */
export function decideManualRearm(input: ManualRearmInput): ManualRearmDecision {
  const category = input.failureCategory ?? null;

  // Integrity first. This is the one check that must pass regardless of why the
  // run stopped, because the SUCCEEDED chunks about to be reused are evidence
  // about a specific set of bytes.
  if (!input.sourceIntegrityIntact) {
    return {
      allowed: false,
      reason: "SOURCE_INTEGRITY_CHANGED",
      category,
      message:
        "The tender source has changed since this analysis ran. Start a fresh analysis — the existing partial results describe a different document.",
      clearableByProviderFix: false,
    };
  }

  if (isTerminalFailureCategory(category)) {
    return {
      allowed: false,
      reason: "TERMINAL_FAILURE",
      category,
      message: `This analysis cannot be retried: ${category}. It needs a fresh run or corrected source, not another attempt.`,
      clearableByProviderFix: false,
    };
  }

  // Provider-class failure, or an unknown/transient one. Both re-arm — but only
  // if a provider can actually serve the retry, so the run does not restart
  // just to fail again in the same place.
  if (!input.providerAvailable) {
    return {
      allowed: false,
      reason: "NO_PROVIDER_AVAILABLE",
      category,
      message:
        "No AI provider is currently usable. Configure or repair a free provider, then retry — this analysis is still eligible.",
      clearableByProviderFix: true,
    };
  }

  return {
    allowed: true,
    reason: "OK",
    category,
    message: isProviderConfigFailureCategory(category)
      ? `Previous failure (${category}) was a provider/configuration fault; a provider is available now, so the analysis is re-armed.`
      : "Re-armed for another attempt.",
    clearableByProviderFix: false,
  };
}

/**
 * Clear a stale provider-class block so the job can be re-armed.
 *
 * Only touches rows whose failure was provider-class; a terminal row is left
 * exactly as it is.
 */
export async function clearStaleProviderBlock(jobId: string): Promise<boolean> {
  await prismaReady;
  const existing = await prisma.aiAnalyzeRetryState.findUnique({
    where: { jobId },
    select: { failureCategory: true, nonRetryable: true },
  });
  if (!existing) return false;
  if (!isProviderConfigFailureCategory(existing.failureCategory)) return false;

  await prisma.aiAnalyzeRetryState.update({
    where: { jobId },
    data: {
      nonRetryable: false,
      retryCount: 0,
      nextRetryAt: null,
      retryReason: "Manual retry after provider configuration change — re-armed",
      lastProviderAvailable: true,
      lastCheckedAt: new Date(),
    },
  });
  return true;
}
