type ExtractionStatus = string;

export interface GenerationGateStatus {
  extractionOk: boolean;
  clientDetailsOk: boolean;
  requirementsOk: boolean;
  submissionPlanOk: boolean;
  allGatesMet: boolean;
  blockers: string[];
  recommendations: string[];
}

export function checkGenerationGates(input: {
  extractionStatus?: ExtractionStatus | null;
  requirementCount: number;
  hasProcuringEntity: boolean;
  hasSubmissionMethod: boolean;
  hasSubmissionEmails: boolean;
  hasEvaluationMethodology: boolean;
  buildsSubmissionPlan: boolean;
}): GenerationGateStatus {
  const blockers: string[] = [];
  const recommendations: string[] = [];

  // Gate 1: Extraction Quality
  const extractionOk =
    input.extractionStatus === "FULL_EXTRACTION_AI_ANALYZED" ||
    input.extractionStatus === "PARTIAL_EXTRACTION_AI_ANALYZED";

  if (!extractionOk) {
    if (input.extractionStatus?.includes("WEAK")) {
      blockers.push("Weak extraction quality - manual review recommended before generation");
      recommendations.push("Upload a clearer scan or enable OCR");
    } else if (!input.extractionStatus) {
      blockers.push("Document has not been analyzed - run AI Analyze first");
    }
  }

  // Gate 2: Client/Procuring Entity Details
  const clientDetailsOk = input.hasProcuringEntity;
  if (!clientDetailsOk) {
    blockers.push("Procuring entity not extracted - required for document generation");
    recommendations.push("Manually confirm or correct the procuring entity name");
  }

  // Gate 3: Requirements
  const requirementsOk = input.requirementCount > 0;
  if (!requirementsOk) {
    blockers.push("No requirements extracted - analysis did not identify tender requirements");
    recommendations.push("Review tender document manually or retry analysis");
  }

  // Gate 4: Submission Plan
  const submissionPlanOk = input.hasSubmissionMethod && input.hasSubmissionEmails;
  if (!submissionPlanOk) {
    blockers.push("Submission method and/or email not extracted - required for submission plan");
    recommendations.push("Manually confirm submission method and contact details");
  }

  // Gate 5: Evaluation Methodology (for scoring/evaluation guidance)
  if (!input.hasEvaluationMethodology && input.requirementCount > 0) {
    recommendations.push("Evaluation methodology not found - evaluation guidance will be limited");
  }

  return {
    extractionOk,
    clientDetailsOk,
    requirementsOk,
    submissionPlanOk,
    allGatesMet: extractionOk && clientDetailsOk && requirementsOk && submissionPlanOk,
    blockers,
    recommendations,
  };
}

export function getGatesSummary(gates: GenerationGateStatus): string {
  if (gates.allGatesMet) {
    return "All gates passed - ready for document generation";
  }

  const failedGates = [];
  if (!gates.extractionOk) failedGates.push("extraction");
  if (!gates.clientDetailsOk) failedGates.push("client details");
  if (!gates.requirementsOk) failedGates.push("requirements");
  if (!gates.submissionPlanOk) failedGates.push("submission plan");

  return `${failedGates.length} gate(s) blocked: ${failedGates.join(", ")}`;
}
