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

type Scheduler = (task: () => Promise<void>) => void;

/**
 * Best-effort wake for durable automatic upload/continuation stages.
 *
 * The caller's authenticated session is forwarded to the short dispatcher.
 * The dispatcher then owns the long /run-next invocation, so the request that
 * merely enqueued the durable stage is never kept alive for the whole worker
 * execution. Transactional job claims remain the duplicate-execution guard.
 */
export function scheduleRequestScopedWorkerWake(
  req: Request,
  jobType: RequestScopedUploadJobType | RequestScopedContinuationJobType,
  requestedCount = 1,
  schedule: Scheduler = after,
  fetchDispatcher: typeof fetch = fetch,
): boolean {
  const cookie = req.headers.get("cookie");
  if (!cookie) {
    logger.warn("[worker-wake] authenticated stage could not be nudged because the session cookie was unavailable", {
      jobType,
    });
    return false;
  }

  const count = Math.max(1, Math.min(MAX_REQUEST_SCOPED_WAKE_COUNT, Math.trunc(requestedCount) || 1));
  const requestUrl = new URL(req.url);
  const dispatchUrl = new URL("/api/ai-jobs/dispatch", requestUrl.origin);
  dispatchUrl.searchParams.set("jobType", jobType);
  const origin = requestUrl.origin;
  const referer = req.url;

  schedule(async () => {
    await Promise.all(Array.from({ length: count }, async () => {
      try {
        const response = await fetchDispatcher(dispatchUrl, {
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
          logger.warn("[worker-wake] durable stage remains queued because the dispatcher nudge was rejected", {
            jobType,
            status: response.status,
          });
        }
      } catch (error) {
        logger.warn("[worker-wake] durable stage remains queued because the dispatcher nudge failed", {
          jobType,
          errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
        });
      }
    }));
  });

  return true;
}
