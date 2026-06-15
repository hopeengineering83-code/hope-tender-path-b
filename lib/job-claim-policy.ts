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

  // PR XX-G6-Concurrency — atomic job claim using PostgreSQL "FOR UPDATE SKIP LOCKED".
  // This prevents two workers from claiming the same job and eliminates transaction
  // retries/deadlocks under high load.
  const ownerFilter = options.global ? "" : `AND "userId" = '${options.userId}'`;
  const typeFilter = options.jobType ? `AND "jobType" = '${options.jobType}'` : "";

  try {
    const result = await prisma.<any[]>(
      `UPDATE "AiJob"
       SET "status" = 'RUNNING', "startedAt" = NOW(), "updatedAt" = NOW()
       WHERE "id" = (
         SELECT "id"
         FROM "AiJob"
         WHERE "status" = 'QUEUED' ${ownerFilter} ${typeFilter}
         ORDER BY "createdAt" ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING "id", "jobType", "input", "tenderId", "userId"`
    );

    if (!result || result.length === 0) return null;
    const candidate = result[0];

    let input: Record<string, unknown> = {};
    try {
      input = typeof candidate.input === 'string' ? JSON.parse(candidate.input) : (candidate.input || {});
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
    console.error("[job-claim] Atomic claim failed:", err);
    return null;
  }
}
