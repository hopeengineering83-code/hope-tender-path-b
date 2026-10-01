import { canUseVaultRecord, type ReviewRecordState } from "./vault-review-provenance";

export type MatchingQualitySeverity = "GOOD" | "WARNING" | "POOR";

/**
 * Structural state of matching for a tender. Historical enum member names are
 * retained for API compatibility, but "reviewed" in those names now means
 * runtime-authoritative Company Vault evidence: either authenticated REVIEWED
 * or durable SOURCE_VERIFIED provenance.
 */
export type MatchingState =
  | "NO_VAULT"
  | "VAULT_AWAITS_ENGINE"
  | "MATCHES_WEAK"
  | "MATCHES_REVIEWED"
  | "MATCHING_NOT_REQUIRED";

export type MatchLike = {
  id?: string;
  score?: number | null;
  isSelected?: boolean | null;
  expert?: (ReviewRecordState & { fullName?: string | null }) | null;
  project?: (ReviewRecordState & { name?: string | null }) | null;
};

// GENERATION accepts either a durably human-REVIEWED record or a durably
// machine-SOURCE_VERIFIED one (see canUseVaultRecord). All user-facing
// messages below therefore say authoritative/source-backed rather than
// implying that a person must review records before matching can proceed.
function isUsableForGeneration(record: (ReviewRecordState & Record<string, unknown>) | null | undefined): boolean {
  if (!record) return false;
  return canUseVaultRecord(record, "GENERATION");
}

export type RequirementLikeForMatching = {
  requirementType?: string | null;
};

export type MatchingQualityReport = {
  severity: MatchingQualitySeverity;
  score: number;
  state: MatchingState;
  expertRequirementExists: boolean;
  projectRequirementExists: boolean;
  expertMatches: number;
  projectMatches: number;
  /** Backward-compatible field names: counts runtime-authoritative matches. */
  reviewedExpertMatches: number;
  reviewedProjectMatches: number;
  selectedExperts: number;
  selectedProjects: number;
  reviewedSelectedExperts: number;
  reviewedSelectedProjects: number;
  highConfidenceExpertMatches: number;
  highConfidenceProjectMatches: number;
  /** Backward-compatible field names: counts runtime-authoritative Vault records. */
  vaultReviewedExperts: number;
  vaultReviewedProjects: number;
  warnings: string[];
  recommendations: string[];
};

