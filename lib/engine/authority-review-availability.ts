export type AuthorityReviewAvailabilityInput = {
  buildPlanConfirmed: boolean;
  requiredDocumentCount: number;
  missingRequiredCount: number;
  validDocumentCount: number;
  generatedDocumentCount: number;
};

export type AuthorityReviewAvailability =
  | { available: true; code: null; reason: null }
  | {
      available: false;
      code:
        | "BUILD_PLAN_CONFIRMATION_REQUIRED"
        | "BUILD_PLAN_REQUIRED"
        | "REQUIRED_DOCUMENTS_MISSING"
        | "DOCUMENT_VALIDATION_REQUIRED";
      reason: string;
    };

/**
 * Authority Review examines actual, validated package documents. It must not
 * manufacture an early-stage score when there is no confirmed plan or no
 * reviewable document set.
 */
export function resolveAuthorityReviewAvailability(
  input: AuthorityReviewAvailabilityInput,
): AuthorityReviewAvailability {
  if (!input.buildPlanConfirmed) {
    return {
      available: false,
      code: "BUILD_PLAN_CONFIRMATION_REQUIRED",
      reason: "Run Engine must create and source-verify the Build Plan before Authority Review.",
    };
  }
  if (input.requiredDocumentCount <= 0) {
    return {
      available: false,
      code: "BUILD_PLAN_REQUIRED",
      reason: "Run Engine must derive the tender-controlled document plan before Authority Review.",
    };
  }
  if (input.generatedDocumentCount <= 0 || input.missingRequiredCount > 0) {
    return {
      available: false,
      code: "REQUIRED_DOCUMENTS_MISSING",
      reason: "Automatic post-Engine generation must complete every required document before Authority Review.",
    };
  }
  if (input.validDocumentCount < input.requiredDocumentCount) {
    return {
      available: false,
      code: "DOCUMENT_VALIDATION_REQUIRED",
      reason: "Automatic validation must pass every required document before Authority Review.",
    };
  }
  return { available: true, code: null, reason: null };
}
