// AI job queue (G6 fix)
//
// THE PROBLEM
// ───────────
// Long-running AI workflows still ran inside the request/response timer:
// proposal generation can be > 60s on Vercel Hobby, large rematch
// batches can be > 60s, evaluator simulation + Copilot deep analysis
// add more time. Hitting the cap = 504 timeout = workflow lost.
//
// THE FIX
// ───────
// A simple queue model on top of the AiJob / AiJobStep tables. Routes
// can:
//
//   1. enqueueJob({ jobType, input, userId, tenderId })
//        → returns { id }
//   2. claimNextJob({ jobType })
//        → returns the oldest QUEUED job and atomically marks it RUNNING
//   3. recordStep(jobId, { stepName, message })
//        → appends an AiJobStep row for streaming-style progress
//   4. completeJob(jobId, { output })
//   5. failJob(jobId, errorMessage)
//
// Routes can also poll getJob(id) for status. UI polls the same.
// Background workers (separate cron / serverless function) call
// claimNextJob() in a loop.
//
// This is a minimal, pragmatic queue — NOT a full work-stealing
// distributed scheduler. It uses Postgres FOR UPDATE SKIP LOCKED
// semantics via a transaction with row-level update so two workers
// never claim the same job. For Hobby/serverless, a single per-tenant
// cron tick is sufficient.

import { prisma, prismaReady } from "./prisma";

export type JobType =
  | "PROPOSAL_GENERATION"
  | "AI_REMATCH"
  | "EVALUATOR_SIM"
  | "COPILOT_DEEP_ANALYSIS"
  | "PROFILE_FACT_EXTRACTION"
  // Wraps the synchronous tender engine pipeline (analyze → match → AI rematch)
  // in a queued job so it can run outside the 60s Vercel Hobby route cap.
  | "ENGINE_RUN";

export type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";

export interface EnqueueJobInput {
  userId: string;
  tenderId?: string | null;
  jobType: JobType;
  input?: Record<string, unknown>;
}

export async function enqueueJob(input: EnqueueJobInput): Promise<{ id: string }> {
  await prismaReady;
  const job = await prisma.aiJob.create({
    data: {
      userId: input.userId,
      tenderId: input.tenderId ?? null,
      jobType: input.jobType,
      input: JSON.stringify(input.input ?? {}),
      status: "QUEUED",
    },
    select: { id: true },
  });
  return { id: job.id };
}

export async function claimNextJob(opts: { jobType?: JobType }): Promise<{ id: string; jobType: JobType; input: Record<string, unknown>; tenderId: string | null; userId: string } | null> {
  await prismaReady;
  // Single-statement update with conditional WHERE: only updates the
  // chosen job if it is still QUEUED. The returning row tells us whether
  // we actually claimed something.
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.aiJob.findFirst({
      where: {
        status: "QUEUED",
        ...(opts.jobType ? { jobType: opts.jobType } : {}),
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, jobType: true, input: true, tenderId: true, userId: true },
    });
    if (!candidate) return null;
    const updated = await tx.aiJob.updateMany({
      where: { id: candidate.id, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: new Date() },
    });
    if (updated.count === 0) return null; // another worker claimed it.
    let parsedInput: Record<string, unknown> = {};
    try { parsedInput = candidate.input ? JSON.parse(candidate.input) : {}; } catch { parsedInput = {}; }
    return {
      id: candidate.id,
      jobType: candidate.jobType as JobType,
      input: parsedInput,
      tenderId: candidate.tenderId,
      userId: candidate.userId,
    };
  });
}

export async function recordStep(jobId: string, step: { stepName: string; message?: string; status?: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" }): Promise<void> {
  await prismaReady;
  const last = await prisma.aiJobStep.findFirst({
    where: { jobId },
    orderBy: { stepIndex: "desc" },
    select: { stepIndex: true },
  });
  const nextIndex = (last?.stepIndex ?? -1) + 1;
  await prisma.aiJobStep.create({
    data: {
      jobId,
      stepIndex: nextIndex,
      stepName: step.stepName.slice(0, 120),
      status: step.status ?? "RUNNING",
      message: step.message?.slice(0, 1000) ?? null,
      startedAt: new Date(),
      finishedAt: step.status === "SUCCEEDED" || step.status === "FAILED" ? new Date() : null,
    },
  });
}

export async function completeJob(jobId: string, output?: Record<string, unknown>): Promise<void> {
  await prismaReady;
  await prisma.aiJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      output: output ? JSON.stringify(output) : null,
      finishedAt: new Date(),
    },
  });
}

export async function failJob(jobId: string, errorMessage: string): Promise<void> {
  await prismaReady;
  await prisma.aiJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      errorMessage: errorMessage.slice(0, 2000),
      finishedAt: new Date(),
    },
  });
}

export async function getJob(jobId: string): Promise<{
  id: string;
  status: JobStatus;
  jobType: JobType;
  tenderId: string | null;
  errorMessage: string | null;
  output: Record<string, unknown> | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  steps: Array<{ stepIndex: number; stepName: string; status: string; message: string | null; startedAt: Date | null; finishedAt: Date | null }>;
} | null> {
  await prismaReady;
  const job = await prisma.aiJob.findUnique({
    where: { id: jobId },
    include: { steps: { orderBy: { stepIndex: "asc" } } },
  });
  if (!job) return null;
  let parsedOutput: Record<string, unknown> | null = null;
  if (job.output) { try { parsedOutput = JSON.parse(job.output); } catch { parsedOutput = null; } }
  return {
    id: job.id,
    status: job.status as JobStatus,
    jobType: job.jobType as JobType,
    tenderId: job.tenderId,
    errorMessage: job.errorMessage,
    output: parsedOutput,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdAt: job.createdAt,
    steps: job.steps.map((s) => ({ stepIndex: s.stepIndex, stepName: s.stepName, status: s.status, message: s.message, startedAt: s.startedAt, finishedAt: s.finishedAt })),
  };
}

