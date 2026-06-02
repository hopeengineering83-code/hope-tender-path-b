// Weak-match classifier (I).
//
// PRODUCTION SYMPTOM
// ──────────────────
// Screenshots showed "28 of 28 experts with weak dimensions, 8 corrective
// actions, weak scope coverage" while 3 experts were selected. The matching
// engine produces a score per expert/project match (0..1) and a binary
// isSelected flag — but downstream readiness/strategy code treated a
// SELECTED match as fully "covered" regardless of how weak its score was.
// Selected-but-weak matches were therefore invisible to the operator.
//
// WHAT THIS MODULE DOES
// ─────────────────────
// Pure classifier consuming the raw match rows + the count of expert /
// project requirements the tender carries. Produces a WeakMatchReport with:
//
//   • selectedButWeakExperts / selectedButWeakProjects  — selected matches
//     whose score is below the strong threshold; the panel/ledger should
//     surface them with "selected but weak coverage" copy.
//   • reviewedSelectedStrongExperts / *Projects        — matches that pass
//     both REVIEWED trust AND strong-score thresholds; this is the count
//     readiness can honestly call "covered".
//   • needsJVExperts / needsJVProjects                 — true when the tender
//     requires experts/projects AND no STRONG candidate exists in any
//     match row (selected or not). Operator should consider a JV /
//     subcontract for the missing discipline.
//
// Hard guarantees: never invents evidence, never modifies the match rows,
// returns deterministic counts only.

export const WEAK_MATCH_STRONG_THRESHOLD = 0.70;
export const WEAK_MATCH_LOW_THRESHOLD = 0.40;

export type MatchRow = {
  id: string;
  score: number;
  isSelected: boolean;
  /** "REVIEWED" / "DRAFT" / other — anything other than "REVIEWED" is treated as draft. */
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
  reviewedSelectedStrongExperts: number;
  reviewedSelectedStrongProjects: number;
  /** Tender carries expert requirements AND no strong (≥0.70) expert match exists anywhere. */
  needsJVExperts: boolean;
  needsJVProjects: boolean;
  /** Labelled "selected but weak" rows, capped at 5, for audit-log / UI copy. */
  selectedButWeakExpertLabels: string[];
  selectedButWeakProjectLabels: string[];
};

export function classifyWeakMatches(input: WeakMatchInput): WeakMatchReport {
  const expertMatches = input.expertMatches ?? [];
  const projectMatches = input.projectMatches ?? [];

  const selectedExpertRows = expertMatches.filter((m) => m.isSelected);
  const selectedProjectRows = projectMatches.filter((m) => m.isSelected);

  const selectedButWeakExpertRows = selectedExpertRows.filter((m) => m.score < WEAK_MATCH_STRONG_THRESHOLD);
  const selectedButWeakProjectRows = selectedProjectRows.filter((m) => m.score < WEAK_MATCH_STRONG_THRESHOLD);

  const reviewedSelectedStrongExperts = selectedExpertRows
    .filter((m) => m.trustLevel === "REVIEWED" && m.score >= WEAK_MATCH_STRONG_THRESHOLD)
    .length;
  const reviewedSelectedStrongProjects = selectedProjectRows
    .filter((m) => m.trustLevel === "REVIEWED" && m.score >= WEAK_MATCH_STRONG_THRESHOLD)
    .length;

  const anyStrongExpert = expertMatches.some((m) => m.score >= WEAK_MATCH_STRONG_THRESHOLD);
  const anyStrongProject = projectMatches.some((m) => m.score >= WEAK_MATCH_STRONG_THRESHOLD);

  const needsJVExperts = (input.expertRequirementsCount ?? 0) > 0 && !anyStrongExpert;
  const needsJVProjects = (input.projectRequirementsCount ?? 0) > 0 && !anyStrongProject;

  return {
    selectedButWeakExperts: selectedButWeakExpertRows.length,
    selectedButWeakProjects: selectedButWeakProjectRows.length,
    reviewedSelectedStrongExperts,
    reviewedSelectedStrongProjects,
    needsJVExperts,
    needsJVProjects,
    selectedButWeakExpertLabels: selectedButWeakExpertRows.slice(0, 5).map((m) => m.label),
    selectedButWeakProjectLabels: selectedButWeakProjectRows.slice(0, 5).map((m) => m.label),
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