function hasNumericScore(value: number | null | undefined): boolean {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function numericScore(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n / 100 : n;
}

export function assessMatchingQuality(params: {
  requirements: RequirementLikeForMatching[];
  expertMatches: MatchLike[];
  projectMatches: MatchLike[];
  /** Historical parameter names; values are authoritative Vault counts. */
  vaultReviewedExperts?: number | null;
  vaultReviewedProjects?: number | null;
}): MatchingQualityReport {
  const expertRequirementExists = params.requirements.some((req) => req.requirementType === "EXPERT");
  const projectRequirementExists = params.requirements.some((req) => req.requirementType === "PROJECT_EXPERIENCE");
  const selectedExperts = params.expertMatches.filter((match) => Boolean(match.isSelected));
  const selectedProjects = params.projectMatches.filter((match) => Boolean(match.isSelected));
  const reviewedExpertMatches = params.expertMatches.filter((match) => isUsableForGeneration(match.expert));
  const reviewedProjectMatches = params.projectMatches.filter((match) => isUsableForGeneration(match.project));
  const reviewedSelectedExperts = selectedExperts.filter((match) => isUsableForGeneration(match.expert));
  const reviewedSelectedProjects = selectedProjects.filter((match) => isUsableForGeneration(match.project));
  const scoredExpertMatches = params.expertMatches.filter((match) => hasNumericScore(match.score));
  const scoredProjectMatches = params.projectMatches.filter((match) => hasNumericScore(match.score));
  const highConfidenceExpertMatches = scoredExpertMatches.filter((match) => numericScore(match.score) >= 0.7).length;
  const highConfidenceProjectMatches = scoredProjectMatches.filter((match) => numericScore(match.score) >= 0.7).length;
  const vaultReviewedExperts = Math.max(0, params.vaultReviewedExperts ?? 0);
  const vaultReviewedProjects = Math.max(0, params.vaultReviewedProjects ?? 0);

  const warnings: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  // Distinguish "Engine has not created tender-specific rows yet" from "the
  // Vault has no authoritative evidence". SOURCE_VERIFIED and REVIEWED are
  // equal inputs here, so neither state requires a promotion/approval click.
  if (expertRequirementExists && params.expertMatches.length === 0) {
    if (vaultReviewedExperts > 0) {
      warnings.push(`Tender requires experts but no expert matches exist yet — ${vaultReviewedExperts} verified/source-backed Vault expert(s) await Run Engine.`);
      recommendations.push("Run Engine to create tender-specific expert matches automatically from the Company Vault.");
      score -= 18;
    } else {
      warnings.push("Tender requires experts but no verified/source-backed Vault expert is currently available.");
      recommendations.push("Upload the missing expert CV source evidence; ingestion, source verification, and matching then run automatically.");
      score -= 35;
    }
  }
  if (projectRequirementExists && params.projectMatches.length === 0) {
    if (vaultReviewedProjects > 0) {
      warnings.push(`Tender requires project references but no project matches exist yet — ${vaultReviewedProjects} verified/source-backed Vault project(s) await Run Engine.`);
      recommendations.push("Run Engine to create tender-specific project matches automatically from the Company Vault.");
      score -= 18;
    } else {
      warnings.push("Tender requires project references but no verified/source-backed Vault project is currently available.");
      recommendations.push("Upload the missing project-reference source evidence; ingestion, source verification, and matching then run automatically.");
      score -= 35;
    }
  }

  if (expertRequirementExists && params.expertMatches.length > 0 && selectedExperts.length === 0 && reviewedExpertMatches.length === 0) {
    warnings.push("Tender requires experts but none of the current expert matches has authoritative source-backed provenance.");
    recommendations.push("Add genuine owned CV source evidence for the missing discipline; automatic verification will make provable records eligible.");
    score -= 20;
  } else if (expertRequirementExists && selectedExperts.length === 0 && reviewedExpertMatches.length > 0) {
    warnings.push("Authoritative expert matches exist but none is selected yet; the Engine can apply the best available grounded selection automatically.");
    recommendations.push("Run or retry Engine; no separate Company Vault approval or promotion step is required.");
    score -= 5;
  }
  if (projectRequirementExists && params.projectMatches.length > 0 && selectedProjects.length === 0 && reviewedProjectMatches.length === 0) {
    warnings.push("Tender requires project references but none of the current project matches has authoritative source-backed provenance.");
    recommendations.push("Add genuine owned project-reference source evidence; automatic verification will make provable records eligible.");
    score -= 20;
  } else if (projectRequirementExists && selectedProjects.length === 0 && reviewedProjectMatches.length > 0) {
    warnings.push("Authoritative project matches exist but none is selected yet; the Engine can apply the best available grounded selection automatically.");
    recommendations.push("Run or retry Engine; no separate Company Vault approval or promotion step is required.");
    score -= 5;
  }
  if (selectedExperts.length > 0 && reviewedSelectedExperts.length === 0) {
    warnings.push("Selected expert matches do not have durable authoritative provenance.");
    recommendations.push("Replace the unsupported selection with source-backed expert evidence before generation.");
    score -= 25;
  }
  if (selectedProjects.length > 0 && reviewedSelectedProjects.length === 0) {
    warnings.push("Selected project matches do not have durable authoritative provenance.");
    recommendations.push("Replace the unsupported selection with source-backed project evidence before generation.");
    score -= 25;
  }
  if (expertRequirementExists && scoredExpertMatches.length > 0 && highConfidenceExpertMatches === 0) {
    warnings.push("Expert matches exist, but none are high-confidence (≥70%).");
    recommendations.push("Check the extracted discipline/role requirements or add stronger source-backed CV evidence.");
    score -= 15;
  }
  if (projectRequirementExists && scoredProjectMatches.length > 0 && highConfidenceProjectMatches === 0) {
    warnings.push("Project matches exist, but none are high-confidence (≥70%).");
    recommendations.push("Check the extracted sector/scope requirements or add stronger source-backed project evidence.");
    score -= 15;
  }

  score = Math.max(0, Math.min(100, score));
  const severity: MatchingQualitySeverity = score < 50 ? "POOR" : score < 75 ? "WARNING" : "GOOD";
  if (severity === "GOOD" && warnings.length === 0) recommendations.push("Matching appears usable for proposal generation.");

  const needsExperts = expertRequirementExists;
  const needsProjects = projectRequirementExists;
  const hasMatches = params.expertMatches.length > 0 || params.projectMatches.length > 0;
  const hasReviewed = reviewedExpertMatches.length > 0 || reviewedProjectMatches.length > 0;
  const hasVault = vaultReviewedExperts > 0 || vaultReviewedProjects > 0;
  let state: MatchingState;
  if (!needsExperts && !needsProjects) {
    state = "MATCHING_NOT_REQUIRED";
  } else if (hasMatches && hasReviewed) {
    state = "MATCHES_REVIEWED";
  } else if (hasMatches && !hasReviewed) {
    state = "MATCHES_WEAK";
  } else if (hasVault) {
    state = "VAULT_AWAITS_ENGINE";
  } else {
    state = "NO_VAULT";
  }

  return {
    severity,
    score,
    state,
    expertRequirementExists,
    projectRequirementExists,
    expertMatches: params.expertMatches.length,
    projectMatches: params.projectMatches.length,
    reviewedExpertMatches: reviewedExpertMatches.length,
    reviewedProjectMatches: reviewedProjectMatches.length,
    selectedExperts: selectedExperts.length,
    selectedProjects: selectedProjects.length,
    reviewedSelectedExperts: reviewedSelectedExperts.length,
    reviewedSelectedProjects: reviewedSelectedProjects.length,
    highConfidenceExpertMatches,
    highConfidenceProjectMatches,
    vaultReviewedExperts,
    vaultReviewedProjects,
    warnings,
    recommendations,
  };
}