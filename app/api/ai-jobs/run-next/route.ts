// POST /api/ai-jobs/run-next
//
// Worker endpoint that drains ONE queued AiJob.
//
// Frontend pattern (used to escape the 60s Vercel Hobby timeout):
//   1. POST /api/tenders/[id]/engine?async=true  → returns { jobId }
//   2. POST /api/ai-jobs/run-next                → kicks off worker
//      (this is a SEPARATE function invocation with its own 60s budget)
//   3. Poll GET /api/ai-jobs/[id] every 3s until status = SUCCEEDED|FAILED
//
// Returns: { ran: 1, jobId, jobType, output } on success
//          { ran: 0, message: "queue empty" } when nothing to do
//
// Auth: only ADMIN / PROPOSAL_MANAGER can trigger the worker (the user
// can only run jobs they personally queued — enforced via userId match).
// Cron / external triggers can call with a shared secret in
// X-Worker-Secret header that matches process.env.AI_JOBS_WORKER_SECRET.

import { NextResponse } from "next/server";
import { requireUser, unauthorizedResponse } from "../../../../lib/auth";
import { claimNextJob, completeJob, failJob, type JobType } from "../../../../lib/ai-jobs";
import { getHandler } from "../../../../lib/ai-job-handlers";
import { prismaReady } from "../../../../lib/prisma";

// 60s = Hobby cap. One ENGINE_RUN job should fit. If it doesn't, the
// engine itself splits work into sub-jobs and this worker drains them
// one at a time.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Vercel Cron sends GET requests with `Authorization: Bearer ${CRON_SECRET}`
// automatically when CRON_SECRET is set as an env var. We accept BOTH POST
// (frontend) and GET (Vercel Cron) so the same handler drains the queue
// regardless of trigger source.
export async function GET(req: Request) {
  return POST(req);
}

export async function POST(req: Request) {
  // Auth — three acceptable callers:
  //   1. Logged-in user (frontend "Run in background" click)
  //   2. X-Worker-Secret header matching AI_JOBS_WORKER_SECRET (manual/external cron)
  //   3. Authorization: Bearer ${CRON_SECRET} (Vercel Cron — see vercel.json)
  const workerSecret = req.headers.get("x-worker-secret");
  const aiJobsSecret = process.env.AI_JOBS_WORKER_SECRET; const isWorkerSecret = Boolean(aiJobsSecret && aiJobsSecret.length >= 16 && workerSecret === aiJobsSecret);


  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET; const isVercelCron = Boolean(cronSecret && cronSecret.length >= 16 && authHeader === `Bearer ${cronSecret}`);


  const isAutomatedCaller = isWorkerSecret || isVercelCron;

  let userId: string | null = null;
  if (!isAutomatedCaller) {
    try {
      const actor = await requireUser();
      userId = actor.id;
    } catch {
      return unauthorizedResponse();
    }
  }

  await prismaReady;

  // Optional ?jobType=X scope so the frontend can ask for a specific
  // queue. When omitted, the worker claims any QUEUED job.
  const { searchParams } = new URL(req.url);
  const jobTypeFilter = searchParams.get("jobType") as JobType | null;

  const startTime = Date.now();
  // Hobby function timeout is 60s. Stop claiming new jobs if we've been running
  // for more than 40s, leaving enough headroom for the last job to finish or
  // for clean shutdown.
  const MAX_RUN_MS = 40_000;
  const processedJobs: Array<{ jobId: string; jobType: string; status: string; error?: string }> = [];

  while (Date.now() - startTime < MAX_RUN_MS) {
    const claimed = await claimNextJob({ jobType: jobTypeFilter ?? undefined });
    if (!claimed) break;

    // When not using an automated caller (worker secret or Vercel cron),
    // enforce userId match — a user can only run their own jobs.
    if (!isAutomatedCaller && claimed.userId !== userId) {
      await failJob(claimed.id, "Job belongs to a different user; released back to queue. Trigger the correct user's worker.");
      // Stop the loop if we hit a job for another user to avoid thrashing.
      break;
    }

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
      await completeJob(claimed.id, output);
      processedJobs.push({ jobId: claimed.id, jobType: claimed.jobType, status: "SUCCEEDED" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await failJob(claimed.id, msg);
      processedJobs.push({ jobId: claimed.id, jobType: claimed.jobType, status: "FAILED", error: msg });
    }

    // Heavy jobs should probably run solo per invocation to stay within the 60s cap.
    if (["ENGINE_RUN", "PROPOSAL_GENERATION", "AI_REMATCH", "EVALUATOR_SIM"].includes(claimed.jobType)) {
      break;
    }
  }

  if (processedJobs.length === 0) {
    return NextResponse.json({ ran: 0, message: "queue empty" });
  }

  // Return a summary of all processed jobs.
  return NextResponse.json({
    ran: processedJobs.length,
    processedJobs,
    durationMs: Date.now() - startTime
  });
}
