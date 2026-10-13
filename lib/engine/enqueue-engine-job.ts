import type { PrismaClient } from "@prisma/client";
import {
  computeEngineSourceRevision,
  engineIdempotencyKey,
  type EngineSourceRevision,
} from "./engine-source-revision";
import { MAX_DURABLE_STAGE_ATTEMPTS } from "./stage-retry-policy";

export type PersistedEngineJob = {
  id: string;
  status: string;
  reusedActiveJob: boolean;
};

export type EngineEnqueueResult = {
  job: PersistedEngineJob;
  revision: EngineSourceRevision;
  idempotencyKey: string;
};

/**
 * The one canonical durable Engine enqueue authority.
 *
 * This function is called only after an authorized user explicitly selects
 * Run Engine. It binds the durable job to the current source revision and
 * prevents duplicate jobs. `autoContinue: true` authorizes only the stages
 * AFTER Engine success: Build Plan, generation, validation/finalization, and
 * final package reconciliation. It never authorizes automatic Engine start.
 *
 * FIX 3: `manualRequested` is a HARD REQUIREMENT. The previous
 * `?? input.purpose === "INTERNAL_ARTIFACT_PREPARATION"` fallback allowed any
 * internal service to mint the equivalent of a manual Engine click by setting
 * a purpose string — bypassing the manual authority contract. Removed.
 * Recovery may re-arm the SAME manually-authorized Engine job; it must never
 * create a fresh Engine job automatically.
 */
export async function enqueueEngineJobForCurrentSources(
  client: PrismaClient,
  input: {
    userId: string;
    tenderId: string;
    companyId: string;
    /** Reserved for backwards compatibility — no longer authorizes enqueue. */
    purpose?: string;
    /**
     * HARD REQUIREMENT. Only POST /api/tenders/:id/engine may set this to
     * true, after authentication, role/tenant checks, and current-revision
     * validation. Internal services must not call this function.
     */
    manualRequested: boolean;
  },
): Promise<EngineEnqueueResult | null> {
  const revision = await computeEngineSourceRevision(client, {
    tenderId: input.tenderId,
    userId: input.userId,
    companyId: input.companyId,
  });
  if (!revision) return null;

  // FIX 3: manualRequested is required — no purpose-based fallback.
  if (!input.manualRequested) {
    throw new Error("MANUAL_RUN_ENGINE_REQUIRED");
  }

  const idempotencyKey = engineIdempotencyKey({
    userId: input.userId,
    tenderId: input.tenderId,
    sourceRevision: revision.sourceRevision,
  });

  // Release this tender's own abandoned Engine runs before deciding what to
  // reuse.
  //
  // The reuse rule below treats RUNNING as an active job, and a worker killed
  // mid-invocation leaves its row RUNNING forever. Every later Run Engine then
  // resolved to that corpse, returned 202 for it, and skipped the wake because
  // the status was not QUEUED — so the owner's only manual control became a
  // no-op with an accepted-looking answer, permanently, for that revision.
  //
  // Nothing else would clear it on a Preview deployment: the unattended
  // stuck-job sweeps in run-next run only for the automated caller (worker
  // secret or cron), and the drain cron posts to the default-branch host. The
  // one remaining path was a browser sitting on the job's status endpoint,
  // which is precisely the dependency the owner contract removes.
  //
  // Scope is deliberately this tender and this user: an owner's own click may
  // recover their own abandoned run, and nothing else. The shared staleness
  // rule decides — recoverIfStuck refuses a job that is merely slow, and a
  // genuinely live run is left strictly alone, so an in-flight Engine is never
  // interrupted by a second click.
  const abandoned = await client.aiJob.findMany({
    where: {
      tenderId: input.tenderId,
      userId: input.userId,
      jobType: "ENGINE_RUN",
      status: "RUNNING",
    },
    select: { id: true },
    take: 10,
  });
  if (abandoned.length > 0) {
    const { recoverIfStuck } = await import("../ai-jobs");
    for (const job of abandoned) {
      await recoverIfStuck(job.id).catch(() => false);
    }
  }

  const job = await client.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ acquired: number }>>`
      SELECT 1 AS acquired
      FROM (SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))) AS engine_lock
    `;

    await tx.aiJob.updateMany({
      where: {
        tenderId: input.tenderId,
        userId: input.userId,
        jobType: "ENGINE_RUN",
        status: { in: ["QUEUED", "RUNNING", "PARTIAL_SUCCESS"] },
        OR: [
          { analysisInputHash: null },
          { analysisInputHash: { not: revision.sourceRevision } },
        ],
      },
      data: {
        status: "CANCELED",
        errorMessage: "Superseded by a newer Engine source revision.",
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });

    const active = await tx.aiJob.findFirst({
      where: {
        tenderId: input.tenderId,
        userId: input.userId,
        jobType: "ENGINE_RUN",
        analysisInputHash: revision.sourceRevision,
        status: { in: ["QUEUED", "RUNNING", "PARTIAL_SUCCESS"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, retries: true },
    });
    if (active) {
      // A PARTIAL_SUCCESS row is reused but is NOT claimable: the claim is
      // `status = 'QUEUED'` and nothing else. Retry state is recorded for
      // AI_ANALYZE only, so no sweep would ever re-arm it either — the row was
      // reused forever by every later click while no worker could ever take
      // it, and Run Engine answered 202 for a job that would never run again.
      //
      // The owner asking for this run IS the authority to re-arm it; this
      // re-arms the SAME manually authorized job rather than creating a fresh
      // one, which is the distinction this module exists to keep. Bounded by
      // the shared durable-stage attempt budget so repeated clicks on a
      // genuinely broken revision cannot become an unbounded loop.
      if (active.status === "PARTIAL_SUCCESS" && active.retries < MAX_DURABLE_STAGE_ATTEMPTS) {
        const rearmed = await tx.aiJob.updateMany({
          where: { id: active.id, status: "PARTIAL_SUCCESS" },
          data: {
            status: "QUEUED",
            startedAt: null,
            finishedAt: null,
            errorMessage: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            retries: { increment: 1 },
          },
        });
        if (rearmed.count === 1) {
          return { id: active.id, status: "QUEUED", reusedActiveJob: true };
        }
      }
      return { id: active.id, status: active.status, reusedActiveJob: true };
    }

    const created = await tx.aiJob.create({
      data: {
        userId: input.userId,
        tenderId: input.tenderId,
        jobType: "ENGINE_RUN",
        status: "QUEUED",
        analysisInputHash: revision.sourceRevision,
        input: JSON.stringify({
          sourceRevision: revision.sourceRevision,
          idempotencyKey,
          purpose: input.purpose ?? "MANUAL_RUN_ENGINE",
          executionPolicy: "SERVER_CONTROLLED",
          manualRequested: true,
          autoContinue: true,
        }),
      },
      select: { id: true, status: true },
    });
    return { ...created, reusedActiveJob: false };
  }, {
    isolationLevel: "ReadCommitted",
  });

  return { job, revision, idempotencyKey };
}
