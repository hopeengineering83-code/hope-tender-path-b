import { OWNER_PRICING_ACTION } from "./owner-pricing-stop";
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
  ].includes(decision.currentBlockingStage)) {
    return {
      ...decision,
      nextRequiredAction: "RUN_ENGINE",
      nextRequiredActionLabel: "Run Engine",
      nextRequiredActionReason:
        "Run Engine uses the current verified source and current AI analysis, then starts matching and Build Plan creation. Valid downstream stages continue automatically.",
    };
  }

  // The only files still missing are ones the owner must sign or supply
  // (bidder declarations, tender-issued forms, certified originals). Saying
  // "Processing automatically" there left the owner waiting on a worker that
  // had nothing left to do (2026-09-30, Preview, a telecom-tower EOI).
  const awaiting = decision.awaitingOwnerOriginalFileNames ?? [];
  const pricing = decision.awaitingOwnerPricingFileNames ?? [];
  const missing = Math.max(0, decision.requiredDocumentsTotal - decision.generatedDocumentsTotal);
  if (decision.currentBlockingStage === "REQUIRED_DOCS_NOT_GENERATED" && pricing.length > 0 && missing <= awaiting.length + pricing.length) {
    // The financial proposal waits for the owner's prices; the app never sets
    // a price. Any signed originals still due are named alongside.
    const originals = awaiting.length > 0
      ? ` Also upload the signed original of: ${awaiting.join("; ")}.`
      : "";
    return {
      ...decision,
      nextRequiredAction: "ENTER_OWNER_PRICING",
      nextRequiredActionLabel: "Enter prices",
      nextRequiredActionReason:
        `Everything the app can prepare is done. ${OWNER_PRICING_ACTION} (${pricing.join("; ")}). The package completes automatically after that.${originals}`,
    };
  }
  if (decision.currentBlockingStage === "REQUIRED_DOCS_NOT_GENERATED" && awaiting.length > 0 && missing <= awaiting.length) {
    return {
      ...decision,
      nextRequiredAction: "UPLOAD_SIGNED_ORIGINALS",
      nextRequiredActionLabel: awaiting.length === 1 ? "Upload your signed original" : "Upload your signed originals",
      nextRequiredActionReason:
        `Everything the app can prepare is done. The package waits only on ${awaiting.length === 1 ? "a document" : "documents"} your company must sign or supply: ${awaiting.join("; ")}. Upload the signed original of each on the tender's Documents page; the package completes automatically after that.`,
    };
  }

  if ([
    "REQUIRED_DOCS_NOT_GENERATED",
    "PDF_REQUIRED_UNAVAILABLE",
    "DOCS_NOT_VALIDATED",
  ].includes(decision.currentBlockingStage)) {
    return {
      ...decision,
      nextRequiredAction: "AUTOMATIC_PROCESSING",
      nextRequiredActionLabel: "Processing automatically",
      nextRequiredActionReason:
        "The post-Engine durable workflow owns generation, validation, finalization and package assembly. Intervene only when a specific source, evidence, quality, integrity, authority or legal blocker is reported.",
    };
  }

  return decision;
}
