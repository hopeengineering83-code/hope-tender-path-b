export type DurableRetryJobType = "EXTRACT_TEXT" | "VAULT_INGEST" | "ENGINE_RUN" | "PROPOSAL_GENERATION" | "AUTO_FINALIZE";
export type RetryDecision = { retryable: boolean; blockerCode: string; delayMs: number | null };

// A superseded run is not a failure anyone needs to act on. When the Engine's
// source revision moves while a job is in flight, enqueueEngineJobForCurrentSources
// has already cancelled the stale job and queued a fresh one bound to the new
// revision; the in-flight run then throws ENGINE_SOURCE_REVISION_STALE at its
// before/after checkpoint so it cannot promote output built from inputs that
// no longer exist. That outcome is correct and self-healing.
//
// It is classified separately because the generic fallback below called it
// RETRY_BUDGET_EXHAUSTED_OR_UNKNOWN_FAILURE — claiming a budget was spent when
// no retry was ever attempted, and calling a precisely known condition
// unknown. Retrying is still refused (the revision will not un-change), but
// the code now names what actually happened.
const SUPERSEDED = /ENGINE_SOURCE_REVISION_STALE/i;
const NON_RETRYABLE = /(?:NOT_FOUND_OR_FORBIDDEN|INVALID_PACKAGE|AUTHORITY|INTEGRITY|REVIEW_REQUIRED|UNAUTHORIZED|FORBIDDEN|CONTENT_HASH_MISMATCH|ZERO_REVIEWED|readiness gate|source grounding incomplete)/i;
const RETRYABLE = /(?:TIMEOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|RATE.?LIMIT|TOO.?MANY.?REQUESTS|SERVICE.?UNAVAILABLE|TEMPORAR|STORAGE.*FAILED|PROVIDER|GENERATION_IN_PROGRESS)/i;
const BACKOFF_MS = [30_000, 60_000, 180_000, 600_000] as const;

export function classifyStageRetry(errorCodeOrMessage: string, retryCount: number): RetryDecision {
  const value = errorCodeOrMessage.slice(0, 500);
  if (SUPERSEDED.test(value)) return { retryable: false, blockerCode: "ENGINE_SOURCE_SUPERSEDED", delayMs: null };
  if (NON_RETRYABLE.test(value)) return { retryable: false, blockerCode: "NON_RETRYABLE_AUTHORITY_OR_INTEGRITY_BLOCKER", delayMs: null };
  if (!RETRYABLE.test(value) || retryCount >= BACKOFF_MS.length) return { retryable: false, blockerCode: "RETRY_BUDGET_EXHAUSTED_OR_UNKNOWN_FAILURE", delayMs: null };
  return { retryable: true, blockerCode: "TRANSIENT_STAGE_FAILURE", delayMs: BACKOFF_MS[retryCount] };
}

/** True when a stage failure is an expected supersede, not an incident. */
export function isSupersededStageFailure(errorCodeOrMessage: string): boolean {
  return SUPERSEDED.test(errorCodeOrMessage.slice(0, 500));
}

export function isDurableRetryJobType(value: string): value is DurableRetryJobType {
  return value === "EXTRACT_TEXT" || value === "VAULT_INGEST" || value === "ENGINE_RUN" || value === "PROPOSAL_GENERATION" || value === "AUTO_FINALIZE";
}
