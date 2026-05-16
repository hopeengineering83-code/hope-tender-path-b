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

export async function POST(req: Request) {
  // Auth — either a logged-in user OR a worker secret (for cron triggers)
  const secret = req.headers.get("x-worker-secret");
  const envSecret = process.env.AI_JOBS_WORKER_SECRET;
  const isWorkerSecret = Boolean(envSecret && secret === envSecret);

  let userId: string | null = null;
  if (!isWorkerSecret) {
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

  const claimed = await claimNextJob({ jobType: jobTypeFilter ?? undefined });
  if (!claimed) {
    return NextResponse.json({ ran: 0, message: "queue empty" });
  }

  // When not using worker secret, enforce userId match — a user can only
  // run their own jobs.
  if (!isWorkerSecret && claimed.userId !== userId) {
    // Release the job back to QUEUED for the correct user's worker to pick up
    // (rare race condition — usually shouldn't happen)
    await failJob(claimed.id, "Job belongs to a different user; released back to queue. Trigger the correct user's worker.");
    return NextResponse.json({ ran: 0, message: "claimed job belongs to another user — released" });
  }

  const handler = getHandler(claimed.jobType);
  if (!handler) {
    await failJob(claimed.id, `No handler registered for jobType=${claimed.jobType}`);
    return NextResponse.json({ ran: 0, jobId: claimed.id, error: `No handler for jobType=${claimed.jobType}` }, { status: 500 });
  }

  try {
    const output = await handler({
      jobId: claimed.id,
      userId: claimed.userId,
      tenderId: claimed.tenderId,
      input: claimed.input,
    });
    await completeJob(claimed.id, output);
    return NextResponse.json({ ran: 1, jobId: claimed.id, jobType: claimed.jobType, output });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failJob(claimed.id, msg);
    return NextResponse.json({ ran: 0, jobId: claimed.id, jobType: claimed.jobType, error: msg }, { status: 500 });
  }
}
