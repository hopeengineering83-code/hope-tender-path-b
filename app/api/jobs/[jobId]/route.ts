import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { getJob as getMemoryJob } from "../../../../lib/job-store";
import { getJob as getDurableJob } from "../../../../lib/ai-jobs";
import { prisma, prismaReady } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

function legacyStatus(status: string): "PENDING" | "RUNNING" | "DONE" | "FAILED" {
  if (status === "SUCCEEDED" || status === "PARTIAL_SUCCESS") return "DONE";
  if (status === "FAILED" || status === "CANCELED") return "FAILED";
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
    type: job.jobType === "AI_ANALYZE" ? "ANALYZE" : job.jobType === "ENGINE_RUN" ? "ENGINE" : job.jobType === "AUTO_FINALIZE" ? "FINALIZE" : "GENERATE",
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
