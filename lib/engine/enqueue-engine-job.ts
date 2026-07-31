import type { PrismaClient } from "@prisma/client";
import {
  computeEngineSourceRevision,
  engineIdempotencyKey,
  type EngineSourceRevision,
} from "./engine-source-revision";

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
 * Callers must complete source verification before invoking this function.
 * The function binds the job to a deterministic current source revision,
 * serializes duplicate requests through a transaction-scoped advisory lock,
 * cancels stale active jobs, and returns only a real persisted job row.
 */
export async function enqueueEngineJobForCurrentSources(
  client: PrismaClient,
  input: {
    userId: string;
    tenderId: string;
    companyId: string;
    purpose?: string;
  },
): Promise<EngineEnqueueResult | null> {
  const revision = await computeEngineSourceRevision(client, {
    tenderId: input.tenderId,
    userId: input.userId,
    companyId: input.companyId,
  });
  if (!revision) return null;

  const idempotencyKey = engineIdempotencyKey({
    userId: input.userId,
    tenderId: input.tenderId,
    sourceRevision: revision.sourceRevision,
  });

  const job = await client.$transaction(async (tx) => {
    // pg_advisory_xact_lock returns PostgreSQL `void`, which Prisma cannot
    // deserialize when it is selected directly. The volatile subquery still
    // acquires the transaction-scoped lock while the outer projection returns
    // only a supported integer type.
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
      select: { id: true, status: true },
    });
    if (active) return { ...active, reusedActiveJob: true };

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
          purpose: input.purpose ?? "INTERNAL_ARTIFACT_PREPARATION",
          executionPolicy: "SERVER_CONTROLLED",
        }),
      },
      select: { id: true, status: true },
    });
    return { ...created, reusedActiveJob: false };
  }, { isolationLevel: "Serializable" });

  return { job, revision, idempotencyKey };
}
