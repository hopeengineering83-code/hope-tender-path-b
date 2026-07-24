/**
 * Workflow live-state registry — precise, machine-readable states for every
 * workflow surface, plus the canonical icon + color + recovery action for
 * each.
 *
 * The previous `TenderWorkflowActionCenter` StatusBadge mapped every stage to
 * one of 8 coarse states (PENDING / IN_PROGRESS / READY / BLOCKED / WARNING /
 * COMPLETE / BLOCKED_BY_PRIOR_STEP / WAITING_ON_PRIOR_STEP). These were too
 * vague to answer the user's question "what is happening RIGHT NOW?":
 *
 *   - "IN_PROGRESS" did not distinguish queued vs extracting vs analyzing vs
 *     matching vs generating.
 *   - "BLOCKED" did not say whether the user must act (Repair Source), the
 *     system is retrying (Auto-retry in 30s), or approval is pending
 *     (Awaiting approval).
 *   - "WARNING" did not say whether the workflow can still proceed.
 *
 * This registry defines 10 precise live states. Each one has:
 *   - A canonical icon component name (from components/icons.tsx)
 *   - A short visible label
 *   - A longer screen-reader description
 *   - A tailwind color class for the badge
 *   - Whether the state is terminal (no further automatic action)
 *   - Whether the state requires user action
 *
 * Surfaces that show workflow state (TenderWorkflowActionCenter,
 * StatusBadge, AiAnalyzePanel, ExtractionQualityPanel,
 * GenerationProgressPanel) consume this registry so a state means the same
 * thing everywhere it appears.
 */

export type WorkflowLiveState =
  | "queued"
  | "extracting"
  | "analyzing"
  | "matching"
  | "generating"
  | "validating"
  | "blocked_with_reason"
  | "awaiting_approval"
  | "ready"
  | "failed_with_recovery";

export type WorkflowLiveStateSpec = {
  state: WorkflowLiveState;
  /** Icon component name from components/icons.tsx */
  iconName: string;
  /** Short visible label — fits in a 24px badge */
  label: string;
  /** Longer description for screen readers and tooltips */
  description: string;
  /** Tailwind classes for the badge: border + bg + text */
  badgeClassName: string;
  /** True if no further automatic state change is expected */
  terminal: boolean;
  /** True if the user must act to advance the workflow */
  requiresUserAction: boolean;
};

