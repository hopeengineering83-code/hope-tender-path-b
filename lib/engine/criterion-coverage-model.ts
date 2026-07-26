/**
 * Unweighted Criterion Coverage Model
 *
 * Supports named evaluation criteria even when no percentages exist.
 * NEVER assigns equal or estimated weights — weight status is always
 * "Not provided" when the tender doesn't state weights.
 *
 * For each criterion, records:
 *   - exact source wording and source page
 *   - weight status: "Not provided" (never "equal" or "estimated")
 *   - proposal section or table answering it
 *   - reviewed expert/project/company evidence
 *   - evidence source and page
 *   - coverage state: covered, partial, or missing
 *   - internal corrective action when partial or missing
 *
 * Generation may create an internal draft with partial coverage, but final
 * approval and export MUST fail when a mandatory criterion lacks grounded
 * evidence.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type WeightStatus = "Not provided" | "Stated";

export type CoverageState = "covered" | "partial" | "missing";

export type CriterionCoverage = {
  /** The criterion ID (stable across re-extraction). */
  id: string;
  /** The criterion name (e.g. "Relevant healthcare project experience"). */
  name: string;
  /** Exact source wording from the tender. */
  sourceWording: string;
  /** Source page number (1-indexed). */
  sourcePage: number | null;
  /** Source file ID. */
  sourceFileId: string | null;
  /** Weight status — "Not provided" when the tender doesn't state weights. */
  weightStatus: WeightStatus;
  /** The weight percentage if stated, null otherwise. */
  weightPercent: number | null;
  /** The proposal section or table that answers this criterion. */
  proposalSection: string;
  /** Reviewed evidence (expert IDs, project IDs, company facts). */
  evidence: CriterionEvidence[];
  /** Coverage state: covered, partial, or missing. */
  coverageState: CoverageState;
  /** Internal corrective action when partial or missing. */
  correctiveAction: string | null;
};

export type CriterionEvidence = {
  /** The evidence type: expert, project, or company fact. */
  type: "expert" | "project" | "company";
  /** The evidence ID (expert ID, project ID, or fact key). */
  id: string;
  /** The evidence source (e.g. CV document, project reference). */
  source: string;
  /** The evidence source page. */
  sourcePage: number | null;
};

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * The five mandatory evaluation criteria for healthcare facility design
 * tenders (per the Pharo acceptance fixture). These are the minimum set —
 * the tender may add more.
 *
 * Weights are NEVER assigned — weight status is "Not provided".
 */
export const MANDATORY_HEALTHCARE_CRITERIA = [
  "Relevant healthcare project experience",
  "Quality and relevance of portfolio",
  "Technical understanding of healthcare facility design",
  "Strength of professional team",
  "Compliance with submission requirements",
] as const;

// ─── Coverage evaluation ────────────────────────────────────────────────────

/**
 * Evaluate the coverage state for a criterion.
 *
 * Rules:
 *   - "covered": at least one reviewed evidence item with source page.
 *   - "partial": evidence exists but is unreviewed, or no source page.
 *   - "missing": no evidence.
 */
export function evaluateCriterionCoverage(criterion: {
  evidence: CriterionEvidence[];
}): CoverageState {
  if (criterion.evidence.length === 0) return "missing";
  const hasReviewedWithPage = criterion.evidence.some(
    (e) => e.sourcePage !== null && e.source.trim().length > 0,
  );
  if (hasReviewedWithPage) return "covered";
  // Has evidence but no source page → partial
  return "partial";
}

/**
 * Determine the corrective action for a criterion based on coverage state.
 */
export function getCorrectiveAction(
  criterionName: string,
  coverageState: CoverageState,
): string | null {
  switch (coverageState) {
    case "covered":
      return null;
    case "partial":
      return `Add source page references to the evidence for "${criterionName}" — current evidence lacks page-level provenance.`;
    case "missing":
      return `Add reviewed expert or project evidence that answers "${criterionName}" — no evidence is currently mapped.`;
  }
}

/**
 * Check if a criterion's coverage state blocks final export.
 *
 * Final approval and export MUST fail when a mandatory criterion lacks
 * grounded evidence (coverageState = "missing" or "partial").
 *
 * Generation may create an internal draft with partial coverage — this only
 * blocks FINAL export, not drafting.
 */
export function blocksFinalExport(criterion: {
  coverageState: CoverageState;
  isMandatory: boolean;
}): boolean {
  if (!criterion.isMandatory) return false;
  return criterion.coverageState !== "covered";
}

// ─── Weight assignment guard ────────────────────────────────────────────────

/**
 * NEVER assign equal or estimated weights. If the tender doesn't state
 * weights, the weight status is "Not provided" and weightPercent is null.
 *
 * This function is the SINGLE guard that prevents the system from ever
 * assigning "equal" or "estimated" weights.
 */
export function assignWeightStatus(
  statedWeight: number | null | undefined,
): { weightStatus: WeightStatus; weightPercent: number | null } {
  if (statedWeight == null || isNaN(statedWeight) || statedWeight < 0 || statedWeight > 100) {
    return { weightStatus: "Not provided", weightPercent: null };
  }
  return { weightStatus: "Stated", weightPercent: statedWeight };
}

/**
 * Verify that a set of criteria does NOT use equal or estimated weights.
 * Returns true if the weight assignment is valid (i.e. weights are either
 * stated or "Not provided" — never "equal" or "estimated").
 */
export function hasValidWeightAssignment(criteria: Array<{ weightStatus: WeightStatus }>): boolean {
  return criteria.every((c) => c.weightStatus === "Not provided" || c.weightStatus === "Stated");
}
