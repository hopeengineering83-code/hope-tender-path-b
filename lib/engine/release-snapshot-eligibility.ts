export type ReleaseSnapshotEligibilityInput = {
  extractionBlocker: string | null;
  analysisBlocker: string | null;
  metadataGenerationBlocker: string | null;
  metadataFinalBlocker: string | null;
  requirementsBlocker: string | null;
  buildPlanGateBlocker: string | null;
  /** Matching/draft blocker: neither current SOURCE_VERIFIED nor human REVIEWED evidence is selected. */
  matchingVaultBlocker: string | null;
  /** Final-output blocker: selected evidence lacks current durable human review. */
  finalApprovalVaultBlocker: string | null;
  mandatoryRequirementCount: number;
  evidenceCoveragePercent: number;
  allMandatoryGrounded: boolean;
};

export type ReleaseSnapshotEligibility = {
  generationBlockers: string[];
  exportBlockers: string[];
  finalZipBlockers: string[];
  generationEligible: boolean;
  exportEligible: boolean;
  finalZipEligible: boolean;
};

function compactUnique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

/**
 * Pure release-snapshot eligibility resolver and the sole tier-inheritance
 * owner. Source-verified evidence may satisfy matching and draft generation;
 * final export and Final ZIP additionally require genuine current human review.
 */
export function buildReleaseSnapshotEligibility(
  input: ReleaseSnapshotEligibilityInput,
): ReleaseSnapshotEligibility {
  const generationBlockers = compactUnique([
    input.extractionBlocker,
    input.analysisBlocker,
    input.metadataGenerationBlocker,
    input.requirementsBlocker,
    input.buildPlanGateBlocker,
    input.matchingVaultBlocker,
  ]);

  const evidenceBlocker =
    input.mandatoryRequirementCount > 0 && input.evidenceCoveragePercent < 50
      ? `Evidence coverage is ${input.evidenceCoveragePercent}% (need ≥ 50% for export).`
      : null;

  const exportBlockers = compactUnique([
    ...generationBlockers,
    input.metadataFinalBlocker,
    input.finalApprovalVaultBlocker,
    evidenceBlocker,
  ]);

  const finalZipBlockers = compactUnique([
    ...exportBlockers,
    input.mandatoryRequirementCount > 0 && !input.allMandatoryGrounded
      ? "All mandatory requirements must be source-grounded for Final ZIP."
      : null,
  ]);

  return {
    generationBlockers,
    exportBlockers,
    finalZipBlockers,
    generationEligible: generationBlockers.length === 0,
    exportEligible: exportBlockers.length === 0,
    finalZipEligible: finalZipBlockers.length === 0,
  };
}
