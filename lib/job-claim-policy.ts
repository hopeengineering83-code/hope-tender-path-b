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
};

export async function claimJobForCaller(options: {
  jobType?: JobType;
  userId?: string;
  global: boolean;
}): Promise<ClaimedJob | null> {
  await prismaReady;
  if (!options.global && !options.userId) return null;

  const conditions: Prisma.Sql[] = [Prisma.sql`"status" = 'QUEUED'`, Prisma.sql`("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())`];
  if (!options.global && options.userId) conditions.push(Prisma.sql`"userId" = ${options.userId}`);
  if (options.jobType) conditions.push(Prisma.sql`"jobType" = ${options.jobType}`);
  const whereClause = Prisma.join(conditions, " AND ");

  try {
    const result = await prisma.$queryRaw<Array<{ id: string; jobType: string; input: unknown; tenderId: string | null; userId: string }>>(Prisma.sql`
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
      RETURNING "id", "jobType", "input", "tenderId", "userId"
    `);

    if (!result || result.length === 0) return null;
    const candidate = result[0];

    let input: Record<string, unknown> = {};
    try {
      input = typeof candidate.input === "string"
        ? JSON.parse(candidate.input)
        : (candidate.input as Record<string, unknown> || {});
    } catch {
      input = {};
    }

    return {
      id: candidate.id,
      jobType: candidate.jobType as JobType,
      input,
      tenderId: candidate.tenderId,
      userId: candidate.userId,
    };
  } catch (err) {
    logger.error("[job-claim] Atomic claim failed:", { detail: err });
    return null;
  }
}
