import { createAnalysisJob } from "./analysis-job-service";
import { prisma } from "../prisma";

export type AutomaticTenderPipelineResult = {
  jobId: string;
  analysisRevision: string | null;
};

/**
 * Persist the AI Analyze checkpoint after extraction without making it
 * runnable. AI Analyze is one of the product's two explicit user actions.
 *
 * createAnalysisJob prepares the revision-bound durable job and chunk rows.
 * This function immediately parks a newly queued automatic placeholder as
 * CANCELED. The explicit manual-ai-analyze route creates/re-arms the runnable
 * job and marks its input manualRequested=true before waking the worker.
 *
 * The optimistic input equality in updateMany prevents a replaying extraction
 * worker from canceling a job that the user has already explicitly started.
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
        status: "CANCELED",
        finishedAt: new Date(),
        errorMessage: "Awaiting the explicit AI Analyze action.",
        input: JSON.stringify({
          ...currentInput,
          source: input.source,
          force: false,
          autoContinue: false,
          manualRequested: false,
          manualGate: "AI_ANALYZE",
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
