/**
 * Tender-specific applicability states for requirement/field evaluation.
 *
 * Per Pillar 5: replaces rigid "required vs not-required" binary logic with
 * a nuanced applicability classification that reflects what the tender
 * source actually says about each item.
 *
 * Only block when:
 *   - the tender explicitly requires the item AND it is unresolved (FOUND_AND_GROUNDED is absent)
 *   - an indispensable final-delivery fact is genuinely missing (NOT_STATED with requiredFor: "final_submission")
 *
 * Do NOT block when:
 *   - the tender explicitly says the item is not required (EXPLICITLY_NOT_REQUIRED)
 *   - the tender doesn't mention the item at all (NOT_STATED) — unless it's an indispensable final-delivery fact
 *   - extraction failed but the item might not be required (EXTRACTION_FAILED)
 */

export type TenderApplicabilityState =
  | "FOUND_AND_GROUNDED"       // Item found in source with valid page/quote provenance
  | "EXPLICITLY_NOT_REQUIRED"  // Tender source explicitly states this item is not required
  | "NOT_STATED"               // Tender source does not mention this item at all
  | "UNREADABLE"               // Item exists in source but the relevant section is unreadable (OCR needed, corrupt, etc.)
  | "EXTRACTION_FAILED"        // Extraction pipeline failed to process the file containing this item
  | "CONFLICTING";             // Multiple sources disagree about this item's value or requirement

/**
 * Whether an applicability state should BLOCK generation/export.
 *
 * Only FOUND_AND_GROUNDED is unblocked. EXPLICITLY_NOT_REQUIRED is also
 * unblocked (the item is not needed). NOT_STATED is unblocked UNLESS the
 * item is an indispensable final-delivery fact (deadline, submission method,
 * client name). All other states are blocked.
 */
export function shouldBlockOnApplicability(
  state: TenderApplicabilityState,
  isIndispensableForFinalDelivery: boolean,
): boolean {
  switch (state) {
    case "FOUND_AND_GROUNDED":
      return false;
    case "EXPLICITLY_NOT_REQUIRED":
      return false;
    case "NOT_STATED":
      // Only block if this is an indispensable final-delivery fact (deadline,
      // submission method, client name). Otherwise, NOT_STATED is advisory.
      return isIndispensableForFinalDelivery;
    case "UNREADABLE":
      // Block — the user needs to fix the source (OCR, re-upload) before we
      // can determine whether the item is required.
      return true;
    case "EXTRACTION_FAILED":
      // Block — extraction must succeed before we can evaluate applicability.
      return true;
    case "CONFLICTING":
      // Block — the user must resolve the conflict manually.
      return true;
    default:
      return true;
  }
}

/**
 * Human-readable label for each applicability state, suitable for display
 * in the UI's readiness panels.
 */
export const APPLICABILITY_LABELS: Record<TenderApplicabilityState, string> = {
  FOUND_AND_GROUNDED: "Found and grounded",
  EXPLICITLY_NOT_REQUIRED: "Explicitly not required",
  NOT_STATED: "Not stated in tender",
  UNREADABLE: "Source unreadable",
  EXTRACTION_FAILED: "Extraction failed",
  CONFLICTING: "Conflicting sources",
};

/**
 * Set of fields that are indispensable for final delivery. If any of these
 * are NOT_STATED, the generation/export gate blocks.
 */
export const INDISPENSABLE_FINAL_DELIVERY_FIELDS: ReadonlySet<string> = new Set([
  "deadline",
  "submissionMethod",
  "clientName",
  "title",
]);

/**
 * Check if a field key is indispensable for final delivery.
 */
export function isIndispensableField(fieldKey: string): boolean {
  return INDISPENSABLE_FINAL_DELIVERY_FIELDS.has(fieldKey);
}
