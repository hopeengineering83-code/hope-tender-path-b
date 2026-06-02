// Weighted multi-gate readiness scoring with HARD CAPS.
//
// Replaces the implicit "score" arithmetic that previously let the
// dashboard display 100% readiness while:
//   - evidence coverage was 0%
//   - 13 required documents were missing
//   - analysis came from the regex fallback
//   - tender metadata auto-fill coverage was 5/16
//
// The fix is two-layered:
//   1. A weighted sum across 12 dimensions produces a baseline score.
//   2. A series of HARD CAPS clamps the final score whenever any
//      single dimension is critically broken. Hard caps cannot be
//      exceeded by strong scores in other dimensions — they exist
//      precisely so a "100/100" cannot be displayed while a critical
//      gate is failing.
//
// Spec-mandated caps:
//   - evidence coverage == 0          -> final ≤ 35
//   - required documents incomplete   -> final ≤ 50
//   - analysis source is regex fallback (and not human-approved)
//                                     -> final ≤ 45
//   - critical metadata missing       -> final ≤ 60
//   - generated document quality poor -> final ≤ 60
//   - final export gate failing       -> final ≤ 99 (never exactly 100)
//
// This module is pure and easy to unit-test. The DB-aware
// composeTenderReadinessScore() loader wraps it with a Prisma fetch.

export type ReadinessScoreSeverity = "READY" | "PARTIAL" | "BLOCKED";

export type ReadinessScoreDimension =
  | "analysisQuality"
  | "analysisSource"
  | "metadataCompleteness"
  | "sourceReferenceCoverage"
  | "evidenceCoverage"
  | "matchingQuality"
  | "complianceMatrix"
  | "submissionPlanCompleteness"
  | "requiredDocumentCompleteness"
  | "generatedDocumentQuality"
  | "validationReview"
  | "finalExportGate";

export type DimensionScore = {
  dimension: ReadinessScoreDimension;
  /** 0–100. */
  score: number;
  /** Why the score landed where it did — surfaced in the readiness panel. */
  notes: string[];
};

export type ReadinessScoreCap = {
  dimension: ReadinessScoreDimension | "compound";
  capScore: number;
  reason: string;
};

export type ReadinessScoreResult = {
  /** Final clamped 0–100 score. */
  score: number;
  /** Pre-cap weighted score for diagnostics. */
  rawScore: number;
  severity: ReadinessScoreSeverity;
  dimensions: DimensionScore[];
  applicableCaps: ReadinessScoreCap[];
  appliedCap: ReadinessScoreCap | null;
};

export type ReadinessScoreInput = {
  // Tender analysis
  analysisScore?: number | null;
  analysisSeverity?: "GOOD" | "WARNING" | "POOR" | null;
  /** Did the analysis come from an AI provider or from the regex fallback? */
  analysisSource?: "AI" | "REGEX_FALLBACK_AI_ERROR" | "HUMAN_APPROVED_REGEX_FALLBACK" | "UNKNOWN" | null;

  // Metadata
  /** 0..1 fraction of critical metadata fields populated. */
  metadataCompletenessRatio?: number | null;
  /** Count of metadata fields that failed validation (e.g. "Bid-Team to confirm"). */
  metadataInvalidCount?: number | null;

  // Source / evidence
  /** 0..1 fraction of requirements with a source reference. */
  sourceReferenceCoverage?: number | null;
  /** 0..1 fraction of MANDATORY requirements with at least PARTIAL evidence. */
  evidenceCoverage?: number | null;
  /** Were any reviewed experts/projects selected (not REGEX_DRAFT)? */
  reviewedSelectionsPresent?: boolean | null;

  // Matching
  matchingScore?: number | null;

  // Compliance matrix
  /** 0..1 fraction of requirements with a compliance matrix row. */
  complianceMatrixCoverage?: number | null;

  // Submission plan / generated docs
  /** Count of distinct required submission-plan items. */
  requiredDocumentsTotal?: number | null;
  /** Count of required items that have a current generated document or attached original. */
  requiredDocumentsSatisfied?: number | null;
  /** Count of generated docs that are outside the submission plan. */
  outsidePlanDocuments?: number | null;
  /** Count of generated docs that failed the quality gate. */
  qualityFailedDocuments?: number | null;

  // Validation / review
  /** Count of final-export-candidate docs in VALIDATED+READY_FOR_EXPORT state. */
  readyForExportCount?: number | null;
  /** Count of final-export-candidate docs total. */
  finalExportCandidatesCount?: number | null;

  // Final gate
  finalExportGateOk?: boolean | null;
};

