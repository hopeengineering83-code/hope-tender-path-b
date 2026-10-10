import { prisma } from "../prisma";
import { logger } from "../observability";
import { scheduleRetryWorkerWake } from "./request-scoped-worker-wake";

/** A queued job due this long with no claimant is stalled, not waiting. */
export const STALLED_AFTER_MS = 60_000;

/**
 * Nudge a tender's stalled job from the page the owner is looking at.
 *
 * A durable job can be left QUEUED and due with nothing to claim it: a wake
 * the platform rejected (508 on a deep self-call chain), a worker that ran out
 * of budget, a retry whose hand-off failed. The tender page polls this
 * tender's status while the owner watches, and the status route used to be
 * read-only, so the page reported "processing automatically" while nothing
 * was. This nudges the oldest such job through the authenticated dispatcher,
 * which can only wake a job that already exists — never create one, never
 * start a manual gate on its own.
 */
export async function nudgeStalledTenderJob(
  req: Request,
  tenderId: string,
  userId: string,
  schedule?: (task: () => Promise<void>) => void,
): Promise<string | null> {
  const due = new Date(Date.now() - STALLED_AFTER_MS);
  const stalled = await prisma.aiJob.findFirst({
    where: {
      tenderId,
      userId,
      status: "QUEUED",
      updatedAt: { lt: due },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lt: due } }],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, jobType: true },
  }).catch(() => null);
  if (!stalled) return null;
  const woke = schedule ? scheduleRetryWorkerWake(req, stalled.jobType, tenderId, schedule) : scheduleRetryWorkerWake(req, stalled.jobType, tenderId);
  logger.info("[stalled-job-nudge] a due job had no claimant; woke a worker", { jobId: stalled.id, jobType: stalled.jobType, woke });
  return woke ? stalled.jobType : null;
}
