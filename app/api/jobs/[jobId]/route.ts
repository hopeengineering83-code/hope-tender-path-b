import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { getJob } from "../../../../lib/job-store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const userId = await getSession();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { jobId } = await params;
  const job = getJob(jobId);

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (job.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json({
    id: job.id,
    tenderId: job.tenderId,
    type: job.type,
    status: job.status,
    steps: job.steps,
    currentStep: job.currentStep,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    result: job.status === "DONE" ? job.result : null,
  });
}