const DIMENSION_WEIGHTS: Record<ReadinessScoreDimension, number> = {
  analysisQuality: 8,
  analysisSource: 6,
  metadataCompleteness: 8,
  sourceReferenceCoverage: 6,
  evidenceCoverage: 12,
  matchingQuality: 8,
  complianceMatrix: 6,
  submissionPlanCompleteness: 8,
  requiredDocumentCompleteness: 12,
  generatedDocumentQuality: 12,
  validationReview: 8,
  finalExportGate: 6,
};

function clamp(value: number, min = 0, max = 100): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function ratioToScore(ratio?: number | null): number {
  if (typeof ratio !== "number" || Number.isNaN(ratio)) return 0;
  return clamp(Math.round(ratio * 100));
}

function analysisSeverityScore(severity?: ReadinessScoreInput["analysisSeverity"], rawScore?: number | null): number {
  if (typeof rawScore === "number") return clamp(rawScore);
  if (severity === "GOOD") return 90;
  if (severity === "WARNING") return 65;
  if (severity === "POOR") return 25;
  return 50;
}

function analysisSourceScore(source?: ReadinessScoreInput["analysisSource"]): { score: number; notes: string[] } {
  switch (source) {
    case "AI":
      return { score: 100, notes: [] };
    case "HUMAN_APPROVED_REGEX_FALLBACK":
      return { score: 60, notes: ["Analysis came from regex fallback but was human-approved. Final generation allowed with senior review."] };
    case "REGEX_FALLBACK_AI_ERROR":
      return { score: 15, notes: ["Analysis came from the regex fallback after all AI providers failed. Re-run AI analysis before final generation."] };
    case "UNKNOWN":
    case null:
    case undefined:
    default:
      return { score: 50, notes: ["Analysis source unknown — treat as low confidence until re-run."] };
  }
}

function evidenceCoverageScore(ratio?: number | null, reviewedSelectionsPresent?: boolean | null): { score: number; notes: string[] } {
  const notes: string[] = [];
  const fraction = typeof ratio === "number" ? ratio : 0;
  if (fraction <= 0) notes.push("Evidence coverage is 0% — no MANDATORY requirements are mapped to reviewed evidence.");
  if (reviewedSelectionsPresent === false) notes.push("No reviewed experts/projects are selected — vault selections are draft-only.");
  return { score: ratioToScore(ratio), notes };
}

function metadataCompletenessScore(ratio?: number | null, invalidCount?: number | null): { score: number; notes: string[] } {
  const notes: string[] = [];
  const score = ratioToScore(ratio);
  if (typeof ratio === "number" && ratio < 0.6) {
    notes.push(`Tender metadata auto-fill coverage is ${Math.round((ratio ?? 0) * 100)}%. Critical fields must be filled before final generation.`);
  }
  if ((invalidCount ?? 0) > 0) {
    notes.push(`${invalidCount} metadata field(s) failed validation (e.g. "Bid-Team to confirm" placeholder).`);
  }
  return { score, notes };
}

function submissionPlanScore(
  requiredTotal?: number | null,
  requiredSatisfied?: number | null,
  outsidePlan?: number | null,
): { score: number; notes: string[]; gapCount: number } {
  const notes: string[] = [];
  const total = requiredTotal ?? 0;
  const satisfied = requiredSatisfied ?? 0;
  const outside = outsidePlan ?? 0;
  if (total === 0) {
    notes.push("No submission plan rows detected — extract required documents before final generation.");
    return { score: 30, notes, gapCount: 0 };
  }
  const planRatio = satisfied / Math.max(1, total);
  let score = Math.round(planRatio * 100);
  if (outside > 0) {
    notes.push(`${outside} generated document(s) are outside the submission plan — must be mapped or superseded.`);
    score = Math.max(0, score - 10);
  }
  const gap = Math.max(0, total - satisfied);
  if (gap > 0) {
    notes.push(`${gap} required submission document(s) are still missing or not generated.`);
  }
  return { score, notes, gapCount: gap };
}

function requiredDocumentScore(requiredTotal?: number | null, requiredSatisfied?: number | null): { score: number; notes: string[]; gapCount: number } {
  const total = requiredTotal ?? 0;
  const satisfied = requiredSatisfied ?? 0;
  const gap = Math.max(0, total - satisfied);
  if (total === 0) return { score: 30, notes: ["No required documents extracted yet."], gapCount: 0 };
  const score = Math.round((satisfied / total) * 100);
  const notes = gap > 0 ? [`${gap}/${total} required documents are not yet present in current outputs.`] : [];
  return { score, notes, gapCount: gap };
}

