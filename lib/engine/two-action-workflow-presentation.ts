import type { CanonicalWorkflowDecision } from "./canonical-workflow-decision";

/**
 * Product-level presentation of the canonical workflow decision.
 *
 * This does not change readiness, blockers, stage states, or export gates. It
 * maps server-owned intermediate stages onto the two normal user actions:
 * AI Analyze and Run Engine. Genuine source, quality, authority, and legal
 * blockers remain explicit.
 */
export function presentTwoActionWorkflowDecision(
  decision: CanonicalWorkflowDecision | null,
): CanonicalWorkflowDecision | null {
  if (!decision) return null;

  if ([
    "NO_CONFIRMED_BUILD_PLAN",
    "MANDATORY_NO_COMPLIANCE_ROWS",
    "REQUIRED_DOCS_NOT_GENERATED",
  ].includes(decision.currentBlockingStage)) {
    return {
      ...decision,
      nextRequiredAction: "RUN_ENGINE",
      nextRequiredActionLabel: "Run Engine",
      nextRequiredActionReason:
        "Run Engine uses the current verified source and current AI analysis, then starts matching and Build Plan creation. Valid downstream stages continue automatically.",
    };
  }

  if ([
    "PDF_REQUIRED_UNAVAILABLE",
    "DOCS_NOT_VALIDATED",
  ].includes(decision.currentBlockingStage)) {
    return {
      ...decision,
      nextRequiredAction: "AUTOMATIC_PROCESSING",
      nextRequiredActionLabel: "Processing automatically",
      nextRequiredActionReason:
        "The durable worker owns this stage. Intervene only when a specific source, quality, integrity or legal blocker is reported.",
    };
  }

  return decision;
}
