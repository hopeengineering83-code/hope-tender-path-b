import type { MatchingResult, RequirementDraft } from "../infrastructure/types";

type TrustLookup = Map<string, string | null | undefined>;

type MatchWithSelection = {
  score: number;
  isSelected: boolean;
};

type ExpertMatch = MatchingResult["expertMatches"][number];
type ProjectMatch = MatchingResult["projectMatches"][number];

// Aligned with MIN_FLOOR_SCORE in matching.ts (0.55) so the safety-net
// fallback does not reintroduce off-sector reviewed records that the
// tighter relevance gates in buildMatches are designed to exclude.
const MIN_REVIEWED_SAFE_SCORE = 0.55;
// Below-safe floor used ONLY when the safe floor would produce zero
// selections AND the firm has reviewed records that COULD anchor a
// proposal. This unblocks healthcare-tender / water-vault scenarios
// where the dominant-family penalty (matching.ts:318) collapses
// every score below 0.55 but the firm needs to bid anyway. The
// "BEST-AVAILABLE BELOW THRESHOLD" rationale prefix flags these
// promotions so reviewers know they need human verification.
const MIN_REVIEWED_BEST_AVAILABLE_SCORE = 0.20;
const DEFAULT_EXPERT_LIMIT = 4;
const DEFAULT_PROJECT_LIMIT = 3;

function requirementLimit(requirements: RequirementDraft[], requirementType: "EXPERT" | "PROJECT_EXPERIENCE", fallback: number): number {
  const relevant = requirements.filter((r) => r.requirementType === requirementType);
  if (relevant.length === 0) return 0;
  const explicit = relevant.reduce((sum, r) => sum + Math.max(0, Number(r.requiredQuantity ?? 0)), 0);
  if (explicit > 0) return Math.min(12, explicit);
  const mandatoryCount = relevant.filter((r) => /MANDATORY|CRITICAL|HIGH/i.test(String(r.priority ?? ""))).length;
  return Math.min(12, Math.max(fallback, mandatoryCount));
}

function hasSelected(matches: MatchWithSelection[]): boolean {
  return matches.some((m) => m.isSelected);
}

function reviewed(trust: TrustLookup, id: string): boolean {
  return trust.get(id) === "REVIEWED";
}

function promotedRationale(original: string, score: number): string {
  const pct = Math.round(score * 100);
  return `${original} [Main Engine Best-Available Selection] Auto-selected reviewed evidence at ${pct}% because no safe selected evidence existed for this required class. Below-90 reviewed evidence is allowed when it is the best available safe match; draft knowledge is not promoted.`;
}

function bestAvailableBelowThresholdRationale(original: string, score: number): string {
  const pct = Math.round(score * 100);
  return `${original} [BEST-AVAILABLE BELOW THRESHOLD] Auto-selected reviewed evidence at ${pct}% — every reviewed record scored below the 55% safe floor (typical when the tender's primary sector differs from the firm's vault). Bid team MUST verify this record's relevance before submission. Consider uploading sector-aligned experts / projects to lift future matches.`;
}

function selectBestReviewedExperts(matches: ExpertMatch[], expertTrust: TrustLookup, limit: number): ExpertMatch[] {
  if (limit <= 0 || hasSelected(matches)) return matches;

  // First pass: try to promote at the safe floor (0.55).
  let selected = 0;
  let promoted = matches.map((match) => {
    if (selected < limit && match.score >= MIN_REVIEWED_SAFE_SCORE && reviewed(expertTrust, match.expertId)) {
      selected += 1;
      return { ...match, isSelected: true, rationale: promotedRationale(match.rationale, match.score) };
    }
    return match;
  });
  if (selected > 0) return promoted;

  // Second pass (round 11): the safe floor produced zero. Promote the
  // top-N reviewed records by score above the BEST-AVAILABLE floor.
  // This unblocks proposals for tenders whose primary sector differs
  // from the firm's vault, while flagging the promotions for human
  // verification via the BEST-AVAILABLE rationale prefix.
  selected = 0;
  promoted = matches.map((match) => {
    if (selected < limit && match.score >= MIN_REVIEWED_BEST_AVAILABLE_SCORE && reviewed(expertTrust, match.expertId)) {
      selected += 1;
      return { ...match, isSelected: true, rationale: bestAvailableBelowThresholdRationale(match.rationale, match.score) };
    }
    return match;
  });
  return promoted;
}

function selectBestReviewedProjects(matches: ProjectMatch[], projectTrust: TrustLookup, limit: number): ProjectMatch[] {
  if (limit <= 0 || hasSelected(matches)) return matches;

  let selected = 0;
  let promoted = matches.map((match) => {
    if (selected < limit && match.score >= MIN_REVIEWED_SAFE_SCORE && reviewed(projectTrust, match.projectId)) {
      selected += 1;
      return { ...match, isSelected: true, rationale: promotedRationale(match.rationale, match.score) };
    }
    return match;
  });
  if (selected > 0) return promoted;

  // Second pass: best-available below the safe floor (see expert path).
  selected = 0;
  promoted = matches.map((match) => {
    if (selected < limit && match.score >= MIN_REVIEWED_BEST_AVAILABLE_SCORE && reviewed(projectTrust, match.projectId)) {
      selected += 1;
      return { ...match, isSelected: true, rationale: bestAvailableBelowThresholdRationale(match.rationale, match.score) };
    }
    return match;
  });
  return promoted;
}

export function applyMainEngineBestAvailableSelection(params: {
  requirements: RequirementDraft[];
  matching: MatchingResult;
  expertTrust: TrustLookup;
  projectTrust: TrustLookup;
}): MatchingResult {
  const expertLimit = requirementLimit(params.requirements, "EXPERT", DEFAULT_EXPERT_LIMIT);
  const projectLimit = requirementLimit(params.requirements, "PROJECT_EXPERIENCE", DEFAULT_PROJECT_LIMIT);

  return {
    ...params.matching,
    expertMatches: selectBestReviewedExperts(params.matching.expertMatches, params.expertTrust, expertLimit),
    projectMatches: selectBestReviewedProjects(params.matching.projectMatches, params.projectTrust, projectLimit),
  };
}
