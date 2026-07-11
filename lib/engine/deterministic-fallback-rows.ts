/**
 * Deterministic fallback compliance rows.
 *
 * When AI matching/rematch fails after the requirement source extractor has
 * matched requirements to source paragraphs, the engine must NOT silently
 * leave 0 compliance rows. This module creates deterministic REVIEW_REQUIRED /
 * PARTIAL compliance rows for every source-grounded requirement so the user
 * sees a reviewable evidence state instead of a misleading empty matrix.
 *
 * KEY RULES (enforced by the type signatures and the builder):
 *   - These rows are NEVER FULL/SUBSTANTIAL — they are REVIEW_REQUIRED or PARTIAL.
 *   - They are only created when the requirement has traceable source support
 *     (sourceTenderFileId + sourcePageNumber + sourceExactQuote).
 *   - They surface a clear blocker: EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED.
 *   - They do NOT mark anything as confirmed without traceable source.
 *   - Generation remains blocked until evidence is confirmed.
 */

import type { ComplianceResult } from "./types";

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
 * Build deterministic REVIEW_REQUIRED compliance rows for requirements that
 * have traceable source support. Called when AI matching failed but the
 * requirement source extractor succeeded.
 *
 * These rows:
 *   - Are NEVER FULL/SUBSTANTIAL (supportStatus is REVIEW_REQUIRED or PARTIAL)
 *   - Are only created for requirements with sourceTenderFileId + sourcePageNumber
 *   - Surface the EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED blocker
 *   - Do NOT mark anything as confirmed
 */
export function buildDeterministicFallbackRows(
  requirements: SourceGroundedRequirement[],
): DeterministicFallbackResult {
  const rows: FallbackComplianceRow[] = [];
  let sourceGroundedCount = 0;

  for (const req of requirements) {
    // Only create a fallback row when the requirement has traceable source
    // support — sourceTenderFileId + sourcePageNumber + a non-empty quote.
    const hasTraceableSource = Boolean(
      req.sourceTenderFileId &&
      req.sourcePageNumber != null &&
      req.sourceExactQuote &&
      req.sourceExactQuote.trim().length > 0 &&
      req.sourceConfidence > 0,
    );
    if (!hasTraceableSource) continue;

    sourceGroundedCount++;

    // The support status is REVIEW_REQUIRED for mandatory/critical requirements
    // (they need human confirmation before generation) and PARTIAL for others.
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
      evidenceSummary: `Source paragraph extracted (page ${req.sourcePageNumber}) but AI matching failed. Manual evidence review required before this requirement can be marked as covered.`,
      evidenceType: "REVIEW_REQUIRED_FALLBACK",
      evidenceSource: "Source-grounded fallback (AI matching failed)",
      evidenceReference: `Source page ${req.sourcePageNumber}`,
      notes: `EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED: Requirement has traceable source support (page ${req.sourcePageNumber}) but AI evidence matching did not complete. Review and confirm evidence manually before generation.`,
    });
  }

  // Only surface the blocker when at least one source-grounded requirement
  // got a fallback row. If no requirements had source support, the blocker
  // is not EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED — it's a different
  // problem (source extraction itself failed or no requirements exist).
  if (sourceGroundedCount === 0) {
    return { rows: [], blockerCode: null, blockerMessage: null };
  }

  return {
    rows,
    blockerCode: "EVIDENCE_MATCHING_AI_FAILED_REVIEW_REQUIRED",
    blockerMessage: `AI evidence matching failed, but ${sourceGroundedCount} requirement(s) have traceable source support. Review-required fallback rows created — generation remains blocked until evidence is manually confirmed.`,
  };
}

/**
 * Merge deterministic fallback rows into an existing compliance result.
 * If the existing result already has rows (e.g. from deterministic matching),
 * the fallback rows are only added for requirements that have NO existing row.
 * This prevents duplicates while ensuring no source-grounded requirement is
 * left without a compliance row.
 */
export function mergeFallbackRows(
  existing: ComplianceResult,
  fallbackRows: FallbackComplianceRow[],
): ComplianceResult {
  if (fallbackRows.length === 0) return existing;
  const existingRequirementIds = new Set(existing.matrices.map((m) => m.requirementId));
  const newRows = fallbackRows
    .filter((r) => !existingRequirementIds.has(r.requirementId))
    .map((r) => ({
      requirementTitle: r.requirementTitle,
      requirementId: r.requirementId,
      supportStatus: r.supportStatus,
      supportStrength: r.supportStrength,
      evidenceSummary: r.evidenceSummary,
      evidenceType: r.evidenceType,
      evidenceSource: r.evidenceSource,
      evidenceReference: r.evidenceReference,
      notes: r.notes,
    }));
  if (newRows.length === 0) return existing;
  return {
    matrices: [...existing.matrices, ...newRows],
    gaps: existing.gaps,
  };
}
