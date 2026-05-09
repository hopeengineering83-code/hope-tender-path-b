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

const JOB_TTL_MS = 2 * 60 * 60 * 1_000; // 2 hours
const MAX_JOBS = 1_000;

const jobs = new Map<string, Job>();

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
  const id = crypto.randomUUID();
  const now = Date.now();
  const job: Job = {
    id,
    userId: params.userId,
    tenderId: params.tenderId,
    type: params.type,
    status: "PENDING",
    steps: params.steps.map((s) => ({ step: s, label: stepLabels[s] ?? s, completedAt: null })),
    currentStep: null,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function advanceJob(id: string, step: string): void {
  const job = jobs.get(id);
  if (!job) return;
  const stepEntry = job.steps.find((s) => s.step === step);
  if (stepEntry) stepEntry.completedAt = Date.now();
  job.currentStep = step;
  job.status = "RUNNING";
  job.updatedAt = Date.now();
}

export function completeJob(id: string, result: unknown): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "DONE";
  job.result = result;
  job.currentStep = null;
  job.updatedAt = Date.now();
  for (const s of job.steps) if (!s.completedAt) s.completedAt = Date.now();
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = "FAILED";
  job.error = error;
  job.updatedAt = Date.now();
}
