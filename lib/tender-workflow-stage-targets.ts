/**
 * Canonical stage-number -> anchor-target registry for the tender workflow.
 *
 * WorkflowStepLinks and TenderWorkflowActionCenter each used to hardcode their
 * own copy of this mapping (one primary-only, one primary+fallback), with a
 * source comment warning the two "MUST match" the server-side stage
 * definitions in app/api/tenders/[id]/workflow-center/route.ts. Two
 * independently-maintained copies of the same by-stage list is exactly the
 * kind of drift risk that comment was flagging — this file is the single
 * source both components import instead.
 *
 * Order matters: the first selector in each stage's array is the primary
 * target; any further selectors are fallbacks tried only if the primary
 * panel isn't present on the page.
 */
export const TENDER_WORKFLOW_STAGE_TARGETS: Record<number, string[]> = {
  1: ["#tender-files"],
  2: ["#extraction-quality", "#tender-files"],
  3: ["#ai-analyze-section"],
  4: ["#requirement-coverage", "#ai-analyze-section"],
  5: ["#tender-edit-form"],
  6: ["#submission-plan", "#submission-plan-reconciliation"],
  7: ["#match-evidence", "#requirement-coverage"],
  8: ["#generated-documents", "#submission-plan"],
  9: ["#authority-review", "#generated-documents"],
  10: ["#export-readiness", "#final-package-manifest"],
};
