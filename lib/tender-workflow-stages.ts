/**
 * Canonical tender workflow stage registry — the single source of truth for
 * stage numbers, labels, and anchor targets.
 *
 * Three components used to maintain independent copies of these values:
 *   - components/workflow-step-links.tsx (STEP_LABELS)
 *   - components/next-action-panel.tsx (STEPS)
 *   - app/api/tenders/[id]/workflow-center/route.ts (inline label: strings)
 *
 * Any drift between these copies caused the "icons act independently" bug
 * where step links and workflow buttons navigated to different panels or
 * showed different labels for the same stage. This file eliminates that risk
 * by providing one importable definition.
 *
 * The server-side route (workflow-center/route.ts) should import
 * TENDER_WORKFLOW_STAGES to build its stage array so the labels in the API
 * response always match the labels in the UI.
 */

export interface TenderWorkflowStage {
  stage: number;
  label: string;
  /** Primary anchor target (first) + fallbacks. The workflow action center
   * tries each in order; step links use only the primary. */
  targets: string[];
}

export const TENDER_WORKFLOW_STAGES: TenderWorkflowStage[] = [
  { stage: 1, label: "Source Files", targets: ["#tender-files"] },
  { stage: 2, label: "Extraction Quality", targets: ["#extraction-quality", "#tender-files"] },
  { stage: 3, label: "AI Analyze", targets: ["#ai-analyze-section"] },
  { stage: 4, label: "Confirm Requirements", targets: ["#requirement-coverage", "#ai-analyze-section"] },
  { stage: 5, label: "Tender Details", targets: ["#tender-edit-form"] },
  { stage: 6, label: "Verified Submission Plan", targets: ["#submission-plan", "#submission-plan-reconciliation"] },
  { stage: 7, label: "Match Evidence", targets: ["#match-evidence", "#requirement-coverage"] },
  { stage: 8, label: "Generate Documents", targets: ["#generated-documents", "#submission-plan"] },
  { stage: 9, label: "Validate and Approve", targets: ["#authority-review", "#generated-documents"] },
  { stage: 10, label: "Export ZIP", targets: ["#export-readiness", "#final-package-manifest"] },
];

/** Stage number → label map (for quick lookup). */
export const TENDER_WORKFLOW_STAGE_LABELS: Record<number, string> = Object.fromEntries(
  TENDER_WORKFLOW_STAGES.map((s) => [s.stage, s.label]),
);

/** Stage number → targets array map (backward-compat with existing imports). */
export const TENDER_WORKFLOW_STAGE_TARGETS: Record<number, string[]> = Object.fromEntries(
  TENDER_WORKFLOW_STAGES.map((s) => [s.stage, s.targets]),
);

/** Ordered label list (for step-link components that iterate by index). */
export const TENDER_WORKFLOW_STAGE_LABEL_LIST: string[] = TENDER_WORKFLOW_STAGES.map((s) => s.label);

/** Primary target for each stage (first entry in targets). */
export const TENDER_WORKFLOW_STAGE_PRIMARY_TARGETS: string[] = TENDER_WORKFLOW_STAGES.map(
  (s) => s.targets[0],
);
