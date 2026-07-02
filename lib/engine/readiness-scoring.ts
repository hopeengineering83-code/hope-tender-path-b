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

export type DimensionScore = { dimension: ReadinessScoreDimension; score: number; notes: string[] };
export type ReadinessScoreCap = { dimension: ReadinessScoreDimension | "compound"; capScore: number; reason: string };
export type ReadinessScoreResult = { score: number; rawScore: number; severity: ReadinessScoreSeverity; dimensions: DimensionScore[]; applicableCaps: ReadinessScoreCap[]; appliedCap: ReadinessScoreCap | null };

export type ReadinessScoreInput = {
  analysisScore?: number | null;
  analysisSeverity?: "GOOD" | "WARNING" | "POOR" | null;
  analysisSource?: "AI" | "REGEX_FALLBACK_AI_ERROR" | "HUMAN_APPROVED_REGEX_FALLBACK" | "UNKNOWN" | null;
  metadataCompletenessRatio?: number | null;
  metadataInvalidCount?: number | null;
  metadataContaminated?: boolean | null;
  analysisExtractionStatus?: string | null;
  sourceReferenceCoverage?: number | null;
  evidenceCoverage?: number | null;
  reviewedSelectionsPresent?: boolean | null;
  matchingScore?: number | null;
  complianceMatrixCoverage?: number | null;
  requiredDocumentsTotal?: number | null;
  requiredDocumentsSatisfied?: number | null;
  outsidePlanDocuments?: number | null;
  qualityFailedDocuments?: number | null;
  readyForExportCount?: number | null;
  finalExportCandidatesCount?: number | null;
  mandatoryRequirementsCount?: number | null;
  mandatoryTracedCount?: number | null;
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
    case "AI": return { score: 100, notes: [] };
    case "HUMAN_APPROVED_REGEX_FALLBACK": return { score: 60, notes: ["Regex fallback is approved for draft review only; final export requires reliable AI analysis or explicit final admin override."] };
    case "REGEX_FALLBACK_AI_ERROR": return { score: 15, notes: ["Analysis came from regex fallback after AI provider failure. Re-run AI analysis before final generation."] };
    default: return { score: 50, notes: ["Analysis source unknown — treat as low confidence until re-run."] };
  }
}
function evidenceCoverageScore(ratio?: number | null, reviewedSelectionsPresent?: boolean | null): { score: number; notes: string[] } {
  const notes: string[] = [];
  const fraction = typeof ratio === "number" ? ratio : 0;
  if (fraction <= 0) notes.push("Evidence coverage is 0% — no MANDATORY/CRITICAL requirements are mapped to reviewed evidence.");
  if (reviewedSelectionsPresent === false) notes.push("No reviewed experts/projects are selected — vault selections are draft-only.");
  return { score: ratioToScore(ratio), notes };
}
function metadataCompletenessScore(ratio?: number | null, invalidCount?: number | null): { score: number; notes: string[] } {
  const notes: string[] = [];
  const score = ratioToScore(ratio);
  if (typeof ratio === "number" && ratio < 0.6) notes.push(`Tender metadata auto-fill coverage is ${Math.round((ratio ?? 0) * 100)}%. Critical fields must be filled before final generation.`);
  if ((invalidCount ?? 0) > 0) notes.push(`${invalidCount} metadata field(s) failed validation.`);
  return { score, notes };
}
function submissionPlanScore(requiredTotal?: number | null, requiredSatisfied?: number | null, outsidePlan?: number | null): { score: number; notes: string[]; gapCount: number } {
  const notes: string[] = [];
  const total = requiredTotal ?? 0;
  const satisfied = requiredSatisfied ?? 0;
  const outside = outsidePlan ?? 0;
  if (total === 0) return { score: 30, notes: ["No submission plan rows detected — extract required documents before final generation."], gapCount: 0 };
  const gap = Math.max(0, total - satisfied);
  let score = Math.round((satisfied / Math.max(1, total)) * 100);
  if (outside > 0) { notes.push(`${outside} generated document(s) are outside the submission plan.`); score = Math.max(0, score - 10); }
  if (gap > 0) notes.push(`${gap} required submission document(s) are still missing or not generated.`);
  return { score, notes, gapCount: gap };
}
function requiredDocumentScore(requiredTotal?: number | null, requiredSatisfied?: number | null): { score: number; notes: string[]; gapCount: number } {
  const total = requiredTotal ?? 0;
  const satisfied = requiredSatisfied ?? 0;
  const gap = Math.max(0, total - satisfied);
  if (total === 0) return { score: 30, notes: ["No required documents extracted yet."], gapCount: 0 };
  return { score: Math.round((satisfied / total) * 100), notes: gap > 0 ? [`${gap}/${total} required documents are not yet present in current outputs.`] : [], gapCount: gap };
}
function generatedDocumentQualityScore(qualityFailed?: number | null, finalCandidates?: number | null): { score: number; notes: string[]; failedCount: number } {
  const failed = qualityFailed ?? 0;
  const total = finalCandidates ?? 0;
  if (total === 0) return { score: 40, notes: ["No final-export-candidate documents yet."], failedCount: 0 };
  return { score: Math.round(((total - failed) / total) * 100), notes: failed > 0 ? [`${failed}/${total} generated document(s) failed the quality gate.`] : [], failedCount: failed };
}
function validationReviewScore(readyForExport?: number | null, finalCandidates?: number | null): { score: number; notes: string[] } {
  const ready = readyForExport ?? 0;
  const total = finalCandidates ?? 0;
  if (total === 0) return { score: 30, notes: [] };
  return { score: Math.round((ready / total) * 100), notes: ready < total ? [`${total - ready}/${total} final-export documents are not yet READY_FOR_EXPORT.`] : [] };
}
function finalExportGateScore(ok?: boolean | null): { score: number; notes: string[] } {
  if (ok === true) return { score: 100, notes: [] };
  if (ok === false) return { score: 0, notes: ["Canonical export gate is currently blocked."] };
  return { score: 50, notes: ["Final export gate has not been checked yet."] };
}

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

  let weighted = 0;
  let weightTotal = 0;
  for (const dim of dimensions) { const w = DIMENSION_WEIGHTS[dim.dimension]; weighted += dim.score * w; weightTotal += w; }
  const rawScore = Math.round(weighted / Math.max(1, weightTotal));

  const applicableCaps: ReadinessScoreCap[] = [];
  if ((input.evidenceCoverage ?? 0) <= 0) applicableCaps.push({ dimension: "evidenceCoverage", capScore: 35, reason: "Evidence coverage is 0% — readiness is capped at 35 until mandatory/critical requirements are mapped to reviewed evidence." });
  if (reqDocs.gapCount > 0) applicableCaps.push({ dimension: "requiredDocumentCompleteness", capScore: 50, reason: `${reqDocs.gapCount} required submission document(s) are missing from current outputs — readiness is capped at 50.` });
  if (input.analysisSource === "REGEX_FALLBACK_AI_ERROR") applicableCaps.push({ dimension: "analysisSource", capScore: 45, reason: "Analysis came from regex fallback. Readiness is capped at 45 until AI analysis is re-run." });
  // PERMANENT BLOCK: HUMAN_APPROVED_REGEX_FALLBACK is audit-only — it MUST
  // NEVER authorize release. Cap at 45 (same as unapproved regex fallback)
  // regardless of verification status, because the release path is blocked
  // at the gate level anyway. The previous "fullyVerified → no cap" branch
  // was misleading: it suggested the tender was release-ready when in fact
  // the gate would still block it.
  if (input.analysisSource === "HUMAN_APPROVED_REGEX_FALLBACK") {
    applicableCaps.push({ dimension: "analysisSource", capScore: 45, reason: "Human-approved regex fallback is AUDIT-ONLY and does NOT authorize release. Readiness is capped at 45 until AI analysis is re-run with healthy providers." });
  }
  if (input.analysisExtractionStatus === "EXTRACTION_CORRUPTED_AI_SKIPPED") applicableCaps.push({ dimension: "analysisSource", capScore: 30, reason: "AI Analyze was skipped because tender extraction was corrupted." });
  if (input.analysisExtractionStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION") applicableCaps.push({ dimension: "analysisSource", capScore: 40, reason: "AI analysis used regex fallback due to weak extraction." });
  if (input.analysisExtractionStatus === "OCR_REQUIRED") applicableCaps.push({ dimension: "analysisSource", capScore: 40, reason: "Tender requires OCR extraction before AI Analyze can be trusted." });
  if (input.analysisExtractionStatus === "PARTIAL_EXTRACTION_AI_ANALYZED") applicableCaps.push({ dimension: "analysisSource", capScore: 50, reason: "AI analysis ran on partially extracted pages." });
  if ((input.mandatoryRequirementsCount ?? 0) > 0 && (input.mandatoryTracedCount ?? 0) === 0) applicableCaps.push({ dimension: "sourceReferenceCoverage", capScore: 60, reason: `Tender has ${input.mandatoryRequirementsCount} mandatory/critical requirement(s) but none have source traceability.` });
  if (input.metadataContaminated) applicableCaps.push({ dimension: "metadataCompleteness", capScore: 50, reason: "Client/procuring entity name is contaminated by portal noise or unrelated text." });
  if ((input.metadataCompletenessRatio ?? 0) < 0.6 || (input.metadataInvalidCount ?? 0) > 0) applicableCaps.push({ dimension: "metadataCompleteness", capScore: 60, reason: "Critical tender metadata is missing or invalid." });
  if (docQuality.failedCount > 0) applicableCaps.push({ dimension: "generatedDocumentQuality", capScore: 60, reason: `${docQuality.failedCount} generated document(s) failed the quality gate.` });
  if (input.finalExportGateOk === false) applicableCaps.push({ dimension: "finalExportGate", capScore: 99, reason: "Final export gate is currently blocked." });

  let appliedCap: ReadinessScoreCap | null = null;
  let clampedScore = rawScore;
  for (const cap of applicableCaps) if (cap.capScore < clampedScore) { clampedScore = cap.capScore; appliedCap = cap; }
  if (input.finalExportGateOk === false && clampedScore === 100) { clampedScore = 99; appliedCap = applicableCaps.find((c) => c.dimension === "finalExportGate") ?? appliedCap; }
  const severity: ReadinessScoreSeverity = clampedScore >= 80 ? "READY" : clampedScore >= 50 ? "PARTIAL" : "BLOCKED";
  return { score: clampedScore, rawScore, severity, dimensions, applicableCaps, appliedCap };
}

export const __testing__ = { DIMENSION_WEIGHTS };
