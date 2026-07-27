import { logger } from "./observability";
import { Prisma } from "@prisma/client";
import { prisma, prismaReady } from "./prisma";
import type { JobType } from "./ai-jobs";

export type ClaimedJob = {
  id: string;
  jobType: JobType;
  input: Record<string, unknown>;
  tenderId: string | null;
  userId: string;
  retries: number;
};

export async function claimJobForCaller(options: {
  jobType?: JobType;
  userId?: string;
  global: boolean;
}): Promise<ClaimedJob | null> {
  await prismaReady;
  if (!options.global && !options.userId) return null;

  const conditions: Prisma.Sql[] = [
    Prisma.sql`"status" = 'QUEUED'`,
    // Generic durable-stage backoff gate: a job re-armed by
    // rearmDurableStageJob() carries a future nextAttemptAt and must not be
    // claimable again until the backoff delay elapses. Ordinary freshly
    // enqueued jobs have nextAttemptAt = NULL and are unaffected.
    Prisma.sql`("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())`,
  ];
  if (!options.global && options.userId) conditions.push(Prisma.sql`"userId" = ${options.userId}`);
  if (options.jobType) conditions.push(Prisma.sql`"jobType" = ${options.jobType}`);
  const whereClause = Prisma.join(conditions, " AND ");

  try {
    const result = await prisma.$queryRaw<Array<{ id: string; jobType: string; input: unknown; tenderId: string | null; userId: string; retries: number }>>(Prisma.sql`
      UPDATE "AiJob"
      SET "status" = 'RUNNING', "startedAt" = NOW(), "updatedAt" = NOW()
      WHERE "id" = (
        SELECT "id"
        FROM "AiJob"
        WHERE ${whereClause}
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING "id", "jobType", "input", "tenderId", "userId", "retries"
    `);

    if (!result || result.length === 0) return null;
    const candidate = result[0];

    let input: Record<string, unknown> = {};
    try {
      input = typeof candidate.input === "string"
        ? JSON.parse(candidate.input)
        : (candidate.input as Record<string, unknown> || {});
    } catch (e) {
      // JSON.parse of job input failed — fall back to empty input map.
      // Surface the failure so malformed job-input rows are visible to
      // operators (a stuck series of these suggests a producer bug, not a
      // one-off serialization glitch). Previously bare `catch {}`.
      logger.warn("[job-claim-policy] failed to parse AiJob.input JSON — claiming with empty input map", {
        detail: e,
        jobId: candidate.id,
      });
      input = {};
    }

    return {
      id: candidate.id,
      jobType: candidate.jobType as JobType,
      input,
      tenderId: candidate.tenderId,
      userId: candidate.userId,
      retries: candidate.retries,
    };
  } catch (err) {
    logger.error("[job-claim] Atomic claim failed:", { detail: err });
    return null;
  }
}