function generatedDocumentQualityScore(qualityFailed?: number | null, finalCandidates?: number | null): { score: number; notes: string[]; failedCount: number } {
  const failed = qualityFailed ?? 0;
  const total = finalCandidates ?? 0;
  if (total === 0) return { score: 40, notes: ["No final-export-candidate documents yet."], failedCount: 0 };
  const goodCount = Math.max(0, total - failed);
  const score = Math.round((goodCount / total) * 100);
  const notes = failed > 0 ? [`${failed}/${total} generated document(s) failed the quality gate (QUALITY_FAILED / NEEDS_REWRITE).`] : [];
  return { score, notes, failedCount: failed };
}

function validationReviewScore(readyForExport?: number | null, finalCandidates?: number | null): { score: number; notes: string[] } {
  const ready = readyForExport ?? 0;
  const total = finalCandidates ?? 0;
  if (total === 0) return { score: 30, notes: [] };
  const score = Math.round((ready / total) * 100);
  const notes = ready < total ? [`${total - ready}/${total} final-export documents are not yet READY_FOR_EXPORT.`] : [];
  return { score, notes };
}

function finalExportGateScore(ok?: boolean | null): { score: number; notes: string[] } {
  if (ok === true) return { score: 100, notes: [] };
  if (ok === false) return { score: 0, notes: ["Canonical export gate is currently blocked."] };
  return { score: 50, notes: ["Final export gate has not been checked yet."] };
}

/**
 * Compute the readiness score and the list of applicable hard caps.
 *
 * Hard cap logic (all caps are *upper bounds* on the final score; the most
 * restrictive cap wins):
 *
 *   evidence coverage = 0                     -> final ≤ 35
 *   required documents incomplete             -> final ≤ 50
 *   regex fallback (not human-approved)       -> final ≤ 45
 *   critical metadata invalid/incomplete      -> final ≤ 60
 *   any QUALITY_FAILED generated documents    -> final ≤ 60
 *   final export gate not OK                  -> final ≤ 99 (never 100)
 */
