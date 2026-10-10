import { logger } from "../observability";

export type SafeStageEvent = {
  deploymentSha: string;
  jobType: string;
  jobId: string;
  packageRevision: string | null;
  sourceRevision: string | null;
  stage: string;
  durationMs: number;
  queueAgeMs: number;
  retryCount: number;
  providerClass: string | null;
  modelClass: string | null;
  blockerCode: string | null;
  artifactIntegrityStatus: string | null;
};

function deploymentSha(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_GIT_SHA || process.env.GIT_SHA || "unknown";
}

/** Emits identifiers/status only. Callers cannot pass text, paths, secrets, or raw errors. */
export function recordSafeStageEvent(event: Omit<SafeStageEvent, "deploymentSha">): void {
  logger.info("[job-stage]", { ...event, deploymentSha: deploymentSha() } satisfies SafeStageEvent);
}
