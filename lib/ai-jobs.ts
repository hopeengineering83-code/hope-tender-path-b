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
  | "AI_ANALYZE"
  // Wraps the synchronous tender engine pipeline (analyze → match → AI rematch)
  // in a queued job so it can run outside the 60s Vercel Hobby route cap.
  | "ENGINE_RUN"
  // Background text extraction for a TenderFile. Moves long-running extraction
  // (especially OCR on large scanned PDFs) out of the upload-request response
  // cycle so the upload route returns immediately. The worker reads the file
  // from storage, runs extractTextFromBuffer, updates the TenderFile row with
  // extractedText + totalPages + extractionScore + extractionMethod, and runs
  // the candidate pipeline so the canonical resolver can ground the metadata.
  // Input: { tenderFileId: string }.
  | "EXTRACT_TEXT"
  | "AUTO_FINALIZE";

export type JobStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "PARTIAL_SUCCESS" | "FAILED" | "CANCELED";

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
 * Maximum time since the last AiJobStep before a RUNNING job is
 * considered to have made no recent progress. Default 90 seconds.
 *
 * 90 s is chosen because Vercel's Hobby function cap is 60 s — a worker
 * that is killed by Vercel will have recorded its last step at T+0 and
 * won't produce any more. With a 90 s threshold the stuck-recovery loop
 * marks the job FAILED within ~90 s of the kill, instead of leaving it
 * orphaned for 5 minutes. Override via AI_JOB_PROGRESS_STUCK_AFTER_MS.
 */
export const AI_JOB_PROGRESS_STUCK_AFTER_MS = (() => {
  const raw = Number(process.env.AI_JOB_PROGRESS_STUCK_AFTER_MS);
  if (Number.isFinite(raw) && raw >= 30_000 && raw <= 1_800_000) return raw;
  return 90_000; // 90 s — just above Vercel's 60 s hard kill
})();

/**
 * Returns the most recent QUEUED or RUNNING ENGINE_RUN job for the
 * given tender + user, or null when no active job exists.
 */
