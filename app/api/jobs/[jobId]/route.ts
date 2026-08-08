import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { getInMemoryJob as getMemoryJob } from "../../../../lib/job-store";
import { getJob as getDurableJob } from "../../../../lib/ai-jobs";
import { prisma, prismaReady } from "../../../../lib/prisma";
import { ANALYSIS_SUPERSEDED_STATUS } from "../../../../lib/ai-analyze-promotion";

export const dynamic = "force-dynamic";

function legacyStatus(status: string): "PENDING" | "RUNNING" | "DONE" | "FAILED" {
  if (status === "SUCCEEDED" || status === "PARTIAL_SUCCESS") return "DONE";
  // SUPERSEDED is terminal: the analysis lost a promotion race and will never
  // produce a usable result. It must map to a terminal legacy status.
  //
  // It previously fell through to the PENDING default, which told a polling
  // client the job was still queued — so the caller waited on a job that could
  // never progress, and the UI showed work in flight that had already ended.
  // Reporting it as DONE would be worse still: DONE reads as a usable result,
  // and a superseded analysis must never authorise anything downstream.
  // Among the four legacy values, FAILED is the only honest one — terminal,
  // and explicitly not a success.
  if (status === "FAILED" || status === "CANCELED" || status === ANALYSIS_SUPERSEDED_STATUS) return "FAILED";
  if (status === "RUNNING") return "RUNNING";
  return "PENDING";
}

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { jobId } = await params;
  const memoryJob = getMemoryJob(jobId);
  if (memoryJob) {
    if (memoryJob.userId !== userId) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json({
      id: memoryJob.id,
      tenderId: memoryJob.tenderId,
      type: memoryJob.type,
      status: memoryJob.status,
      steps: memoryJob.steps,
      currentStep: memoryJob.currentStep,
      error: memoryJob.error,
      createdAt: memoryJob.createdAt,
      updatedAt: memoryJob.updatedAt,
      result: memoryJob.status === "DONE" ? memoryJob.result : null,
      durable: true,
    });
  }

  await prismaReady;
  const access = await prisma.aiJob.findUnique({
    where: { id: jobId },
    select: { userId: true, tenderId: true, updatedAt: true },
  });
  if (!access || access.userId !== userId) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const job = await getDurableJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const status = legacyStatus(job.status);
  const steps = job.steps.map((step) => ({
    step: step.stepName,
    label: step.message ?? step.stepName,
    completedAt: step.finishedAt?.getTime() ?? null,
  }));
  const currentStep = [...job.steps].reverse().find((step) => step.status === "RUNNING")?.stepName ?? null;

  return NextResponse.json({
    id: job.id,
    tenderId: job.tenderId,
    type: job.jobType === "AI_ANALYZE" ? "ANALYZE" : job.jobType === "ENGINE_RUN" ? "ENGINE" : "GENERATE",
    status,
    steps,
    currentStep,
    error: job.errorMessage,
    createdAt: job.createdAt.getTime(),
    updatedAt: access.updatedAt.getTime(),
    result: status === "DONE" ? job.output : null,
    durable: true,
  });
}
