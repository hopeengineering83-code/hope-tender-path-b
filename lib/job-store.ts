import { logger } from "./observability";
import { randomUUID } from "crypto";
import { prisma, prismaReady } from "./prisma";

export type JobStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";

export interface JobStep {
  step: string;
  label: string;
  completedAt: number | null;
}

export interface Job {
  id: string;
  userId: string;
  tenderId: string;
  type: "GENERATE" | "ANALYZE" | "ENGINE";
  status: JobStatus;
  steps: JobStep[];
  currentStep: string | null;
  result: unknown;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

const JOB_TTL_MS = 2 * 60 * 60 * 1_000;
const MAX_JOBS = 1_000;
const jobs = new Map<string, Job>();
const durableWrites = new Map<string, Promise<void>>();

function durableJobType(type: Job["type"]): "PROPOSAL_GENERATION" | "AI_ANALYZE" | "ENGINE_RUN" {
  if (type === "ANALYZE") return "AI_ANALYZE";
  if (type === "ENGINE") return "ENGINE_RUN";
  return "PROPOSAL_GENERATION";
}

function queueDurableWrite(jobId: string, operation: () => Promise<void>): void {
  const prior = durableWrites.get(jobId) ?? Promise.resolve();
  const next = prior
    .then(operation)
    .catch((error) => {
      logger.error(`[job-store] Durable job write failed for ${jobId}:`, { detail: error instanceof Error ? error.message : String(error) });
    })
    .finally(() => {
      if (durableWrites.get(jobId) === next) durableWrites.delete(jobId);
    });
  durableWrites.set(jobId, next);
}

function evict() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.updatedAt > JOB_TTL_MS) jobs.delete(id);
  }
  if (jobs.size >= MAX_JOBS) {
    const oldest = [...jobs.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [id] of oldest.slice(0, 50)) jobs.delete(id);
  }
}

export function createJob(params: Pick<Job, "userId" | "tenderId" | "type"> & { steps: string[] }): Job {
  evict();
  const stepLabels: Record<string, string> = {
    FETCH: "Loading tender data",
    INTELLIGENCE: "Building proposal intelligence",
    AI_GENERATE: "Generating with AI",
    SAVE: "Saving documents",
    LETTERHEAD: "Applying letterhead",
    VALIDATE: "Validating output",
    DONE: "Complete",
  };
  const id = randomUUID();
  const now = Date.now();
  const job: Job = {
    id,
    userId: params.userId,
    tenderId: params.tenderId,
    type: params.type,
    status: "PENDING",
    steps: params.steps.map((step) => ({ step, label: stepLabels[step] ?? step, completedAt: null })),
    currentStep: null,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);

  queueDurableWrite(id, async () => {
    await prismaReady;
    await prisma.aiJob.create({
      data: {
        id,
        userId: params.userId,
        tenderId: params.tenderId,
        jobType: durableJobType(params.type),
        status: "QUEUED",
        input: JSON.stringify({ compatibilityRoute: true, plannedSteps: params.steps }),
      },
    });
  });

  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function advanceJob(id: string, step: string): void {
  const job = jobs.get(id);
  if (!job) return;
  const stepEntry = job.steps.find((candidate) => candidate.step === step);
  if (stepEntry) stepEntry.completedAt = Date.now();
  job.currentStep = step;
  job.status = "RUNNING";
  job.updatedAt = Date.now();
  const stepIndex = Math.max(0, job.steps.findIndex((candidate) => candidate.step === step));
  const label = stepEntry?.label ?? step;

  queueDurableWrite(id, async () => {
    // Wrap the three writes in a transaction so a partial failure cannot
    // leave the AiJob in RUNNING with stale step rows. The array form is
    // safe here — the three writes are independent of each other's results.
    await prisma.$transaction([
      prisma.aiJob.update({
        where: { id },
        data: { status: "RUNNING", startedAt: new Date(job.createdAt) },
      }),
      prisma.aiJobStep.updateMany({
        where: { jobId: id, status: "RUNNING" },
        data: { status: "SUCCEEDED", finishedAt: new Date() },
      }),
      prisma.aiJobStep.create({
        data: {
          jobId: id,
          stepIndex,
          stepName: step.slice(0, 120),
          status: "RUNNING",
          message: label.slice(0, 1_000),
          startedAt: new Date(),
        },
      }),
    ]);
  });
}

export function completeJob(id: string, result: unknown): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "DONE";
  job.result = result;
  job.currentStep = null;
  job.updatedAt = Date.now();
  for (const step of job.steps) if (!step.completedAt) step.completedAt = Date.now();

  queueDurableWrite(id, async () => {
    // Transaction: if the job.update fails after step.updateMany succeeds,
    // all steps would show SUCCEEDED while the job is still RUNNING — the
    // job appears "running forever" despite terminal steps. Wrap both.
    await prisma.$transaction([
      prisma.aiJobStep.updateMany({
        where: { jobId: id, status: "RUNNING" },
        data: { status: "SUCCEEDED", finishedAt: new Date() },
      }),
      prisma.aiJob.update({
        where: { id },
        data: {
          status: "SUCCEEDED",
          output: JSON.stringify(result ?? {}),
          finishedAt: new Date(),
        },
      }),
    ]);
  });
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "FAILED";
  job.error = error;
  job.updatedAt = Date.now();

  queueDurableWrite(id, async () => {
    // Transaction: same consistency risk as completeJob — step rows must
    // not show FAILED while the job is still RUNNING.
    await prisma.$transaction([
      prisma.aiJobStep.updateMany({
        where: { jobId: id, status: "RUNNING" },
        data: { status: "FAILED", finishedAt: new Date() },
      }),
      prisma.aiJob.update({
        where: { id },
        data: {
          status: "FAILED",
          errorMessage: error.slice(0, 2_000),
          finishedAt: new Date(),
        },
      }),
    ]);
  });
}
