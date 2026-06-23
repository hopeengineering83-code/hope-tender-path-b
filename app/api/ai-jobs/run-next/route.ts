import { NextResponse } from "next/server";
import { requireRole, unauthorizedResponse } from "../../../../lib/auth";
import { completeJob, completeJobWithStatus, failJob, type JobStatus } from "../../../../lib/ai-jobs";
import { claimJobForCaller } from "../../../../lib/job-claim-policy";
import { getHandler } from "../../../../lib/ai-job-handlers";
import { parseJobTypeFilter, SUPPORTED_JOB_TYPES } from "../../../../lib/job-type-policy";
import { prisma, prismaReady } from "../../../../lib/prisma";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return POST(req);
}

export async function POST(req: Request) {
  const workerSecret = req.headers.get("x-worker-secret");
  const aiJobsSecret = process.env.AI_JOBS_WORKER_SECRET;
  const isWorkerSecret = Boolean(aiJobsSecret && aiJobsSecret.length >= 16 && workerSecret === aiJobsSecret);

  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = Boolean(cronSecret && cronSecret.length >= 16 && authHeader === `Bearer ${cronSecret}`);
  const isAutomatedCaller = isWorkerSecret || isVercelCron;

  let userId: string | null = null;
  if (!isAutomatedCaller) {
    try {
      const actor = await requireRole("ADMIN", "PROPOSAL_MANAGER");
      userId = actor.id;
    } catch {
      return unauthorizedResponse();
    }
  }

  await prismaReady;
  const { searchParams } = new URL(req.url);
  const parsedJobType = parseJobTypeFilter(searchParams.get("jobType"));
  if (!parsedJobType.ok) {
    return NextResponse.json({
      error: "Invalid jobType filter",
      code: parsedJobType.code,
      supportedJobTypes: SUPPORTED_JOB_TYPES,
    }, { status: 400 });
  }

  const startTime = Date.now();
  const maxRunMs = 40_000;
  const processedJobs: Array<{ jobId: string; jobType: string; status: string; error?: string }> = [];

  while (Date.now() - startTime < maxRunMs) {
    const claimed = await claimJobForCaller({
      jobType: parsedJobType.value,
      userId: userId ?? undefined,
      global: isAutomatedCaller,
    });
    if (!claimed) break;

    const handler = getHandler(claimed.jobType);
    if (!handler) {
      await failJob(claimed.id, `No handler registered for jobType=${claimed.jobType}`);
      processedJobs.push({ jobId: claimed.id, jobType: claimed.jobType, status: "FAILED", error: "No handler" });
      continue;
    }

    try {
      const output = await handler({
        jobId: claimed.id,
        userId: claimed.userId,
        tenderId: claimed.tenderId,
        input: claimed.input,
      });

      // ── Respect the handler's declared terminal status ──────────────
      const terminalStatus = (output?.terminalStatus as string | undefined) ?? "SUCCEEDED";
      if (terminalStatus === "SUCCEEDED") {
        await completeJob(claimed.id, output);
        processedJobs.push({ jobId: claimed.id, jobType: claimed.jobType, status: "SUCCEEDED" });
      } else if (terminalStatus === "FAILED") {
        const errMsg = (output?.errorMessage as string | undefined) ?? "Handler reported FAILED";
        await failJob(claimed.id, errMsg);
        processedJobs.push({ jobId: claimed.id, jobType: claimed.jobType, status: "FAILED", error: errMsg });
      } else {
        await completeJobWithStatus(claimed.id, terminalStatus as JobStatus, output);
        processedJobs.push({ jobId: claimed.id, jobType: claimed.jobType, status: terminalStatus });
      }

      // ── Record retry state for AI_ANALYZE PARTIAL_SUCCESS/FAILED ────
      // Do NOT silently swallow persistence failures. Log a safe error,
      // retain the job as PARTIAL_SUCCESS/FAILED, keep generation blocked,
      // and expose a retry-status problem.
      if (claimed.jobType === "AI_ANALYZE" && (terminalStatus === "PARTIAL_SUCCESS" || terminalStatus === "FAILED")) {
        try {
          const { recordRetryState } = await import("../../../../lib/ai-analyze/retry-service");
          const job = await prisma.aiJob.findUnique({ where: { id: claimed.id }, select: { tenderId: true, analysisInputHash: true } });
          if (job?.tenderId && job?.analysisInputHash) {
            await recordRetryState(claimed.id, job.tenderId, claimed.userId, job.analysisInputHash, output?.errorMessage as string | undefined, output?.finalizationCode as string | undefined, terminalStatus);
          }
        } catch (retryErr) {
          // Log a safe error — do NOT expose raw DB errors. The job stays
          // PARTIAL_SUCCESS/FAILED, generation remains blocked.
          console.error(`[run-next] Retry-state persistence failed for job ${claimed.id}: ${retryErr instanceof Error ? retryErr.message : "unknown error"}. Job remains ${terminalStatus}; generation blocked.`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failJob(claimed.id, message);
      processedJobs.push({ jobId: claimed.id, jobType: claimed.jobType, status: "FAILED", error: "Job execution failed" });

      if (claimed.jobType === "AI_ANALYZE") {
        try {
          const { recordRetryState } = await import("../../../../lib/ai-analyze/retry-service");
          const job = await prisma.aiJob.findUnique({ where: { id: claimed.id }, select: { tenderId: true, analysisInputHash: true } });
          if (job?.tenderId && job?.analysisInputHash) {
            await recordRetryState(claimed.id, job.tenderId, claimed.userId, job.analysisInputHash, message, undefined, "FAILED");
          }
        } catch (retryErr) {
          console.error(`[run-next] Retry-state persistence failed for failed job ${claimed.id}: ${retryErr instanceof Error ? retryErr.message : "unknown error"}. Job remains FAILED; generation blocked.`);
        }
      }
    }

    if (["ENGINE_RUN", "PROPOSAL_GENERATION", "AI_REMATCH", "EVALUATOR_SIM"].includes(claimed.jobType)) break;
  }

  if (processedJobs.length === 0) {
    return NextResponse.json({ ran: 0, message: "queue empty" });
  }

  return NextResponse.json({
    ran: processedJobs.length,
    processedJobs,
    durationMs: Date.now() - startTime,
  });
}
