/**
 * The durable job queue at a glance, for the admin diagnostics and the
 * post-release scheduler test (docs/PRODUCTION_RELIABILITY_RUNBOOK.md): what is
 * waiting and for how long, what the scheduler re-armed, and whether any
 * tender has two live jobs for one pipeline stage — which the queue's
 * idempotent enqueue and exactly-once claim must never allow. Counts only;
 * no job input, output or tender content.
 */

const PIPELINE_STAGES = ["AI_ANALYZE", "ENGINE_RUN", "PROPOSAL_GENERATION", "AUTO_FINALIZE"] as const;
const LIVE = ["QUEUED", "RUNNING"];

export type QueueHealth = {
  live: Array<{ jobType: string; status: string; count: number }>;
  oldestQueuedSeconds: number | null;
  retriedLast24h: number;
  lastJobStartedAt: string | null;
  /** Tender × pipeline stage pairs with more than one live job. Must be 0. */
  duplicateLiveStageJobs: number;
};

/** The caller's own jobs: one tenant never sees another's queue. */
export async function getQueueHealth(db: any, userId: string, now = new Date()): Promise<QueueHealth> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [live, oldestQueued, retried, lastStarted, perStage] = await Promise.all([
    db.aiJob.groupBy({ by: ["jobType", "status"], where: { userId, status: { in: LIVE } }, _count: { _all: true } }),
    db.aiJob.findFirst({ where: { userId, status: "QUEUED" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.aiJob.count({ where: { userId, retries: { gt: 0 }, updatedAt: { gte: since } } }),
    db.aiJob.findFirst({ where: { userId, startedAt: { not: null } }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    db.aiJob.groupBy({
      by: ["tenderId", "jobType"],
      where: { userId, status: { in: LIVE }, tenderId: { not: null }, jobType: { in: [...PIPELINE_STAGES] } },
      _count: { _all: true },
    }),
  ]);
  return {
    live: live
      .map((row: { jobType: string; status: string; _count: { _all: number } }) => ({ jobType: row.jobType, status: row.status, count: row._count._all }))
      .sort((a: { jobType: string; status: string }, b: { jobType: string; status: string }) => `${a.jobType}${a.status}`.localeCompare(`${b.jobType}${b.status}`)),
    oldestQueuedSeconds: oldestQueued ? Math.max(0, Math.round((now.getTime() - new Date(oldestQueued.createdAt).getTime()) / 1000)) : null,
    retriedLast24h: retried,
    lastJobStartedAt: lastStarted?.startedAt ? new Date(lastStarted.startedAt).toISOString() : null,
    duplicateLiveStageJobs: perStage.filter((row: { _count: { _all: number } }) => row._count._all > 1).length,
  };
}
