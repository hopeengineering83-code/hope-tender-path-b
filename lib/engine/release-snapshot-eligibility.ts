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

/**
 * How many named causes one gate sentence carries before it summarises the
 * rest. Enough to repair a package in a single pass; bounded so a gate can
 * never answer with a wall of text.
 */
export const MAX_NAMED_GATE_CAUSES = 5;

/**
 * Render a validator's blocker list as the ONE sentence a gate reports.
 *
 * THE DEFECT THIS REPLACES. Two gates took `blockers[0]`:
 *
 *   metadataGateBlocker  = validation.blockers[0]     ?? "...";
 *   buildPlanGateBlocker = itemValidation.blockers[0] ?? "...";
 *
 * Both validators produce one named, field-specific sentence PER failing
 * field ("Critical metadata field Submission Address has no meaningful source
 * quote."). Reporting the first means an owner with three ungrounded fields
 * is told about one, repairs it, is told about the next, and repairs that --
 * learning the size of the problem only by exhausting it. The names existed
 * at every step; an index threw them away.
 *
 * This is the same rule the canonical decision applies one layer up: name
 * what blocks, do not collapse it. The fallback still applies when a
 * validator fails without saying why, so a gate can never go quiet.
 */
export function describeGateBlockers(blockers: readonly string[] | null | undefined, fallback: string): string {
  const named = (blockers ?? []).map((blocker) => blocker?.trim() ?? "").filter((blocker) => blocker.length > 0);
  if (named.length === 0) return fallback;
  if (named.length <= MAX_NAMED_GATE_CAUSES) return named.join(" ");
  const shown = named.slice(0, MAX_NAMED_GATE_CAUSES);
  return `${shown.join(" ")} (and ${named.length - MAX_NAMED_GATE_CAUSES} more)`;
}

/** The shape this module needs from a resolved canonical Tender Fact. */
export type ExportGateFact = {
  label: string;
  status: string;
  exportEligible: boolean;
  blockerReason: string | null;
};

/**
 * Why the final Tender Facts gate is refusing export.
 *
 * THE DEFECT THIS REPLACES. The snapshot read one aggregate boolean,
 * `hasExportBlocker`, and answered with a constant:
 *
 *   "One or more final Tender Facts are missing, invalid, or lack sufficient
 *    audit authority."
 *
 * On the exact-head Preview that sentence was the ENTIRE reason the ZIP was
 * locked, beside 0 document blockers, 0 tender-level blockers, 0 quality
 * failures, 1/1 generated, 1/1 export-ready, and a validator reporting "All
 * canonical package and document validation checks passed." It names no field,
 * gives no count, and cannot be acted on.
 *
 * The resolver knew all of it. Every CanonicalFieldState already carries its
 * `label`, its `exportEligible` verdict and a written `blockerReason` -- e.g.
 * `Field "Deadline" has a value but is not yet source-grounded (missing page,
 * quote, or active file). Critical fields remain blocked until
 * source-grounded.` Those reasons were resolved and thrown away.
 *
 * Fields with no written reason are still named, with their status, so a fact
 * can never block export anonymously.
 */
export function describeMetadataExportBlocker(facts: readonly ExportGateFact[], fallback: string): string {
  return describeGateBlockers(
    facts
      .filter((fact) => !fact.exportEligible)
      .map((fact) => fact.blockerReason ?? `Field "${fact.label}" is not eligible for final export (status ${fact.status}).`),
    fallback,
  );
}
