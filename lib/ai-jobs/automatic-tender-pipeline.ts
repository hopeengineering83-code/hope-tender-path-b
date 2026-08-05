import { createAnalysisJob } from "./analysis-job-service";
import { prisma } from "../prisma";

export type AutomaticTenderPipelineResult = {
  jobId: string;
  analysisRevision: string | null;
};

/**
 * Persist and arm the revision-bound AI Analyze checkpoint immediately after
 * extraction. The durable worker owns continuation from this point; the
 * browser may wake the queue, but it is never required to press an Analyze
 * button or keep the page open.
 *
 * The optimistic input equality in updateMany prevents a replaying extraction
 * worker from overwriting a job that has already been claimed or explicitly
 * re-armed. createAnalysisJob remains the idempotency authority for the
 * revision-bound job and chunk rows.
 *
 * `automaticContinuation: true` marks the job as server-owned so the durable
 * worker can distinguish an extraction-triggered continuation from an explicit
 * manual Analyze action. `autoContinue: true` remains the legacy flag read by
 * engine-continuation-service and proposal-continuation-service; both must be
 * present so the existing worker chain continues to fire.
 */
export async function queueAutomaticTenderPipeline(input: {
  tenderId: string;
  userId: string;
  companyId: string;
  source: "upload-first" | "secure-upload";
}): Promise<AutomaticTenderPipelineResult> {
  const analysis = await createAnalysisJob({
    tenderId: input.tenderId,
    userId: input.userId,
  });

  const currentJob = await prisma.aiJob.findUnique({
    where: { id: analysis.jobId },
    select: { input: true, analysisInputHash: true, status: true },
  });

  let currentInput: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(currentJob?.input ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      currentInput = parsed as Record<string, unknown>;
    }
  } catch {
    currentInput = {};
  }

  const analysisRevision = currentJob?.analysisInputHash ?? null;

  // Preserve createAnalysisJob's concurrency/idempotency contract. Enrich only
  // the still-queued revision we read; if a worker already claimed it, the
  // optimistic predicate intentionally becomes a no-op and the runnable job is
  // left untouched.
  if (currentJob?.status === "QUEUED") {
    await prisma.aiJob.updateMany({
      where: {
        id: analysis.jobId,
        userId: input.userId,
        tenderId: input.tenderId,
        jobType: "AI_ANALYZE",
        status: "QUEUED",
        input: currentJob.input,
      },
      data: {
        finishedAt: null,
        errorMessage: null,
        input: JSON.stringify({
          ...currentInput,
          source: input.source,
          force: false,
          autoContinue: true,
          automaticContinuation: true,
          manualRequested: false,
          companyId: input.companyId,
          analysisRevision,
        }),
      },
    });
  }

  return {
    jobId: analysis.jobId,
    analysisRevision,
  };
}