export async function findActiveEngineRunForTender(tenderId: string, userId: string): Promise<{ id: string } | null> {
  await prismaReady;
  return prisma.aiJob.findFirst({
    where: { tenderId, userId, jobType: "ENGINE_RUN", status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

/**
 * Returns true when the job type should be considered stuck purely on a
 * progress-stalled basis (no AiJobStep within
 * AI_JOB_PROGRESS_STUCK_AFTER_MS), regardless of total wall-clock runtime.
 *
 * WHY ENGINE_RUN IS SPECIAL
 * ─────────────────────────
 * A Vercel function killed at 60s can leave an ENGINE_RUN job RUNNING
 * with no further steps. With only the wall-clock threshold (15 min) the
 * job stays RUNNING for 15 minutes before being marked FAILED — the UI
 * keeps spinning the whole time. Tying ENGINE_RUN recovery solely to
 * "no recent step" surfaces the failure within ~90s instead of 15 min.
 *
 * Other job types still require BOTH thresholds: those workflows can
 * legitimately spend many minutes inside a single Claude call without
 * recording a step in between, and a 90s progress threshold would
 * trigger spurious recoveries.
 */
function isProgressStuckOnlyType(jobType: string): boolean {
  return jobType === "ENGINE_RUN";
}

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
 *
 * Threshold policy:
 *   - ENGINE_RUN jobs: recoverable as soon as no AiJobStep has been
 *     written within `progressStuckAfterMs` (default 90 s). Wall-clock
 *     runtime is NOT checked — a Vercel-killed engine run at 60s is
 *     surfaced after ~90s instead of 15 min.
 *   - All other job types: require BOTH that the job has been RUNNING
 *     for at least `stuckAfterMs` (default 15 min) AND that no step has
 *     been recorded within `progressStuckAfterMs`. This prevents a long
 *     legitimate Claude call (which can run several minutes between
 *     steps) from being killed by the recovery sweep.
 */
export async function findStuckJobs(opts?: { stuckAfterMs?: number; progressStuckAfterMs?: number; limit?: number }): Promise<{
  count: number;
  jobs: Array<{ id: string; jobType: JobType; userId: string; tenderId: string | null; startedAt: Date | null; latestStepName: string | null; latestStepAt: Date | null }>;
}> {
  await prismaReady;
  const totalThreshold = new Date(Date.now() - (opts?.stuckAfterMs ?? AI_JOB_STUCK_AFTER_MS));
  const progressThreshold = new Date(Date.now() - (opts?.progressStuckAfterMs ?? AI_JOB_PROGRESS_STUCK_AFTER_MS));

  // We query a wide candidate set covering BOTH branches:
  //   - jobs started before totalThreshold (covers the legacy wall-clock branch
  //     for non-ENGINE_RUN types)
  //   - jobs started before progressThreshold AND of an ENGINE_RUN-style type
  //     (covers the progress-only branch even when wall-clock < 15 min)
  // The Prisma where uses an OR with the appropriate predicates so we never
  // miss a 60-second-killed ENGINE_RUN.
  const candidates = await prisma.aiJob.findMany({
    where: {
      status: "RUNNING",
      OR: [
        { startedAt: { lt: totalThreshold } },
        { jobType: "ENGINE_RUN", startedAt: { lt: progressThreshold } },
      ],
    },
    select: {
      id: true, jobType: true, userId: true, tenderId: true, startedAt: true,
      steps: { orderBy: { createdAt: "desc" }, take: 1, select: { stepName: true, createdAt: true } },
    },
    orderBy: { startedAt: "asc" },
    take: (opts?.limit ?? 50) * 3,
  });

  const stuck = candidates.filter((j) => {
    const latestStepAt = j.steps[0]?.createdAt ?? null;
    const progressStalled = !latestStepAt || latestStepAt < progressThreshold;
    if (!progressStalled) return false;
    if (isProgressStuckOnlyType(j.jobType)) {
      // ENGINE_RUN: progress-stall alone is sufficient. We still require
      // that the job has been running long enough for the progress
      // threshold to have meaning (startedAt < progressThreshold); the
      // Prisma WHERE already enforced that branch.
      return true;
    }
    // Other types: require wall-clock threshold AS WELL.
    return j.startedAt !== null && j.startedAt < totalThreshold;
  }).slice(0, opts?.limit ?? 50);

  return {
    count: stuck.length,
    jobs: stuck.map((j) => ({
      id: j.id,
      jobType: j.jobType as JobType,
      userId: j.userId,
      tenderId: j.tenderId,
      startedAt: j.startedAt,
      latestStepName: j.steps[0]?.stepName ?? null,
      latestStepAt: j.steps[0]?.createdAt ?? null,
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
export async function failStuckJobs(opts?: { stuckAfterMs?: number; progressStuckAfterMs?: number; reason?: string; limit?: number }): Promise<{ recovered: number; ids: string[] }> {
  await prismaReady;
  const { jobs } = await findStuckJobs({ stuckAfterMs: opts?.stuckAfterMs, progressStuckAfterMs: opts?.progressStuckAfterMs, limit: opts?.limit ?? 50 });
  if (jobs.length === 0) return { recovered: 0, ids: [] };
  const recovered: string[] = [];
  for (const job of jobs) {
    const failedStage = job.latestStepName ?? "UNKNOWN";
    const progressOnly = isProgressStuckOnlyType(job.jobType);
    const defaultMessage = progressOnly
      ? `Engine worker stopped making progress for more than ${Math.round((opts?.progressStuckAfterMs ?? AI_JOB_PROGRESS_STUCK_AFTER_MS) / 1000)}s — auto-failed by stuck-job recovery. Re-run the engine in Safe Mode.`
      : `Worker did not finish within ${Math.round((opts?.stuckAfterMs ?? AI_JOB_STUCK_AFTER_MS) / 60_000)} min — auto-failed by stuck-job recovery. Re-run the engine.`;
    const errorMessage = (opts?.reason ?? defaultMessage).slice(0, 2000);
    const structuredOutput = JSON.stringify({
      code: "ASYNC_ENGINE_TIMEOUT",
      nextAction: "RUN_ENGINE_SAFE_MODE",
      safeModeAvailable: true,
      failedStage,
      lastProgressAt: job.latestStepAt?.toISOString() ?? null,
    });
    const updated = await prisma.aiJob.updateMany({
      where: { id: job.id, status: "RUNNING" },
      data: { status: "FAILED", errorMessage, output: structuredOutput, finishedAt: new Date() },
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
 *
 * Threshold policy mirrors `findStuckJobs`:
 *   - ENGINE_RUN: fail when no AiJobStep has been recorded within
 *     `progressStuckAfterMs` (default 90 s), regardless of wall-clock.
 *   - All other job types: require BOTH wall-clock (default 15 min) and
 *     progress-stalled (default 90 s) to be true.
 */
export async function recoverIfStuck(jobId: string, opts?: { stuckAfterMs?: number; progressStuckAfterMs?: number }): Promise<boolean> {
  await prismaReady;
  const totalThreshold = new Date(Date.now() - (opts?.stuckAfterMs ?? AI_JOB_STUCK_AFTER_MS));
  const progressThreshold = new Date(Date.now() - (opts?.progressStuckAfterMs ?? AI_JOB_PROGRESS_STUCK_AFTER_MS));

  const job = await prisma.aiJob.findFirst({
    where: { id: jobId, status: "RUNNING" },
    select: {
      id: true, jobType: true, startedAt: true,
      steps: { orderBy: { createdAt: "desc" }, take: 1, select: { stepName: true, createdAt: true } },
    },
  });
  if (!job) return false;

  const latestStepAt = job.steps[0]?.createdAt ?? null;
  const progressStalled = !latestStepAt || latestStepAt < progressThreshold;
  if (!progressStalled) return false;

  const progressOnly = isProgressStuckOnlyType(job.jobType);
  if (!progressOnly) {
    // Other job types: also require wall-clock threshold passed.
    if (!job.startedAt || job.startedAt >= totalThreshold) return false;
  } else {
    // ENGINE_RUN: require the job has been running at least the
    // progressThreshold (otherwise it's just a fresh job with no steps
    // yet — not stuck).
    if (!job.startedAt || job.startedAt >= progressThreshold) return false;
  }

  const failedStage = job.steps[0]?.stepName ?? "UNKNOWN";
  const structuredOutput = JSON.stringify({
    code: "ASYNC_ENGINE_TIMEOUT",
    nextAction: "RUN_ENGINE_SAFE_MODE",
    safeModeAvailable: true,
    failedStage,
    lastProgressAt: latestStepAt ? latestStepAt.toISOString() : null,
  });
  const errorMessage = progressOnly
    ? `Engine worker stopped making progress for more than ${Math.round((opts?.progressStuckAfterMs ?? AI_JOB_PROGRESS_STUCK_AFTER_MS) / 1000)}s — auto-failed by stuck-job recovery. Re-run the engine in Safe Mode.`
    : `Worker did not finish within ${Math.round((opts?.stuckAfterMs ?? AI_JOB_STUCK_AFTER_MS) / 60_000)} min — auto-failed by stuck-job recovery. Re-run the engine.`;
  const updated = await prisma.aiJob.updateMany({
    where: { id: jobId, status: "RUNNING" },
    data: {
      status: "FAILED",
      errorMessage,
      output: structuredOutput,
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

export * from "./ai-jobs/index";
