export const PRODUCT_TERMS = {
  tenderDetails: "Tender Details",
  sourceGroundedTenderFacts: "Source-Grounded Tender Facts",
  submissionFacts: "Submission Facts",
  clientFacts: "Client / Procuring Entity Facts",
  deadlineInstructions: "Deadline and Submission Instructions",
  requiredDocuments: "Required Documents",
  finalPackageFacts: "Final Package Facts",
  exportReadiness: "Export Readiness",
} as const;

export const FORBIDDEN_USER_FACING_METADATA_TERMS = [
  "Metadata",
  "Complete Metadata",
  "Confirm Metadata",
  "Repair Metadata",
  "extracted metadata",
  "metadata gaps",
  "metadata blockers",
  "metadata score",
  "metadata readiness",
] as const;
