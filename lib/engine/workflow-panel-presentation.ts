/**
 * Shared, presentation-only wording for panels around the manual Engine action.
 *
 * The values passed here are produced by the current-revision
 * `/engine-readiness` authority. This module never derives workflow state and
 * deliberately does not name a downstream action after Engine succeeds: the
 * canonical workflow decision owns that instruction.
 */
export type CurrentEnginePresentationState = {
  analysisCurrent: boolean;
  engineRunning: boolean;
  engineComplete: boolean;
  engineFailed: boolean;
  canRunEngine: boolean;
  analysisBlocker?: string | null;
  blocker?: string | null;
  activeJob: { id?: string; status: string; createdAt: string } | null;
};

const ENGINE_QUEUE_STALL_MS = 15 * 60 * 1000;

export function describeEngineActivity(
  activeJob: CurrentEnginePresentationState["activeJob"],
  now: number = Date.now(),
): string {
  const running = "Engine is running as a durable current-revision job.";
  if (!activeJob) return running;
  if (activeJob.status === "PARTIAL_SUCCESS") {
    return "Engine stopped after partial progress and is not running. Open Diagnostics and Recovery to resume it.";
  }
  if (activeJob.status !== "QUEUED") return running;

  const queuedAt = Date.parse(activeJob.createdAt);
  if (!Number.isFinite(queuedAt)) return "Engine job is queued — waiting for a worker to start it.";
  const waitedMs = Math.max(0, now - queuedAt);
  const waitedMin = Math.floor(waitedMs / 60_000);
  if (waitedMs >= ENGINE_QUEUE_STALL_MS) {
    return `Engine job has been queued for ${waitedMin} min without being claimed by a worker. Processing has not started. Open Diagnostics and Recovery to check the job queue worker.`;
  }
  return waitedMin >= 1
    ? `Engine job is queued (${waitedMin} min) — waiting for a worker to start it.`
    : "Engine job is queued — waiting for a worker to start it.";
}

export function describeAIAnalyzeWorkflowState(state: CurrentEnginePresentationState): string {
  if (!state.analysisCurrent) {
    return "AI Analysis is stale or incomplete. Run AI Analyze again for the current source revision.";
  }
  if (state.engineComplete) return "AI Analysis is complete and current.";
  if (state.engineRunning) {
    return state.activeJob?.status === "QUEUED"
      ? "AI Analysis is complete and current. Engine is queued for this source revision."
      : "AI Analysis is complete and current. Engine is running for this source revision.";
  }
  if (state.engineFailed) {
    return "AI Analysis is complete and current. The current-revision Engine run failed; review the Engine panel before retrying.";
  }
  return "AI Analyze complete. Run Engine to continue.";
}

export function describeMatchingEngineState(
  state: CurrentEnginePresentationState,
  hasSelection: boolean,
): string {
  if (state.engineComplete) return "Engine complete. Downstream processing continues automatically.";
  if (state.engineRunning) return describeEngineActivity(state.activeJob);
  if (!state.analysisCurrent) return state.analysisBlocker ?? "Run AI Analyze first to enable Engine.";
  if (state.engineFailed) return state.blocker ?? "The latest Engine run failed. Correct the issue and retry.";
  return hasSelection
    ? "AI Analyze complete. Run Engine to refresh current-revision matching."
    : "AI Analyze complete. Run Engine to start matching.";
}
