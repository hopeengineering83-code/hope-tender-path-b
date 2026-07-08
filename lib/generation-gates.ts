// Generation gates — operation-aware.
//
// For DRAFT_GENERATION and REVIEW_EXPORT:
//   • Metadata gates (client details, submission method/endpoint) are
//     WARNINGS only — they never make allGatesMet false.
//   • Only extraction quality and requirements (genuine non-metadata risks)
//     may push to blockers.
//
// For FINAL_SUBMISSION_READY:
//   • All gates are strict — use the FINAL_SUBMISSION_READY operation
//     via resolveTenderOperationGate instead of this function.
//
// This module is kept for backward compatibility with routes that call
// checkGenerationGates. The operation gate (lib/engine/tender-operation-gate.ts)
// is the sole authority for metadata eligibility.

type ExtractionStatus = string;

export interface GenerationGateStatus {
  extractionOk: boolean;
  clientDetailsOk: boolean;
  requirementsOk: boolean;
  submissionPlanOk: boolean;
  allGatesMet: boolean;
  blockers: string[];
  recommendations: string[];
  /** Metadata warnings (non-blocking) — surfaced to the UI as optional notices. */
  metadataWarnings: string[];
}

export function checkGenerationGates(input: {
  extractionStatus?: ExtractionStatus | null;
  requirementCount: number;
  hasProcuringEntity: boolean;
  hasSubmissionMethod: boolean;
  hasSubmissionEmails: boolean;
  hasSubmissionAddress?: boolean;
  hasEvaluationMethodology: boolean;
  buildsSubmissionPlan: boolean;
}): GenerationGateStatus {
  const blockers: string[] = [];
  const recommendations: string[] = [];
  const metadataWarnings: string[] = [];

  // Gate 1: Extraction Quality — genuine non-metadata risk
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

  // Gate 2: Client/Procuring Entity Details — METADATA (warning only for draft)
  const clientDetailsOk = input.hasProcuringEntity;
  if (!clientDetailsOk) {
    metadataWarnings.push("Procuring entity not extracted — omitted from draft output");
    recommendations.push("Manually confirm or correct the procuring entity name");
  }

  // Gate 3: Requirements — METADATA (warning only for draft)
  // Missing requirements is a warning for draft work. The user can generate
  // a skeleton/draft proposal from available tender source text.
  const requirementsOk = input.requirementCount > 0;
  if (!requirementsOk) {
    metadataWarnings.push("No requirements extracted — draft will use source text only");
    recommendations.push("Run AI Analyze to extract requirements for better draft coverage");
  }

  // Gate 4: Submission Plan — METADATA (warning only for draft)
  const hasEndpoint = input.hasSubmissionEmails || input.hasSubmissionAddress === true;
  const submissionPlanOk = input.hasSubmissionMethod && hasEndpoint;
  if (!submissionPlanOk) {
    if (!input.hasSubmissionMethod) {
      metadataWarnings.push("Submission method not extracted — omitted from draft output");
    } else {
      metadataWarnings.push("Submission endpoint not extracted — omitted from draft output");
    }
    recommendations.push("Manually confirm the submission method and a submission endpoint (email or address)");
  }

  // Gate 5: Evaluation Methodology (warning only — never blocks)
  if (!input.hasEvaluationMethodology && input.requirementCount > 0) {
    recommendations.push("Evaluation methodology not found - evaluation guidance will be limited");
  }

  // allGatesMet: only extraction quality is a hard gate for draft work.
  // All metadata gates (client details, requirements, submission plan) are
  // warnings — they never make allGatesMet false.
  return {
    extractionOk,
    clientDetailsOk,
    requirementsOk,
    submissionPlanOk,
    allGatesMet: extractionOk,
    blockers,
    recommendations,
    metadataWarnings,
  };
}

export function getGatesSummary(gates: GenerationGateStatus): string {
  if (gates.allGatesMet) {
    return "All gates passed - ready for document generation";
  }

  const failedGates = [];
  if (!gates.extractionOk) failedGates.push("extraction");
  if (!gates.requirementsOk) failedGates.push("requirements");

  return `${failedGates.length} gate(s) blocked: ${failedGates.join(", ")}`;
}
