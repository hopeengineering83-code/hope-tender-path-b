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
 * Each stage lists a specific owning panel first and a stable five-stage
 * workspace disclosure last. Shortcut clients try every selector in order,
 * so conditional or temporarily absent panels still open the correct workflow
 * section instead of doing nothing.
 */

export interface TenderWorkflowStage {
  stage: number;
  label: string;
  /** Primary anchor target (first) + resilient fallbacks. */
  targets: string[];
}

export const TENDER_WORKFLOW_STAGES: TenderWorkflowStage[] = [
  { stage: 1, label: "Source Files", targets: ["#tender-files", "#workflow-stage-1"] },
  { stage: 2, label: "Extraction Quality", targets: ["#extraction-quality", "#tender-files", "#workflow-stage-1"] },
  { stage: 3, label: "AI Analyze", targets: ["#ai-analyze-section", "#workflow-stage-2"] },
  { stage: 4, label: "Source-ground Requirements", targets: ["#requirement-coverage", "#ai-analyze-section", "#workflow-stage-2"] },
  { stage: 5, label: "Tender Details", targets: ["#tender-edit-form", "#workflow-stage-1"] },
  { stage: 6, label: "Confirmed Build Plan", targets: ["#submission-plan-completeness", "#submission-plan", "#workflow-stage-4"] },
  { stage: 7, label: "Match Evidence", targets: ["#matching-selected-evidence", "#workflow-stage-3"] },
  { stage: 8, label: "Generate Documents", targets: ["#generated-documents", "#submission-plan", "#workflow-stage-4"] },
  { stage: 9, label: "Validate and Final Release", targets: ["#authority-review", "#generated-documents", "#workflow-stage-4"] },
  { stage: 10, label: "Export ZIP", targets: ["#export-readiness", "#final-package-manifest", "#workflow-stage-5"] },
];

/** Stage number → label map (for quick lookup). */
export const TENDER_WORKFLOW_STAGE_LABELS: Record<number, string> = Object.fromEntries(
  TENDER_WORKFLOW_STAGES.map((stage) => [stage.stage, stage.label]),
);

/** Stage number → targets array map (backward-compat with existing imports). */
export const TENDER_WORKFLOW_STAGE_TARGETS: Record<number, string[]> = Object.fromEntries(
  TENDER_WORKFLOW_STAGES.map((stage) => [stage.stage, stage.targets]),
);

/** Ordered label list (for step-link components that iterate by index). */
export const TENDER_WORKFLOW_STAGE_LABEL_LIST: string[] = TENDER_WORKFLOW_STAGES.map((stage) => stage.label);

/** Primary target for each stage (first entry in targets). */
export const TENDER_WORKFLOW_STAGE_PRIMARY_TARGETS: string[] = TENDER_WORKFLOW_STAGES.map(
  (stage) => stage.targets[0],
);
