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
  if (currentJob?.status === "QUEUED" && currentInput.manualRequested !== true) {
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
