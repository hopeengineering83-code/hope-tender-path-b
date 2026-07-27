export type DurableRetryJobType = "EXTRACT_TEXT" | "VAULT_INGEST" | "ENGINE_RUN" | "PROPOSAL_GENERATION";
export type RetryDecision = { retryable: boolean; blockerCode: string; delayMs: number | null };

const NON_RETRYABLE = /(?:NOT_FOUND_OR_FORBIDDEN|INVALID_PACKAGE|AUTHORITY|INTEGRITY|REVIEW_REQUIRED|UNAUTHORIZED|FORBIDDEN|CONTENT_HASH_MISMATCH|ZERO_REVIEWED|readiness gate)/i;
const RETRYABLE = /(?:TIMEOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|RATE.?LIMIT|TOO.?MANY.?REQUESTS|SERVICE.?UNAVAILABLE|TEMPORAR|STORAGE.*FAILED|PROVIDER|GENERATION_IN_PROGRESS)/i;
const BACKOFF_MS = [30_000, 60_000, 180_000, 600_000] as const;

export function classifyStageRetry(errorCodeOrMessage: string, retryCount: number): RetryDecision {
  const value = errorCodeOrMessage.slice(0, 500);
  if (NON_RETRYABLE.test(value)) return { retryable: false, blockerCode: "NON_RETRYABLE_AUTHORITY_OR_INTEGRITY_BLOCKER", delayMs: null };
  if (!RETRYABLE.test(value) || retryCount >= BACKOFF_MS.length) return { retryable: false, blockerCode: "RETRY_BUDGET_EXHAUSTED_OR_UNKNOWN_FAILURE", delayMs: null };
  return { retryable: true, blockerCode: "TRANSIENT_STAGE_FAILURE", delayMs: BACKOFF_MS[retryCount] };
}

export function isDurableRetryJobType(value: string): value is DurableRetryJobType {
  return value === "EXTRACT_TEXT" || value === "VAULT_INGEST" || value === "ENGINE_RUN" || value === "PROPOSAL_GENERATION";
}
