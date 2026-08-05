import { createAnalysisJob } from "./analysis-job-service";
import { prisma } from "../prisma";

export type AutomaticTenderPipelineResult = {
  jobId: string;
  analysisRevision: string | null;
};

/**
 * Persist a runnable, revision-bound AI Analyze job after source extraction.
 *
 * The durable worker owns continuation. The browser may display progress or
 * recovery controls, but it is not required to click AI Analyze or remain open
 * for the normal workflow to proceed.
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
