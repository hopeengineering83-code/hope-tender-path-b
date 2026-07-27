import { canUseVaultRecord, type ReviewRecordState } from "./vault-review-provenance";

export type MatchingQualitySeverity = "GOOD" | "WARNING" | "POOR";

/**
 * Structural state of matching for a tender — distinguishes the four
 * cases called out in the Gap 5 spec so the UI can render the right
 * message instead of always showing "0/100 POOR":
 *
 *   NO_VAULT              — no vault evidence exists (company hasn't
 *                           imported experts/projects yet)
 *   VAULT_AWAITS_ENGINE   — vault has reviewed evidence but Run Engine
 *                           hasn't been triggered yet for this tender
 *   MATCHES_WEAK          — matches exist but scores/coverage are weak
 *                           (engine ran, but knowledge didn't cover the
 *                           tender's domain)
 *   MATCHES_REVIEWED      — at least one reviewed match is available
 *                           and selectable/auto-promotable
 *   MATCHING_NOT_REQUIRED — tender has no EXPERT/PROJECT_EXPERIENCE
 *                           requirements (e.g. supply/goods tender)
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
// machine-SOURCE_VERIFIED one (see canUseVaultRecord) — a naive
// trustLevel === "REVIEWED" check here would silently treat legitimately
// usable, machine-verified vault evidence as "not reviewed" and could
// report a false POOR/blocked matching-quality score even though the
// Engine and generate-elite.ts would both accept the same record.
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
  /** Gap 5 fix — structural state (see MatchingState doc). */
  state: MatchingState;
  expertRequirementExists: boolean;
  projectRequirementExists: boolean;
  expertMatches: number;
  projectMatches: number;
  reviewedExpertMatches: number;
  reviewedProjectMatches: number;
  selectedExperts: number;
  selectedProjects: number;
  reviewedSelectedExperts: number;
  reviewedSelectedProjects: number;
  highConfidenceExpertMatches: number;
  highConfidenceProjectMatches: number;
  /** Gap 5 fix — vault counts so the UI can show "engine will use N vault experts". */
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
  /** Gap 5 fix — pass vault counts so we can distinguish "engine not run yet" from "no evidence at all". */
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

  // ─── Gap 5 fix — soften the score when engine hasn't run yet ────────
  // The previous logic flat-deducted 35 + 35 = 70 points whenever both
  // expertMatches and projectMatches were 0, forcing the score to 0/100
  // even when the company vault had reviewed experts/projects ready to
  // be picked up by the next Run Engine click. Now: if vault has
  // reviewed evidence, the missing-matches warning is softer (−18
  // instead of −35) because the situation is "pending engine run", not
  // "matching is broken". Once engine runs and the row count is still
  // 0 (or scored 0), the harder penalties below kick in.
  if (expertRequirementExists && params.expertMatches.length === 0) {
    if (vaultReviewedExperts > 0) {
      warnings.push(`Tender requires experts but no expert matches exist yet — ${vaultReviewedExperts} reviewed vault expert(s) await engine run.`);
      recommendations.push("Click Run Engine to create tender-specific expert match rows from the vault.");
      score -= 18;
    } else {
      warnings.push("Tender requires experts but no expert matches exist and no reviewed vault experts are available.");
      recommendations.push("Run the engine after reviewing/importing expert CVs.");
      score -= 35;
    }
  }
  if (projectRequirementExists && params.projectMatches.length === 0) {
    if (vaultReviewedProjects > 0) {
      warnings.push(`Tender requires project references but no project matches exist yet — ${vaultReviewedProjects} reviewed vault project(s) await engine run.`);
      recommendations.push("Click Run Engine to create tender-specific project match rows from the vault.");
      score -= 18;
    } else {
      warnings.push("Tender requires project references but no project matches exist and no reviewed vault projects are available.");
      recommendations.push("Run the engine after reviewing/importing project references.");
      score -= 35;
    }
  }
  // The "no reviewed match" branch only applies when matches EXIST at
  // all — otherwise the previous "no matches yet" check already
  // penalised the score (or correctly softened it for vault fallback).
  // Double-counting here used to floor the score to 0/100 even when
  // vault was ready, defeating the Gap 5 fix.
  if (expertRequirementExists && params.expertMatches.length > 0 && selectedExperts.length === 0 && reviewedExpertMatches.length === 0) {
    warnings.push("Tender requires experts but no reviewed expert match is selected or available for auto-promotion.");
    recommendations.push("Review/import expert CV evidence, then run matching again.");
    score -= 20;
  } else if (expertRequirementExists && selectedExperts.length === 0 && reviewedExpertMatches.length > 0) {
    warnings.push("No expert match is manually selected, but reviewed expert matches are available for generation auto-promotion.");
    recommendations.push("Review matches manually for best quality, or allow generation to auto-promote reviewed matches.");
    score -= 5;
  }
  if (projectRequirementExists && params.projectMatches.length > 0 && selectedProjects.length === 0 && reviewedProjectMatches.length === 0) {
    warnings.push("Tender requires project references but no reviewed project match is selected or available for auto-promotion.");
    recommendations.push("Review/import project evidence, then run matching again.");
    score -= 20;
  } else if (projectRequirementExists && selectedProjects.length === 0 && reviewedProjectMatches.length > 0) {
    warnings.push("No project match is manually selected, but reviewed project matches are available for generation auto-promotion.");
    recommendations.push("Review matches manually for best quality, or allow generation to auto-promote reviewed matches.");
    score -= 5;
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
  if (expertRequirementExists && scoredExpertMatches.length > 0 && highConfidenceExpertMatches === 0) {
    warnings.push("Expert matches exist, but none are high-confidence (≥70%).");
    recommendations.push("Check whether tender discipline/role requirements were extracted correctly or import stronger CV evidence.");
    score -= 15;
  }
  if (projectRequirementExists && scoredProjectMatches.length > 0 && highConfidenceProjectMatches === 0) {
    warnings.push("Project matches exist, but none are high-confidence (≥70%).");
    recommendations.push("Check whether tender sector/scope requirements were extracted correctly or import stronger project evidence.");
    score -= 15;
  }

  score = Math.max(0, Math.min(100, score));
  const severity: MatchingQualitySeverity = score < 50 ? "POOR" : score < 75 ? "WARNING" : "GOOD";
  if (severity === "GOOD" && warnings.length === 0) recommendations.push("Matching appears usable for proposal generation.");

  // ─── Derive structural state ──────────────────────────────────────
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
