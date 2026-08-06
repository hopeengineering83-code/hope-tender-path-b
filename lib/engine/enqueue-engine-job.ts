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
 * This function is called only after an authorized user explicitly selects
 * Run Engine. It binds the durable job to the current source revision and
 * prevents duplicate jobs. `autoContinue: true` authorizes only the stages
 * AFTER Engine success: Build Plan, generation, validation/finalization, and
 * final package reconciliation. It never authorizes automatic Engine start.
 */
export async function enqueueEngineJobForCurrentSources(
  client: PrismaClient,
  input: {
    userId: string;
    tenderId: string;
    companyId: string;
    purpose?: string;
    manualRequested?: boolean;
  },
): Promise<EngineEnqueueResult | null> {
  const revision = await computeEngineSourceRevision(client, {
    tenderId: input.tenderId,
    userId: input.userId,
    companyId: input.companyId,
  });
  if (!revision) return null;

  const manualRequested = input.manualRequested
    ?? input.purpose === "INTERNAL_ARTIFACT_PREPARATION";
  if (!manualRequested) {
    throw new Error("MANUAL_RUN_ENGINE_REQUIRED");
  }

  const idempotencyKey = engineIdempotencyKey({
    userId: input.userId,
    tenderId: input.tenderId,
    sourceRevision: revision.sourceRevision,
  });

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
