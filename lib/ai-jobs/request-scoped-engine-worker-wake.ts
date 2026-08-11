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
  return scheduleManualJobWake(req, "ENGINE_RUN", tenderId, schedule, fetchWorker);
}

/**
 * The same wake for a manually queued AI Analyze.
 *
 * Run Engine has had one of these since it was written; AI Analyze never did.
 * The owner clicked Run AI Analyze, the route created the job under verified
 * manual authority, and then nothing claimed it: the request-scoped upload
 * wakes are forbidden from naming a manual gate, and the drain cron fires only
 * from the repository default branch, so on a Preview deployment the job stayed
 * QUEUED and the panel truthfully reported "AI Analyze is queued" for as long
 * as anyone watched.
 *
 * This starts no gate. It is called only after the route has checked the
 * owner's authority and persisted the row, and a job that does not exist cannot
 * be claimed. The atomic claim still owns the QUEUED to RUNNING transition, so
 * a duplicate wake cannot run the work twice.
 */
export function scheduleRequestScopedAnalyzeWorkerWake(
  req: Request,
  tenderId: string,
  schedule: Scheduler = after,
  fetchWorker: typeof fetch = fetch,
): boolean {
  return scheduleManualJobWake(req, "AI_ANALYZE", tenderId, schedule, fetchWorker);
}

function scheduleManualJobWake(
  req: Request,
  jobType: "ENGINE_RUN" | "AI_ANALYZE",
  tenderId: string,
  schedule: Scheduler,
  fetchWorker: typeof fetch,
): boolean {
  const cookie = req.headers.get("cookie");
  if (!cookie) {
    logger.warn("[manual-worker-wake] job remains queued because the authenticated session cookie was unavailable");
    return false;
  }

  const requestUrl = new URL(req.url);
  const workerUrl = new URL("/api/ai-jobs/run-next", requestUrl.origin);
  workerUrl.searchParams.set("jobType", jobType);
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
        logger.warn("[manual-worker-wake] job remains queued because the worker wake was rejected", {
          status: response.status,
        });
      }
    } catch (error) {
      logger.warn("[manual-worker-wake] job remains queued because the worker wake failed", {
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    }
  });
  return true;
}
