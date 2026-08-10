import type { MatchingResult, RequirementDraft } from "./types";

type TrustLookup = Map<string, string | null | undefined>;

type MatchWithSelection = {
  score: number;
  isSelected: boolean;
};

type ExpertMatch = MatchingResult["expertMatches"][number];
type ProjectMatch = MatchingResult["projectMatches"][number];

// Aligned with MIN_FLOOR_SCORE in matching.ts (0.55) so the safety-net
// fallback does not reintroduce off-sector authoritative records that the
// tighter relevance gates in buildMatches are designed to exclude.
const MIN_AUTHORITATIVE_SAFE_SCORE = 0.55;
// Below-safe floor used ONLY when the safe floor would produce zero
// selections AND the firm has authoritative records that COULD anchor a
// proposal. Both authenticated human REVIEWED and durable SOURCE_VERIFIED
// evidence are authoritative under the Company Vault runtime contract.
const MIN_AUTHORITATIVE_BEST_AVAILABLE_SCORE = 0.20;
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

/**
 * Runtime-authoritative Company Vault trust levels.
 *
 * SOURCE_VERIFIED is deliberately equal to authenticated REVIEWED for
 * matching/generation authority. The difference is provenance: REVIEWED is a
 * human attestation while SOURCE_VERIFIED is machine promotion backed by owned,
 * byte-verified source evidence. Draft states remain ineligible.
 */
function authoritative(trust: TrustLookup, id: string): boolean {
  const level = trust.get(id);
  return level === "REVIEWED" || level === "SOURCE_VERIFIED";
}

function authorityDescription(trust: TrustLookup, id: string): string {
  return trust.get(id) === "SOURCE_VERIFIED"
    ? "source-verified evidence"
    : "reviewed evidence";
}

function promotedRationale(original: string, score: number, authority: string): string {
  const pct = Math.round(score * 100);
  return `${original} [Main Engine Best-Available Selection] Auto-selected ${authority} at ${pct}% because no safe selected evidence existed for this required class. Below-90 authoritative evidence is allowed when it is the best available grounded match; draft knowledge is never promoted.`;
}

function bestAvailableBelowThresholdRationale(original: string, score: number, authority: string): string {
  const pct = Math.round(score * 100);
  const provenanceSpecificNote = authority === "reviewed evidence"
    ? " Bid team MUST verify this record's relevance before submission."
    : " The selection remains visibly low-confidence, but no separate human promotion step is required because the evidence provenance is already source-verified.";
  return `${original} [BEST-AVAILABLE BELOW THRESHOLD] Auto-selected ${authority} at ${pct}% — every authoritative record scored below the 55% safe floor.${provenanceSpecificNote}`;
}

function selectBestAuthoritativeExperts(matches: ExpertMatch[], expertTrust: TrustLookup, limit: number): ExpertMatch[] {
  if (limit <= 0 || hasSelected(matches)) return matches;

  // First pass: try to promote authoritative evidence at the safe floor (0.55).
  let selected = 0;
  let promoted = matches.map((match) => {
    if (selected < limit && match.score >= MIN_AUTHORITATIVE_SAFE_SCORE && authoritative(expertTrust, match.expertId)) {
      selected += 1;
      return {
        ...match,
        isSelected: true,
        rationale: promotedRationale(match.rationale, match.score, authorityDescription(expertTrust, match.expertId)),
      };
    }
    return match;
  });
  if (selected > 0) return promoted;

  // Second pass: no authoritative record cleared the safe floor. Preserve the
  // historical best-available behavior, but apply it consistently to both
  // REVIEWED and SOURCE_VERIFIED records. Drafts remain excluded.
  selected = 0;
  promoted = matches.map((match) => {
    if (selected < limit && match.score >= MIN_AUTHORITATIVE_BEST_AVAILABLE_SCORE && authoritative(expertTrust, match.expertId)) {
      selected += 1;
      return {
        ...match,
        isSelected: true,
        rationale: bestAvailableBelowThresholdRationale(match.rationale, match.score, authorityDescription(expertTrust, match.expertId)),
      };
    }
    return match;
  });
  return promoted;
}

function selectBestAuthoritativeProjects(matches: ProjectMatch[], projectTrust: TrustLookup, limit: number): ProjectMatch[] {
  if (limit <= 0 || hasSelected(matches)) return matches;

  let selected = 0;
  let promoted = matches.map((match) => {
    if (selected < limit && match.score >= MIN_AUTHORITATIVE_SAFE_SCORE && authoritative(projectTrust, match.projectId)) {
      selected += 1;
      return {
        ...match,
        isSelected: true,
        rationale: promotedRationale(match.rationale, match.score, authorityDescription(projectTrust, match.projectId)),
      };
    }
    return match;
  });
  if (selected > 0) return promoted;

  selected = 0;
  promoted = matches.map((match) => {
    if (selected < limit && match.score >= MIN_AUTHORITATIVE_BEST_AVAILABLE_SCORE && authoritative(projectTrust, match.projectId)) {
      selected += 1;
      return {
        ...match,
        isSelected: true,
        rationale: bestAvailableBelowThresholdRationale(match.rationale, match.score, authorityDescription(projectTrust, match.projectId)),
      };
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
    expertMatches: selectBestAuthoritativeExperts(params.matching.expertMatches, params.expertTrust, expertLimit),
    projectMatches: selectBestAuthoritativeProjects(params.matching.projectMatches, params.projectTrust, projectLimit),
  };
}