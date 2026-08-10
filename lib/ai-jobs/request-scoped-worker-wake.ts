import { after } from "next/server";
import { logger } from "../observability";

export type RequestScopedUploadJobType = "EXTRACT_TEXT" | "VAULT_INGEST";

/**
 * Stages the worker may hand on to itself after finishing one.
 *
 * These are continuations the worker enqueued server-side, never entry points:
 * PROPOSAL_GENERATION exists only because a manual Run Engine succeeded, and
 * AUTO_FINALIZE only because generation succeeded. Waking them carries the
 * owner's original authority forward — it cannot manufacture new authority,
 * because a job that was never enqueued cannot be claimed.
 *
 * AI_ANALYZE and ENGINE_RUN are deliberately absent: those are the two manual
 * gates, and nothing here may start them.
 */
export type RequestScopedContinuationJobType = "PROPOSAL_GENERATION" | "AUTO_FINALIZE";

const MAX_REQUEST_SCOPED_WAKE_COUNT = 10;

/**
 * Best-effort wake for durable automatic upload stages.
 *
 * The request's authenticated session is forwarded to /api/ai-jobs/run-next,
 * so claimJobForCaller remains scoped to the same tenant/user. This helper is
 * deliberately unable to start AI_ANALYZE, ENGINE_RUN, generation, or any
 * other normal/manual workflow stage.
 *
 * EXTRACT_TEXT handles one source file per worker request. A secure upload may
 * persist up to ten files, so callers may request a bounded concurrent wake for
 * the complete batch. Transactional job claims prevent duplicate execution.
 */
export function scheduleRequestScopedWorkerWake(
  req: Request,
  jobType: RequestScopedUploadJobType | RequestScopedContinuationJobType,
  requestedCount = 1,
): boolean {
  const cookie = req.headers.get("cookie");
  if (!cookie) {
    logger.warn("[worker-wake] authenticated upload stage could not be nudged because the session cookie was unavailable", {
      jobType,
    });
    return false;
  }

  const count = Math.max(1, Math.min(MAX_REQUEST_SCOPED_WAKE_COUNT, Math.trunc(requestedCount) || 1));
  const requestUrl = new URL(req.url);
  const workerUrl = new URL("/api/ai-jobs/run-next", requestUrl.origin);
  workerUrl.searchParams.set("jobType", jobType);
  const origin = requestUrl.origin;
  const referer = req.url;

  after(async () => {
    await Promise.all(Array.from({ length: count }, async () => {
      try {
        const response = await fetch(workerUrl, {
          method: "POST",
          cache: "no-store",
          redirect: "manual",
          headers: {
            cookie,
            origin,
            referer,
            "x-requested-with": "XMLHttpRequest",
          },
        });
        if (!response.ok) {
          logger.warn("[worker-wake] durable upload stage remains queued because the request-scoped worker nudge was rejected", {
            jobType,
            status: response.status,
          });
        }
      } catch (error) {
        logger.warn("[worker-wake] durable upload stage remains queued because the request-scoped worker nudge failed", {
          jobType,
          errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
        });
      }
    }));
  });

  return true;
}
