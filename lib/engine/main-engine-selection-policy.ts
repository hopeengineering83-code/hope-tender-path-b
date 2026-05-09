import type { MatchingResult, RequirementDraft } from "./types";

type TrustLookup = Map<string, string | null | undefined>;

type MatchWithSelection = {
  score: number;
  isSelected: boolean;
};

type ExpertMatch = MatchingResult["expertMatches"][number];
type ProjectMatch = MatchingResult["projectMatches"][number];

const MIN_REVIEWED_SAFE_SCORE = 0.55;
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

function selectBestReviewedExperts(matches: ExpertMatch[], expertTrust: TrustLookup, limit: number): ExpertMatch[] {
  if (limit <= 0 || hasSelected(matches)) return matches;
  let selected = 0;
  return matches.map((match) => {
    if (selected < limit && match.score >= MIN_REVIEWED_SAFE_SCORE && reviewed(expertTrust, match.expertId)) {
      selected += 1;
      return { ...match, isSelected: true, rationale: promotedRationale(match.rationale, match.score) };
    }
    return match;
  });
}

function selectBestReviewedProjects(matches: ProjectMatch[], projectTrust: TrustLookup, limit: number): ProjectMatch[] {
  if (limit <= 0 || hasSelected(matches)) return matches;
  let selected = 0;
  return matches.map((match) => {
    if (selected < limit && match.score >= MIN_REVIEWED_SAFE_SCORE && reviewed(projectTrust, match.projectId)) {
      selected += 1;
      return { ...match, isSelected: true, rationale: promotedRationale(match.rationale, match.score) };
    }
    return match;
  });
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
