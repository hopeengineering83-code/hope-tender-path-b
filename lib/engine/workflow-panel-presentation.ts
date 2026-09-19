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

/**
 * Presentation-safe projection of the existing canonical workflow-center
 * decision plus observed durable successor activity. It contains no readiness
 * calculations: labels/reasons come from the canonical decision and activity
 * comes from persisted current-pipeline jobs.
 */
export type CanonicalDownstreamPresentationState = {
  nextRequiredAction: string;
  nextRequiredActionLabel: string;
  nextRequiredActionReason: string;
  currentBlockingStage: string;
  downstreamSuppressedBy: string | null;
  finalExportAllowed: boolean;
  activeJob: { jobType: string; status: "QUEUED" | "RUNNING" } | null;
};

export type DownstreamActivityCandidate = {
  jobType: string;
  status: string;
  analysisInputHash: string | null;
  input: string;
};

function inputAnalysisRevision(input: string): string | null {
  try {
    const parsed = JSON.parse(input) as { analysisRevision?: unknown };
    return typeof parsed.analysisRevision === "string" ? parsed.analysisRevision : null;
  } catch {
    return null;
  }
}

/** Select observed successor activity for this exact Engine source revision. */
export function selectCurrentDownstreamActivity(
  sourceRevision: string | null,
  candidates: DownstreamActivityCandidate[],
): CanonicalDownstreamPresentationState["activeJob"] {
  if (!sourceRevision) return null;
  const current = candidates.find((job) => {
    if (job.status !== "QUEUED" && job.status !== "RUNNING") return false;
    if (job.jobType === "PROPOSAL_GENERATION") return job.analysisInputHash === sourceRevision;
    if (job.jobType === "AUTO_FINALIZE") return inputAnalysisRevision(job.input) === sourceRevision;
    return false;
  });
  return current
    ? { jobType: current.jobType, status: current.status as "QUEUED" | "RUNNING" }
    : null;
}

const ENGINE_QUEUE_STALL_MS = 15 * 60 * 1000;

export function describeEngineActivity(
  activeJob: CurrentEnginePresentationState["activeJob"] | undefined,
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
  downstream: CanonicalDownstreamPresentationState | null = null,
): string {
  if (state.engineRunning) return describeEngineActivity(state.activeJob);
  if (!state.analysisCurrent) return state.analysisBlocker ?? "Run AI Analyze first to enable Engine.";
  if (state.engineFailed) return state.blocker ?? "The latest Engine run failed. Correct the issue and retry.";
  if (state.engineComplete) {
    // Engine success and downstream permission are deliberately independent.
    // When canonical workflow truth is unavailable, fail closed in copy rather
    // than promising that any work is occurring.
    if (!downstream) return "Engine is complete. Checking the current downstream workflow state.";

    if (downstream.activeJob?.status === "QUEUED") {
      return "Engine complete. Downstream processing is queued and will continue automatically.";
    }
    if (downstream.activeJob?.status === "RUNNING") {
      return "Engine complete. Downstream processing is continuing automatically.";
    }
    if (downstream.nextRequiredAction === "AUTOMATIC_PROCESSING") {
      return `Engine complete. Downstream processing is continuing automatically. ${downstream.nextRequiredActionReason}`;
    }
    if (downstream.nextRequiredAction === "WORKFLOW_COMPLETE" || downstream.nextRequiredAction === "COMPLETE") {
      return "Engine complete. Workflow is fully complete.";
    }
    if (downstream.nextRequiredAction === "EXPORT_READY" || downstream.finalExportAllowed) {
      return "Engine complete. Workflow is complete and export ready.";
    }

    const label = downstream.nextRequiredActionLabel
      ? `${downstream.nextRequiredActionLabel.charAt(0).toLocaleLowerCase()}${downstream.nextRequiredActionLabel.slice(1)}`
      : "the next required action";
    return `Engine complete. Downstream processing is paused — ${label}. ${downstream.nextRequiredActionReason}`;
  }
  return hasSelection
    ? "AI Analyze complete. Run Engine to refresh current-revision matching."
    : "AI Analyze complete. Run Engine to start matching.";
}
