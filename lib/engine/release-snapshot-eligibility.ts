export type ReleaseSnapshotEligibilityInput = {
  extractionBlocker: string | null;
  analysisBlocker: string | null;
  metadataGenerationBlocker: string | null;
  metadataFinalBlocker: string | null;
  requirementsBlocker: string | null;
  buildPlanGateBlocker: string | null;
  /** Human-review blocker for final output. Matching/draft generation has its own source-verification policy. */
  vaultBlocker: string | null;
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
 * Pure release-snapshot eligibility resolver.
 *
 * Draft generation and final output deliberately have different trust rules.
 * Source-verified evidence may support matching and draft generation when the
 * matching policy accepts it. Final export and Final ZIP additionally require
 * genuine human review; therefore the Vault human-review blocker belongs only
 * to final-output blocker lists.
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
  ]);

  const evidenceBlocker =
    input.mandatoryRequirementCount > 0 && input.evidenceCoveragePercent < 50
      ? `Evidence coverage is ${input.evidenceCoveragePercent}% (need ≥ 50% for export).`
      : null;

  const exportBlockers = compactUnique([
    ...generationBlockers,
    input.metadataFinalBlocker,
    input.vaultBlocker,
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
