/**
 * Unmatched requirement diagnostics for AI evidence-matching failures.
 *
 * A tender paragraph proves what the buyer requires. It never proves that Hope
 * satisfies the requirement. These compatibility-shaped rows are diagnostics
 * only and MUST NOT be merged into ComplianceResult.matrices or persisted as
 * ComplianceMatrix evidence.
 */

import type { ComplianceResult } from "./types";

/**
 * Compatibility type retained for callers while the engine diagnostic model is
 * migrated. None of these values represent Company Vault evidence.
 */
export type FallbackComplianceRow = {
  requirementId: string;
  requirementTitle: string;
  supportStatus: "REVIEW_REQUIRED" | "PARTIAL";
  supportStrength: number;
  evidenceSummary: string;
  evidenceType: string;
  evidenceSource: string;
  evidenceReference: string | undefined;
  notes: string | undefined;
};

export type DeterministicFallbackResult = {
  rows: FallbackComplianceRow[];
  blockerCode: "EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED" | null;
  blockerMessage: string | null;
};

type SourceGroundedRequirement = {
  id: string;
  title: string;
  description: string;
  requirementType: string;
  priority: string;
  sourceTenderFileId: string | null;
  sourcePageNumber: number | null;
  sourceExactQuote: string | null;
  sourceConfidence: number;
};

/**
 * Build non-evidentiary diagnostics for source-grounded requirements when AI
 * evidence matching fails. The diagnostic identifies the unmatched buyer
 * requirement and recovery action. It does not assert company support.
 */
export function buildDeterministicFallbackRows(
  requirements: SourceGroundedRequirement[],
): DeterministicFallbackResult {
  const rows: FallbackComplianceRow[] = [];
  let sourceGroundedCount = 0;

  for (const req of requirements) {
    const hasTraceableSource = Boolean(
      req.sourceTenderFileId &&
      req.sourcePageNumber != null &&
      req.sourceExactQuote &&
      req.sourceExactQuote.trim().length > 0 &&
      req.sourceConfidence > 0,
    );
    if (!hasTraceableSource) continue;

    sourceGroundedCount++;
    const isMandatory = req.priority === "MANDATORY" || req.priority === "CRITICAL";
    const supportStatus: FallbackComplianceRow["supportStatus"] = isMandatory
      ? "REVIEW_REQUIRED"
      : "PARTIAL";
    const supportStrength = isMandatory ? 0.3 : 0.4;

    rows.push({
      requirementId: req.id,
      requirementTitle: req.title,
      supportStatus,
      supportStrength,
      evidenceSummary: `Unmatched buyer requirement on page ${req.sourcePageNumber}. No Company Vault evidence was created because AI evidence matching did not complete.`,
      evidenceType: "UNMATCHED_REQUIREMENT_DIAGNOSTIC",
      evidenceSource: "NO_COMPANY_VAULT_EVIDENCE",
      evidenceReference: undefined,
      notes: `EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED: Link a verified Company Vault record before this requirement can count as covered; generation remains blocked until evidence is manually confirmed.`,
    });
  }

  if (sourceGroundedCount === 0) {
    return { rows: [], blockerCode: null, blockerMessage: null };
  }

  return {
    rows,
    blockerCode: "EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED",
    blockerMessage: `AI evidence matching failed for ${sourceGroundedCount} source-grounded requirement(s). No Company Vault evidence was created. Review matching inputs and link verified Vault evidence before generation.`,
  };
}

/**
 * SECURITY BOUNDARY: tender-source diagnostics must never become compliance
 * evidence. Keep the existing result unchanged. The caller may use the returned
 * diagnostic rows only to surface blockers and recovery guidance.
 *
 * The function name is retained temporarily to avoid a broad runtime refactor;
 * its fail-closed no-op behavior is intentional and regression-tested.
 */
export function mergeFallbackRows(
  existing: ComplianceResult,
  fallbackRows: FallbackComplianceRow[],
): ComplianceResult {
  void fallbackRows;
  return existing;
}