export const WORKFLOW_LIVE_STATES: Record<WorkflowLiveState, WorkflowLiveStateSpec> = {
  queued: {
    state: "queued",
    iconName: "ClockIcon",
    label: "Queued",
    description: "The job is queued and will start automatically.",
    badgeClassName:
      "border-slate-200 bg-slate-50 text-slate-700",
    terminal: false,
    requiresUserAction: false,
  },
  extracting: {
    state: "extracting",
    iconName: "RefreshIcon",
    label: "Extracting",
    description: "Text is being extracted from the uploaded source file.",
    badgeClassName:
      "border-blue-200 bg-blue-50 text-blue-700",
    terminal: false,
    requiresUserAction: false,
  },
  analyzing: {
    state: "analyzing",
    iconName: "SparklesIcon",
    label: "Analyzing",
    description: "AI is analyzing the extracted text to identify requirements.",
    badgeClassName:
      "border-indigo-200 bg-indigo-50 text-indigo-700",
    terminal: false,
    requiresUserAction: false,
  },
  matching: {
    state: "matching",
    iconName: "LinkIcon",
    label: "Matching",
    description: "Vault experts and projects are being matched to requirements.",
    badgeClassName:
      "border-violet-200 bg-violet-50 text-violet-700",
    terminal: false,
    requiresUserAction: false,
  },
  generating: {
    state: "generating",
    iconName: "DocumentGenerateIcon",
    label: "Generating",
    description: "Required documents are being generated from approved evidence.",
    badgeClassName:
      "border-amber-200 bg-amber-50 text-amber-700",
    terminal: false,
    requiresUserAction: false,
  },
  validating: {
    state: "validating",
    iconName: "ClipboardCheckIcon",
    label: "Validating",
    description: "Generated documents are being validated against the submission plan.",
    badgeClassName:
      "border-cyan-200 bg-cyan-50 text-cyan-700",
    terminal: false,
    requiresUserAction: false,
  },
  blocked_with_reason: {
    state: "blocked_with_reason",
    iconName: "AlertCircleIcon",
    label: "Blocked",
    description:
      "The workflow is blocked. A specific recovery action is required to continue.",
    badgeClassName:
      "border-red-200 bg-red-50 text-red-700",
    terminal: false,
    requiresUserAction: true,
  },
  awaiting_approval: {
    state: "awaiting_approval",
    iconName: "CheckCircleIcon",
    label: "Awaiting approval",
    description:
      "The workflow is ready for an authorized reviewer to approve the next step.",
    badgeClassName:
      "border-emerald-200 bg-emerald-50 text-emerald-700",
    terminal: false,
    requiresUserAction: true,
  },
  ready: {
    state: "ready",
    iconName: "CheckCircleIcon",
    label: "Ready",
    description: "All prerequisites are complete. The next action is available.",
    badgeClassName:
      "border-emerald-100 bg-emerald-50 text-emerald-700",
    terminal: false,
    requiresUserAction: true,
  },
  failed_with_recovery: {
    state: "failed_with_recovery",
    iconName: "WarningIcon",
    label: "Failed",
    description:
      "The last attempt failed. A recovery action is available — try it, or contact support with the request ID.",
    badgeClassName:
      "border-amber-200 bg-amber-50 text-amber-800",
    terminal: true,
    requiresUserAction: true,
  },
};

/**
 * Look up the canonical spec for a live state. Throws for unknown states so
 * typos are caught at dev time — surfaces should never silently render an
 * unknown state.
 */
export function getWorkflowLiveStateSpec(state: WorkflowLiveState): WorkflowLiveStateSpec {
  const spec = WORKFLOW_LIVE_STATES[state];
  if (!spec) {
    throw new Error(
      `Unknown workflow live state "${state}". Add it to WORKFLOW_LIVE_STATES in lib/ui/workflow-live-state.ts.`,
    );
  }
  return spec;
}

/**
 * Maps the coarse workflow-center stage status (returned by
 * /api/tenders/[id]/workflow-center) to a precise live state. The coarse
 * statuses are kept for backward compatibility with the API contract; the UI
 * upgrades them to precise states for display.
 *
 * The mapping is intentionally lossy: a coarse "IN_PROGRESS" can mean any of
 * several precise states depending on the stage. Callers should pass the
 * stage number so this function can disambiguate.
 */
export function coarseStatusToLiveState(
  coarse: string,
  stage: number,
): WorkflowLiveState {
  switch (coarse) {
    case "COMPLETE":
      return "ready";
    case "READY":
      return stage === 9 ? "awaiting_approval" : "ready";
    case "IN_PROGRESS":
      // Disambiguate by stage: stage 2 = extracting, 3 = analyzing,
      // 7 = matching, 8 = generating, 9 = validating, default = queued.
      if (stage === 2) return "extracting";
      if (stage === 3) return "analyzing";
      if (stage === 7) return "matching";
      if (stage === 8) return "generating";
      if (stage === 9) return "validating";
      return "queued";
    case "WARNING":
      return "failed_with_recovery";
    case "BLOCKED":
    case "BLOCKED_BY_PRIOR_STEP":
      return "blocked_with_reason";
    case "WAITING_ON_PRIOR_STEP":
    case "PENDING":
    default:
      return "queued";
  }
}

/**
 * Lists every icon component name actually referenced by the registry — used
 * by tests to verify all icons are exported from components/icons.tsx.
 */
export function listWorkflowLiveStateIconNames(): string[] {
  return [...new Set(Object.values(WORKFLOW_LIVE_STATES).map((s) => s.iconName))];
}