/**
 * Maximum wall-clock runtime for a RUNNING job before the recovery
 * routine considers it stuck. Default 15 minutes — generous enough
 * for the longest legitimate engine run (analyze + match + AI
 * rematch + 4-section parallel generation + critique + rewrite),
 * but tight enough to catch crashed workers before the user gives
 * up. Override via AI_JOB_STUCK_AFTER_MS.
 */
export const AI_JOB_STUCK_AFTER_MS = (() => {
  const raw = Number(process.env.AI_JOB_STUCK_AFTER_MS);
  if (Number.isFinite(raw) && raw >= 60_000 && raw <= 3_600_000) return raw;
  return 15 * 60 * 1000;
})();

/**
 * Detect jobs that have been RUNNING for longer than the
 * stuck-threshold. These are typically the residue of:
 *   - a crashed Vercel function (worker process died mid-call)
 *   - a network timeout that the in-pipeline guard didn't catch
 *   - an unhandled rejection in the worker
 *
 * Returns the count + the job IDs (capped at `limit`) so callers
 * can either surface them in diagnostics or hand them to
 * `failStuckJobs` for recovery.
 */
export async function findStuckJobs(opts?: { stuckAfterMs?: number; limit?: number }): Promise<{ count: number; jobs: Array<{ id: string; jobType: JobType; userId: string; tenderId: string | null; startedAt: Date | null }> }> {
  await prismaReady;
  const threshold = new Date(Date.now() - (opts?.stuckAfterMs ?? AI_JOB_STUCK_AFTER_MS));
  const jobs = await prisma.aiJob.findMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: threshold },
    },
    select: { id: true, jobType: true, userId: true, tenderId: true, startedAt: true },
    orderBy: { startedAt: "asc" },
    take: opts?.limit ?? 50,
  });
  // Use a separate count() to avoid limiting visibility — diagnostics
  // should surface the full count even when only a sample is returned.
  const count = await prisma.aiJob.count({
    where: {
      status: "RUNNING",
      startedAt: { lt: threshold },
    },
  });
  return {
    count,
    jobs: jobs.map((j) => ({
      id: j.id,
      jobType: j.jobType as JobType,
      userId: j.userId,
      tenderId: j.tenderId,
      startedAt: j.startedAt,
    })),
  };
}

/**
 * Mark stuck jobs as FAILED. Runs in batches so a large pile of
 * stuck jobs doesn't blow the function timeout. Returns the number
 * of jobs successfully recovered.
 *
 * Idempotent: only updates rows that are still RUNNING (a worker
 * that finished between `findStuckJobs` and `failStuckJobs` will
 * not be clobbered — the WHERE clause requires status='RUNNING').
 */
export async function failStuckJobs(opts?: { stuckAfterMs?: number; reason?: string; limit?: number }): Promise<{ recovered: number; ids: string[] }> {
  await prismaReady;
  const { jobs } = await findStuckJobs({ stuckAfterMs: opts?.stuckAfterMs, limit: opts?.limit ?? 50 });
  if (jobs.length === 0) return { recovered: 0, ids: [] };
  const reason = (opts?.reason ?? `Worker did not finish within ${Math.round((opts?.stuckAfterMs ?? AI_JOB_STUCK_AFTER_MS) / 60_000)} min — auto-failed by stuck-job recovery. Re-run the engine.`).slice(0, 2000);
  const recovered: string[] = [];
  for (const job of jobs) {
    const updated = await prisma.aiJob.updateMany({
      where: { id: job.id, status: "RUNNING" },
      data: {
        status: "FAILED",
        errorMessage: reason,
        finishedAt: new Date(),
      },
    });
    if (updated.count > 0) recovered.push(job.id);
  }
  return { recovered: recovered.length, ids: recovered };
}

/**
 * Lazy recovery: callers reading a single job (typically from the
 * status-polling endpoint) can ask this helper to auto-fail the
 * job if it has been stuck. Returns true when a recovery happened
 * so the caller can refetch the row and surface the new FAILED
 * state to the UI immediately.
 */
export async function recoverIfStuck(jobId: string, opts?: { stuckAfterMs?: number }): Promise<boolean> {
  await prismaReady;
  const threshold = new Date(Date.now() - (opts?.stuckAfterMs ?? AI_JOB_STUCK_AFTER_MS));
  const updated = await prisma.aiJob.updateMany({
    where: {
      id: jobId,
      status: "RUNNING",
      startedAt: { lt: threshold },
    },
    data: {
      status: "FAILED",
      errorMessage: `Worker did not finish within ${Math.round((opts?.stuckAfterMs ?? AI_JOB_STUCK_AFTER_MS) / 60_000)} min — auto-failed by stuck-job recovery. Re-run the engine.`,
      finishedAt: new Date(),
    },
  });
  return updated.count > 0;
}

export async function listUserJobs(userId: string, opts?: { jobType?: JobType; status?: JobStatus; take?: number }): Promise<Array<{ id: string; jobType: JobType; status: JobStatus; tenderId: string | null; createdAt: Date; finishedAt: Date | null }>> {
  await prismaReady;
  const rows = await prisma.aiJob.findMany({
    where: {
      userId,
      ...(opts?.jobType ? { jobType: opts.jobType } : {}),
      ...(opts?.status ? { status: opts.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts?.take ?? 25,
    select: { id: true, jobType: true, status: true, tenderId: true, createdAt: true, finishedAt: true },
  });
  return rows.map((r) => ({ ...r, jobType: r.jobType as JobType, status: r.status as JobStatus }));
}
