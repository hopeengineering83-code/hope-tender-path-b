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

  return prisma.$transaction(async (tx) => {
    const ownerFilter = options.global ? {} : { userId: options.userId as string };
    const candidate = await tx.aiJob.findFirst({
      where: {
        status: "QUEUED",
        ...ownerFilter,
        ...(options.jobType ? { jobType: options.jobType } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, jobType: true, input: true, tenderId: true, userId: true },
    });
    if (!candidate) return null;

    const result = await tx.aiJob.updateMany({
      where: { id: candidate.id, status: "QUEUED", ...ownerFilter },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    if (result.count !== 1) return null;

    let input: Record<string, unknown> = {};
    try { input = candidate.input ? JSON.parse(candidate.input) : {}; } catch { input = {}; }
    return {
      id: candidate.id,
      jobType: candidate.jobType as JobType,
      input,
      tenderId: candidate.tenderId,
      userId: candidate.userId,
    };
  });
}
