import { after } from "next/server";
import { logger } from "../observability";

type Scheduler = (task: () => Promise<void>) => void;

/** Schedule exactly one authenticated wake for a manually queued Engine run. */
export function scheduleRequestScopedEngineWorkerWake(
  req: Request,
  tenderId: string,
  schedule: Scheduler = after,
  fetchWorker: typeof fetch = fetch,
): boolean {
  const cookie = req.headers.get("cookie");
  if (!cookie) {
    logger.warn("[engine-worker-wake] Engine job remains queued because the authenticated session cookie was unavailable");
    return false;
  }

  const requestUrl = new URL(req.url);
  const workerUrl = new URL("/api/ai-jobs/run-next", requestUrl.origin);
  workerUrl.searchParams.set("jobType", "ENGINE_RUN");
  workerUrl.searchParams.set("tenderId", tenderId);
  schedule(async () => {
    try {
      const response = await fetchWorker(workerUrl, {
        method: "POST",
        cache: "no-store",
        redirect: "manual",
        headers: {
          cookie,
          origin: requestUrl.origin,
          referer: req.url,
          "x-requested-with": "XMLHttpRequest",
        },
      });
      if (!response.ok) {
        logger.warn("[engine-worker-wake] Engine job remains queued because the worker wake was rejected", {
          status: response.status,
        });
      }
    } catch (error) {
      logger.warn("[engine-worker-wake] Engine job remains queued because the worker wake failed", {
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    }
  });
  return true;
}
