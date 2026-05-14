export type MatchingQualitySeverity = "GOOD" | "WARNING" | "POOR";

export type MatchLike = {
  id?: string;
  score?: number | null;
  isSelected?: boolean | null;
  expert?: { trustLevel?: string | null; fullName?: string | null } | null;
  project?: { trustLevel?: string | null; name?: string | null } | null;
};

export type RequirementLikeForMatching = {
  requirementType?: string | null;
};

export type MatchingQualityReport = {
  severity: MatchingQualitySeverity;
  score: number;
  expertRequirementExists: boolean;
  projectRequirementExists: boolean;
  expertMatches: number;
  projectMatches: number;
  selectedExperts: number;
  selectedProjects: number;
  reviewedSelectedExperts: number;
  reviewedSelectedProjects: number;
  highConfidenceExpertMatches: number;
  highConfidenceProjectMatches: number;
  warnings: string[];
  recommendations: string[];
};

function numericScore(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : n;
}

export function assessMatchingQuality(params: {
  requirements: RequirementLikeForMatching[];
  expertMatches: MatchLike[];
  projectMatches: MatchLike[];
}): MatchingQualityReport {
  const expertRequirementExists = params.requirements.some((req) => req.requirementType === "EXPERT");
  const projectRequirementExists = params.requirements.some((req) => req.requirementType === "PROJECT_EXPERIENCE");
  const selectedExperts = params.expertMatches.filter((match) => Boolean(match.isSelected));
  const selectedProjects = params.projectMatches.filter((match) => Boolean(match.isSelected));
  const reviewedSelectedExperts = selectedExperts.filter((match) => match.expert?.trustLevel === "REVIEWED");
  const reviewedSelectedProjects = selectedProjects.filter((match) => match.project?.trustLevel === "REVIEWED");
  const highConfidenceExpertMatches = params.expertMatches.filter((match) => numericScore(match.score) >= 0.7).length;
  const highConfidenceProjectMatches = params.projectMatches.filter((match) => numericScore(match.score) >= 0.7).length;

  const warnings: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  if (expertRequirementExists && params.expertMatches.length === 0) {
    warnings.push("Tender requires experts but no expert matches exist.");
    recommendations.push("Run the engine after reviewing/importing expert CVs.");
    score -= 35;
  }
  if (projectRequirementExists && params.projectMatches.length === 0) {
    warnings.push("Tender requires project references but no project matches exist.");
    recommendations.push("Run the engine after reviewing/importing project references.");
    score -= 35;
  }
  if (expertRequirementExists && selectedExperts.length === 0) {
    warnings.push("Tender requires experts but no expert match is selected.");
    recommendations.push("Select reviewed expert matches or let generation auto-promote reviewed matches when available.");
    score -= 20;
  }
  if (projectRequirementExists && selectedProjects.length === 0) {
    warnings.push("Tender requires project references but no project match is selected.");
    recommendations.push("Select reviewed project matches or let generation auto-promote reviewed matches when available.");
    score -= 20;
  }
  if (selectedExperts.length > 0 && reviewedSelectedExperts.length === 0) {
    warnings.push("Selected expert matches are not reviewed.");
    recommendations.push("Review selected experts before generation to prevent draft/unverified CV evidence from entering proposals.");
    score -= 25;
  }
  if (selectedProjects.length > 0 && reviewedSelectedProjects.length === 0) {
    warnings.push("Selected project matches are not reviewed.");
    recommendations.push("Review selected projects before generation to prevent draft/unverified project evidence from entering proposals.");
    score -= 25;
  }
  if (expertRequirementExists && highConfidenceExpertMatches === 0 && params.expertMatches.length > 0) {
    warnings.push("Expert matches exist, but none are high-confidence (≥70%).");
    recommendations.push("Check whether tender discipline/role requirements were extracted correctly or import stronger CV evidence.");
    score -= 15;
  }
  if (projectRequirementExists && highConfidenceProjectMatches === 0 && params.projectMatches.length > 0) {
    warnings.push("Project matches exist, but none are high-confidence (≥70%).");
    recommendations.push("Check whether tender sector/scope requirements were extracted correctly or import stronger project evidence.");
    score -= 15;
  }

  score = Math.max(0, Math.min(100, score));
  const severity: MatchingQualitySeverity = score < 50 ? "POOR" : score < 75 ? "WARNING" : "GOOD";
  if (severity === "GOOD" && warnings.length === 0) recommendations.push("Matching appears usable for proposal generation.");

  return {
    severity,
    score,
    expertRequirementExists,
    projectRequirementExists,
    expertMatches: params.expertMatches.length,
    projectMatches: params.projectMatches.length,
    selectedExperts: selectedExperts.length,
    selectedProjects: selectedProjects.length,
    reviewedSelectedExperts: reviewedSelectedExperts.length,
    reviewedSelectedProjects: reviewedSelectedProjects.length,
    highConfidenceExpertMatches,
    highConfidenceProjectMatches,
    warnings,
    recommendations,
  };
}
