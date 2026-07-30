export type ReleaseSnapshotEligibilityInput = {
  extractionBlocker: string | null;
  analysisBlocker: string | null;
  metadataGenerationBlocker: string | null;
  metadataFinalBlocker: string | null;
  requirementsBlocker: string | null;
  buildPlanGateBlocker: string | null;
  /** Matching/draft blocker: neither current SOURCE_VERIFIED nor human REVIEWED evidence is selected. */
  matchingVaultBlocker: string | null;
  /**
   * Deprecated compatibility input. Vault evidence authority is already
   * enforced by matchingVaultBlocker and the safe runtime-authority resolver.
   * This value must not create a second human-only approval gate.
   */
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
 * Sole tier-inheritance owner. Current, source-backed Company Vault evidence
 * has one authority contract across all tiers: durable SOURCE_VERIFIED and
 * durable human REVIEWED evidence are equally eligible. Human review remains
 * an optional audit action, not an additional export prerequisite.
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
