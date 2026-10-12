// Weak-match classifier (I).
//
// Classifies selected-but-weak matches and genuine portfolio gaps without
// treating a selection flag as evidence authority. Match consumers that have
// full provenance must filter through canUseVaultRecord first; this pure helper
// accepts only the honest trust states that can represent eligible evidence.

export const WEAK_MATCH_STRONG_THRESHOLD = 0.70;
export const WEAK_MATCH_LOW_THRESHOLD = 0.40;

export type MatchRow = {
  id: string;
  score: number;
  isSelected: boolean;
  /** REVIEWED is human-reviewed; SOURCE_VERIFIED is machine-verified from current source bytes. */
  trustLevel: string;
  /** Human label for the audit description (expert.fullName / project.name). */
  label: string;
};

export type WeakMatchInput = {
  expertMatches: MatchRow[];
  projectMatches: MatchRow[];
  /** Number of expert/discipline requirements in the tender. */
  expertRequirementsCount: number;
  /** Number of project-reference / similar-experience requirements in the tender. */
  projectRequirementsCount: number;
};

export type WeakMatchReport = {
  selectedButWeakExperts: number;
  selectedButWeakProjects: number;
  /** Legacy field names retained for compatibility; values include eligible SOURCE_VERIFIED records. */
  reviewedSelectedStrongExperts: number;
  reviewedSelectedStrongProjects: number;
  /** Tender carries requirements and no eligible strong candidate exists anywhere. */
  needsJVExperts: boolean;
  needsJVProjects: boolean;
  /** Labelled "selected but weak" rows, capped at 5, for audit-log / UI copy. */
  selectedButWeakExpertLabels: string[];
  selectedButWeakProjectLabels: string[];
};

export function isEligibleMatchTrustLevel(trustLevel: string | null | undefined): boolean {
  return trustLevel === "REVIEWED" || trustLevel === "SOURCE_VERIFIED";
}

export function classifyWeakMatches(input: WeakMatchInput): WeakMatchReport {
  const expertMatches = input.expertMatches ?? [];
  const projectMatches = input.projectMatches ?? [];

  const selectedExpertRows = expertMatches.filter((match) => match.isSelected);
  const selectedProjectRows = projectMatches.filter((match) => match.isSelected);

  const selectedButWeakExpertRows = selectedExpertRows.filter((match) => match.score < WEAK_MATCH_STRONG_THRESHOLD);
  const selectedButWeakProjectRows = selectedProjectRows.filter((match) => match.score < WEAK_MATCH_STRONG_THRESHOLD);

  const reviewedSelectedStrongExperts = selectedExpertRows
    .filter((match) => isEligibleMatchTrustLevel(match.trustLevel) && match.score >= WEAK_MATCH_STRONG_THRESHOLD)
    .length;
  const reviewedSelectedStrongProjects = selectedProjectRows
    .filter((match) => isEligibleMatchTrustLevel(match.trustLevel) && match.score >= WEAK_MATCH_STRONG_THRESHOLD)
    .length;

  // A high numeric score on DRAFT/unverified data cannot prove that the company
  // owns a strong candidate and therefore cannot suppress a genuine JV gap.
  const anyStrongExpert = expertMatches.some(
    (match) => isEligibleMatchTrustLevel(match.trustLevel) && match.score >= WEAK_MATCH_STRONG_THRESHOLD,
  );
  const anyStrongProject = projectMatches.some(
    (match) => isEligibleMatchTrustLevel(match.trustLevel) && match.score >= WEAK_MATCH_STRONG_THRESHOLD,
  );

  const needsJVExperts = (input.expertRequirementsCount ?? 0) > 0 && !anyStrongExpert;
  const needsJVProjects = (input.projectRequirementsCount ?? 0) > 0 && !anyStrongProject;

  return {
    selectedButWeakExperts: selectedButWeakExpertRows.length,
    selectedButWeakProjects: selectedButWeakProjectRows.length,
    reviewedSelectedStrongExperts,
    reviewedSelectedStrongProjects,
    needsJVExperts,
    needsJVProjects,
    selectedButWeakExpertLabels: selectedButWeakExpertRows.slice(0, 5).map((match) => match.label),
    selectedButWeakProjectLabels: selectedButWeakProjectRows.slice(0, 5).map((match) => match.label),
  };
}

/** True when a selected match should display the "selected but weak coverage" badge. */
export function isSelectedButWeak(score: number): boolean {
  return score < WEAK_MATCH_STRONG_THRESHOLD;
}

/** Classify a single match's coverage strength — useful for per-row UI badges. */
export type MatchCoverageStrength = "STRONG" | "WEAK" | "UNCOVERED";
export function matchCoverageStrength(score: number): MatchCoverageStrength {
  if (score >= WEAK_MATCH_STRONG_THRESHOLD) return "STRONG";
  if (score >= WEAK_MATCH_LOW_THRESHOLD) return "WEAK";
  return "UNCOVERED";
}
