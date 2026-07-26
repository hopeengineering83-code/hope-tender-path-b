import { createAnalysisJob } from "./analysis-job-service";
import { prisma } from "../prisma";

export type AutomaticTenderPipelineResult = {
  jobId: string;
  analysisRevision: string | null;
};

/**
 * Queue the one canonical automatic tender pipeline.
 *
 * Upload handlers call this only after the complete source package has been
 * stored. createAnalysisJob is content-hash idempotent, and the guarded update
 * below only adds continuation metadata to the owned active AI_ANALYZE job.
 * Engine and proposal jobs remain the responsibility of the fail-closed
 * continuation services after promoted AI success.
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
    select: { input: true, analysisInputHash: true },
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
  await prisma.aiJob.updateMany({
    where: {
      id: analysis.jobId,
      userId: input.userId,
      tenderId: input.tenderId,
      jobType: "AI_ANALYZE",
      status: { in: ["QUEUED", "RUNNING"] },
    },
    data: {
      input: JSON.stringify({
        ...currentInput,
        source: input.source,
        force: false,
        autoContinue: true,
        companyId: input.companyId,
        analysisRevision,
      }),
    },
  });

  return {
    jobId: analysis.jobId,
    analysisRevision,
  };
}
