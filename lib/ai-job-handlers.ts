// AI job handlers — maps JobType to the actual workflow function.
//
// Each handler:
//   • Receives the job's input + the tenderId/userId from the AiJob row
//   • Records step progress via recordStep()
//   • Throws on failure (the worker catches and marks job FAILED)
//   • Returns a serialisable output that's stored in AiJob.output
//
// The worker (/api/ai-jobs/run-next) claims the next QUEUED job, looks
// up the handler for its jobType, executes it, and marks the job
// SUCCEEDED or FAILED based on the result.

import { recordStep, type JobType } from "./ai-jobs";
import { runTenderEngine } from "./engine/run-tender-engine";

export interface JobContext {
  jobId: string;
  userId: string;
  tenderId: string | null;
  input: Record<string, unknown>;
}

export type JobHandler = (ctx: JobContext) => Promise<Record<string, unknown>>;

const handlers: Partial<Record<JobType, JobHandler>> = {
  // ─── ENGINE_RUN — runs the full tender engine in the background ──────
  // The engine pipeline (analyze → match → AI rematch → write) can
  // exceed 60s on Vercel Hobby for large tenders. Wrapping it in a job
  // means the API route returns immediately with a jobId; the worker
  // (a separate 60s function invocation) runs the engine; the frontend
  // polls /api/ai-jobs/[id] for status.
  ENGINE_RUN: async (ctx) => {
    if (!ctx.tenderId) throw new Error("ENGINE_RUN requires tenderId on the job");
    await recordStep(ctx.jobId, { stepName: "engine.start", message: `Starting engine run for tender ${ctx.tenderId}`, status: "RUNNING" });
    try {
      const result = await runTenderEngine(ctx.tenderId, ctx.userId);
      await recordStep(ctx.jobId, { stepName: "engine.complete", message: "Engine run finished successfully", status: "SUCCEEDED" });
      return { result: result as unknown as Record<string, unknown> };
    } catch (err) {
      await recordStep(ctx.jobId, { stepName: "engine.failed", message: err instanceof Error ? err.message : String(err), status: "FAILED" });
      throw err;
    }
  },
};

export function getHandler(jobType: JobType): JobHandler | null {
  return handlers[jobType] ?? null;
}

/**
 * List the job types this build can execute. Anything not in this list
 * will be marked FAILED by the worker with a "no handler registered"
 * error so the queue doesn't hang on orphan job types.
 */
export function supportedJobTypes(): JobType[] {
  return Object.keys(handlers) as JobType[];
}
