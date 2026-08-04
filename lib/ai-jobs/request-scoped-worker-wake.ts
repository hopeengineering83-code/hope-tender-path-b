import { after } from "next/server";
import { logger } from "../observability";

export type RequestScopedUploadJobType = "EXTRACT_TEXT" | "VAULT_INGEST";

/**
 * Best-effort wake for durable automatic upload stages.
 *
 * The request's authenticated session is forwarded to /api/ai-jobs/run-next,
 * so claimJobForCaller remains scoped to the same tenant/user. This helper is
 * deliberately unable to start AI_ANALYZE, ENGINE_RUN, generation, or any
 * other normal/manual workflow stage.
 */
export function scheduleRequestScopedWorkerWake(
  req: Request,
  jobType: RequestScopedUploadJobType,
): boolean {
  const cookie = req.headers.get("cookie");
  if (!cookie) {
    logger.warn("[worker-wake] authenticated upload stage could not be nudged because the session cookie was unavailable", {
      jobType,
    });
    return false;
  }

  const requestUrl = new URL(req.url);
  const workerUrl = new URL("/api/ai-jobs/run-next", requestUrl.origin);
  workerUrl.searchParams.set("jobType", jobType);
  const origin = requestUrl.origin;
  const referer = req.url;

  after(async () => {
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
  });

  return true;
}