export function computeReadinessScore(input: ReadinessScoreInput): ReadinessScoreResult {
  const dimensions: DimensionScore[] = [];

  const analysisQualityScore = analysisSeverityScore(input.analysisSeverity, input.analysisScore);
  dimensions.push({ dimension: "analysisQuality", score: analysisQualityScore, notes: [] });

  const sourceResult = analysisSourceScore(input.analysisSource);
  dimensions.push({ dimension: "analysisSource", score: sourceResult.score, notes: sourceResult.notes });

  const metadataResult = metadataCompletenessScore(input.metadataCompletenessRatio, input.metadataInvalidCount);
  dimensions.push({ dimension: "metadataCompleteness", score: metadataResult.score, notes: metadataResult.notes });

  dimensions.push({ dimension: "sourceReferenceCoverage", score: ratioToScore(input.sourceReferenceCoverage), notes: [] });

  const evidence = evidenceCoverageScore(input.evidenceCoverage, input.reviewedSelectionsPresent);
  dimensions.push({ dimension: "evidenceCoverage", score: evidence.score, notes: evidence.notes });

  const matching = clamp(input.matchingScore ?? 0);
  dimensions.push({ dimension: "matchingQuality", score: matching, notes: matching === 0 ? ["Matching score is 0/100 — no expert/project candidates linked yet."] : [] });

  dimensions.push({ dimension: "complianceMatrix", score: ratioToScore(input.complianceMatrixCoverage), notes: [] });

  const plan = submissionPlanScore(input.requiredDocumentsTotal, input.requiredDocumentsSatisfied, input.outsidePlanDocuments);
  dimensions.push({ dimension: "submissionPlanCompleteness", score: plan.score, notes: plan.notes });

  const reqDocs = requiredDocumentScore(input.requiredDocumentsTotal, input.requiredDocumentsSatisfied);
  dimensions.push({ dimension: "requiredDocumentCompleteness", score: reqDocs.score, notes: reqDocs.notes });

  const docQuality = generatedDocumentQualityScore(input.qualityFailedDocuments, input.finalExportCandidatesCount);
  dimensions.push({ dimension: "generatedDocumentQuality", score: docQuality.score, notes: docQuality.notes });

  const validation = validationReviewScore(input.readyForExportCount, input.finalExportCandidatesCount);
  dimensions.push({ dimension: "validationReview", score: validation.score, notes: validation.notes });

  const finalGate = finalExportGateScore(input.finalExportGateOk);
  dimensions.push({ dimension: "finalExportGate", score: finalGate.score, notes: finalGate.notes });

  // Weighted average.
  let weighted = 0;
  let weightTotal = 0;
  for (const dim of dimensions) {
    const w = DIMENSION_WEIGHTS[dim.dimension];
    weighted += dim.score * w;
    weightTotal += w;
  }
  const rawScore = Math.round(weighted / Math.max(1, weightTotal));

  // ── Hard caps (per spec).
  const applicableCaps: ReadinessScoreCap[] = [];
  if ((input.evidenceCoverage ?? 0) <= 0) {
    applicableCaps.push({
      dimension: "evidenceCoverage",
      capScore: 35,
      reason: "Evidence coverage is 0% — readiness is capped at 35 until MANDATORY requirements are mapped to reviewed evidence.",
    });
  }
  if (reqDocs.gapCount > 0) {
    applicableCaps.push({
      dimension: "requiredDocumentCompleteness",
      capScore: 50,
      reason: `${reqDocs.gapCount} required submission document(s) are missing from current outputs — readiness is capped at 50.`,
    });
  }
  if (input.analysisSource === "REGEX_FALLBACK_AI_ERROR") {
    applicableCaps.push({
      dimension: "analysisSource",
      capScore: 45,
      reason: "Analysis came from regex fallback. Readiness is capped at 45 until AI analysis is re-run or a human explicitly approves the fallback analysis.",
    });
  }
<<<<<<< HEAD
=======
  if (input.analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK") {
    // A human approved the regex-fallback analysis, so generation is allowed —
    // but readiness stays capped at 70 unless every critical dimension that the
    // regex fallback can get wrong is independently verified: source references,
    // mandatory-requirement compliance coverage, and the full required-document
    // set (file naming/order + submission method).
    const fullyVerified =
      (input.sourceReferenceCoverage ?? 0) >= 1 &&
      (input.complianceMatrixCoverage ?? 0) >= 1 &&
      (input.requiredDocumentsTotal ?? 0) > 0 &&
      (input.requiredDocumentsSatisfied ?? 0) >= (input.requiredDocumentsTotal ?? 0);
    if (!fullyVerified) {
      applicableCaps.push({
        dimension: "analysisSource",
        capScore: 70,
        reason: "Analysis came from a human-approved regex fallback. Readiness is capped at 70 until all source references, mandatory-requirement coverage, and the full required-document set are independently verified.",
      });
    }
  }
>>>>>>> origin/main
  if (
    (input.metadataCompletenessRatio ?? 0) < 0.6 ||
    (input.metadataInvalidCount ?? 0) > 0
  ) {
    applicableCaps.push({
      dimension: "metadataCompleteness",
      capScore: 60,
      reason: "Critical tender metadata is missing or invalid — readiness is capped at 60 until metadata is completed and validated.",
    });
  }
  if (docQuality.failedCount > 0) {
    applicableCaps.push({
      dimension: "generatedDocumentQuality",
      capScore: 60,
      reason: `${docQuality.failedCount} generated document(s) failed the quality gate — readiness is capped at 60.`,
    });
  }
  if (input.finalExportGateOk === false) {
    applicableCaps.push({
      dimension: "finalExportGate",
      capScore: 99,
      reason: "Final export gate is currently blocked — readiness can never reach 100 while blockers remain.",
    });
  }

  let appliedCap: ReadinessScoreCap | null = null;
  let clampedScore = rawScore;
  for (const cap of applicableCaps) {
    if (cap.capScore < clampedScore) {
      clampedScore = cap.capScore;
      appliedCap = cap;
    }
  }

  // The export gate cap is a "never exactly 100" rule and only kicks in if
  // no stronger cap clamped first.
  if (input.finalExportGateOk === false && clampedScore === 100) {
    clampedScore = 99;
    appliedCap = applicableCaps.find((c) => c.dimension === "finalExportGate") ?? appliedCap;
  }

  const severity: ReadinessScoreSeverity = clampedScore >= 80 ? "READY" : clampedScore >= 50 ? "PARTIAL" : "BLOCKED";

  return {
    score: clampedScore,
    rawScore,
    severity,
    dimensions,
    applicableCaps,
    appliedCap,
  };
}

// Tiny export for tests that want to introspect the weights table.
export const __testing__ = { DIMENSION_WEIGHTS };
