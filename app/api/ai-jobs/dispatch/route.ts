import { after, NextResponse } from "next/server";
import { requireRole, unauthorizedResponse } from "../../../../lib/auth";
import { logger } from "../../../../lib/observability";

/**
 * Short authenticated hand-off between a request-scoped wake and the durable
 * worker. The caller receives 202 immediately; only this separate invocation
 * stays alive for the long /run-next execution.
 *
 * This route cannot create jobs and cannot start a manual gate. It may only
 * nudge a durable job type that was already persisted by an authorized route.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const DISPATCHABLE_JOB_TYPES = new Set([
  "AI_ANALYZE",
  "ENGINE_RUN",
  "EXTRACT_TEXT",
  "VAULT_INGEST",
  "PROPOSAL_GENERATION",
  "AUTO_FINALIZE",
] as const);

type DispatchDeps = {
  authorize?: () => Promise<{ id: string }>;
  schedule?: (task: () => Promise<void>) => void;
  fetchWorker?: typeof fetch;
};

function safeJobType(value: string | null): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return DISPATCHABLE_JOB_TYPES.has(normalized as never) ? normalized : null;
}

export async function dispatchWorkerRequest(req: Request, deps: DispatchDeps = {}) {
  const authorize = deps.authorize ?? (async () => requireRole("ADMIN", "PROPOSAL_MANAGER"));
  const schedule = deps.schedule ?? after;
  const fetchWorker = deps.fetchWorker ?? fetch;

  try {
    await authorize();
  } catch {
    return unauthorizedResponse();
  }

  const cookie = req.headers.get("cookie");
  if (!cookie) return unauthorizedResponse();

  const requestUrl = new URL(req.url);
  const jobType = safeJobType(requestUrl.searchParams.get("jobType"));
  if (!jobType) {
    return NextResponse.json({
      error: "A supported durable jobType is required",
      code: "INVALID_DISPATCH_JOB_TYPE",
    }, { status: 400 });
  }

  const tenderId = requestUrl.searchParams.get("tenderId")?.trim() || null;
  if ((jobType === "AI_ANALYZE" || jobType === "ENGINE_RUN") && !tenderId) {
    return NextResponse.json({
      error: "tenderId is required for manual-gate worker dispatch",
      code: "DISPATCH_TENDER_ID_REQUIRED",
    }, { status: 400 });
  }

  const workerUrl = new URL("/api/ai-jobs/run-next", requestUrl.origin);
  workerUrl.searchParams.set("jobType", jobType);
  if (tenderId) workerUrl.searchParams.set("tenderId", tenderId);

  const origin = requestUrl.origin;
  const referer = req.url;

  schedule(async () => {
    try {
      const response = await fetchWorker(workerUrl, {
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
        logger.warn("[worker-dispatch] durable worker rejected the dispatched wake", {
          jobType,
          status: response.status,
        });
      }
    } catch (error) {
      logger.warn("[worker-dispatch] durable worker dispatch failed", {
        jobType,
        errorClass: error instanceof Error ? error.constructor.name : "UnknownError",
      });
    }
  });

  return NextResponse.json({
    accepted: true,
    jobType,
    tenderId,
  }, {
    status: 202,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  return dispatchWorkerRequest(req);
}
