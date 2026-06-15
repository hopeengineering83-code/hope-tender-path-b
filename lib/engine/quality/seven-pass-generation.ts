export type SevenPassId =
  | "TENDER_COMPREHENSION"
  | "COMPLIANCE_EVIDENCE_MAP"
  | "EVIDENCE_SELECTION"
  | "DOCUMENT_OUTLINE"
  | "FIRST_SENIOR_DRAFT"
  | "SELF_REVIEW_SCORING"
  | "FINAL_REWRITE_APPROVAL";

export type SevenPassStatus = "PENDING" | "PASSED" | "BLOCKED";

export type AnalysisSource = "AI" | "HUMAN_APPROVED_REGEX" | "REGEX_FALLBACK" | "DETERMINISTIC_FALLBACK" | "UNKNOWN";

export type EvidenceTrustLevel = "REVIEWED" | "AI_DRAFT" | "REGEX_DRAFT" | "UNREVIEWED" | "UNKNOWN";

export type GeneratedDocumentGateInput = {
  analysisSource?: AnalysisSource | string | null;
  evidenceCoverageRatio?: number | null;
  reviewedEvidenceCount?: number | null;
  requiredEvidenceCount?: number | null;
  unsupportedClaimCount?: number | null;
  placeholderCount?: number | null;
  aiTraceCount?: number | null;
  pricingLeakageCount?: number | null;
  officialOriginalRiskCount?: number | null;
  technicalFinancialSeparationOk?: boolean | null;
  tenderScopeOnly?: boolean | null;
  outlineMatchesTender?: boolean | null;
  selectedEvidenceTrustLevels?: Array<EvidenceTrustLevel | string | null> | null;
  selfReviewScore?: number | null;
  providerUsed?: string | null;
  deterministicFallbackUsed?: boolean | null;
};

export type SevenPassResult = {
  id: SevenPassId;
  label: string;
  status: SevenPassStatus;
  blockers: string[];
};

export type SevenPassEvaluation = {
  finalApprovalAllowed: boolean;
  recommendedValidationStatus: "BLOCKED" | "DRAFT" | "PASSED";
  recommendedReviewStatus: "NEEDS_REVIEW" | "READY_FOR_EXPORT";
  minimumScore: number;
  passes: SevenPassResult[];
  blockers: string[];
};

const PASS_LABELS: Record<SevenPassId, string> = {
  TENDER_COMPREHENSION: "Tender comprehension",
  COMPLIANCE_EVIDENCE_MAP: "Compliance and evidence map",
  EVIDENCE_SELECTION: "Reviewed evidence selection",
  DOCUMENT_OUTLINE: "Tender-specific document outline",
  FIRST_SENIOR_DRAFT: "First senior draft",
  SELF_REVIEW_SCORING: "Self-review and scoring",
  FINAL_REWRITE_APPROVAL: "Final rewrite and approval gate",
};

function asRatio(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.max(0, Math.min(1, Number(value)));
}

function asCount(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.max(0, Math.floor(Number(value)));
}

function normalizedSource(value: string | null | undefined): AnalysisSource {
  const clean = String(value ?? "UNKNOWN").trim().toUpperCase();
  if (clean === "AI") return "AI";
  if (clean === "HUMAN_APPROVED_REGEX") return "HUMAN_APPROVED_REGEX";
  if (clean === "REGEX_FALLBACK") return "REGEX_FALLBACK";
  if (clean === "DETERMINISTIC_FALLBACK") return "DETERMINISTIC_FALLBACK";
  return "UNKNOWN";
}

function hasOnlyWeakEvidence(levels: Array<string | null | undefined>): boolean {
  if (levels.length === 0) return true;
  return levels.every((level) => !/^REVIEWED$/i.test(String(level ?? "")));
}

function result(id: SevenPassId, blockers: string[]): SevenPassResult {
  return {
    id,
    label: PASS_LABELS[id],
    status: blockers.length > 0 ? "BLOCKED" : "PASSED",
    blockers,
  };
}

export function evaluateSevenPassGenerationGate(input: GeneratedDocumentGateInput): SevenPassEvaluation {
  const analysisSource = normalizedSource(input.analysisSource);
  const evidenceCoverage = asRatio(input.evidenceCoverageRatio);
  const reviewedEvidenceCount = asCount(input.reviewedEvidenceCount);
  const requiredEvidenceCount = asCount(input.requiredEvidenceCount);
  const unsupportedClaimCount = asCount(input.unsupportedClaimCount);
  const placeholderCount = asCount(input.placeholderCount);
  const aiTraceCount = asCount(input.aiTraceCount);
  const pricingLeakageCount = asCount(input.pricingLeakageCount);
  const officialOriginalRiskCount = asCount(input.officialOriginalRiskCount);
  // null/undefined means "not yet scored" — treated as a warning, not a blocker.
  // Callers that can compute a real score (e.g. scoreProposalQuality) should pass it.
  // Only an explicitly-provided score < 80 blocks the gate.
  const selfReviewScore: number | null = input.selfReviewScore != null
    ? Math.max(0, Math.min(100, Number(input.selfReviewScore)))
    : null;
  const deterministicFallbackUsed = Boolean(input.deterministicFallbackUsed) || analysisSource === "DETERMINISTIC_FALLBACK";
  const selectedEvidenceTrustLevels = (input.selectedEvidenceTrustLevels ?? []).map((level) => String(level ?? "UNKNOWN"));

  const passes: SevenPassResult[] = [];

  passes.push(result("TENDER_COMPREHENSION", [
    ...(analysisSource === "UNKNOWN" ? ["Tender analysis source is unknown."] : []),
    ...(analysisSource === "REGEX_FALLBACK" ? ["Tender was analyzed by unapproved regex fallback and needs AI or human-approved analysis before final output."] : []),
    ...(deterministicFallbackUsed ? ["Deterministic fallback was used and cannot support final senior-quality approval."] : []),
  ]));

  passes.push(result("COMPLIANCE_EVIDENCE_MAP", [
    ...(requiredEvidenceCount > 0 && reviewedEvidenceCount === 0 ? ["Required evidence exists but no reviewed evidence is linked."] : []),
    ...(evidenceCoverage <= 0 ? ["Evidence coverage is zero."] : []),
    ...(evidenceCoverage > 0 && evidenceCoverage < 0.65 ? ["Evidence coverage is below senior-quality threshold."] : []),
  ]));

  passes.push(result("EVIDENCE_SELECTION", [
    ...(hasOnlyWeakEvidence(selectedEvidenceTrustLevels) ? ["Selected evidence contains no REVIEWED records."] : []),
    ...(selectedEvidenceTrustLevels.some((level) => /AI_DRAFT|REGEX_DRAFT/i.test(level)) && reviewedEvidenceCount === 0 ? ["Draft evidence is selected without reviewed support."] : []),
  ]));

  passes.push(result("DOCUMENT_OUTLINE", [
    ...(input.outlineMatchesTender === false ? ["Document outline does not match tender-required structure."] : []),
    ...(input.tenderScopeOnly === false ? ["Draft includes content outside tender scope."] : []),
  ]));

  passes.push(result("FIRST_SENIOR_DRAFT", [
    ...(unsupportedClaimCount > 0 ? [`${unsupportedClaimCount} unsupported claim(s) detected.`] : []),
    ...(placeholderCount > 0 ? [`${placeholderCount} placeholder/drafting instruction(s) detected.`] : []),
    ...(aiTraceCount > 0 ? [`${aiTraceCount} AI/meta trace(s) detected.`] : []),
  ]));

  passes.push(result("SELF_REVIEW_SCORING", [
    // Only fail if a score was explicitly provided AND is below threshold.
    // A null score means "not yet computed" — does not block by itself.
    ...(selfReviewScore !== null && selfReviewScore < 80 ? [`Self-review score ${selfReviewScore} is below required 80.`] : []),
    ...(pricingLeakageCount > 0 ? [`${pricingLeakageCount} pricing/commercial leakage issue(s) detected.`] : []),
    ...(input.technicalFinancialSeparationOk === false ? ["Technical/financial envelope separation failed."] : []),
  ]));

  passes.push(result("FINAL_REWRITE_APPROVAL", [
    ...(officialOriginalRiskCount > 0 ? [`${officialOriginalRiskCount} official-original risk(s) detected; official forms must be attached, not generated.`] : []),
    ...(deterministicFallbackUsed ? ["Fallback-generated content must remain draft-only until regenerated by AI or approved by a human reviewer."] : []),
    ...(analysisSource === "REGEX_FALLBACK" ? ["Regex fallback output cannot be final-approved without human approval."] : []),
  ]));

  const blockers = Array.from(new Set(passes.flatMap((pass) => pass.blockers)));
  const finalApprovalAllowed = blockers.length === 0;

  return {
    finalApprovalAllowed,
    recommendedValidationStatus: finalApprovalAllowed ? "PASSED" : deterministicFallbackUsed || analysisSource === "REGEX_FALLBACK" ? "DRAFT" : "BLOCKED",
    recommendedReviewStatus: finalApprovalAllowed ? "READY_FOR_EXPORT" : "NEEDS_REVIEW",
    minimumScore: 80,
    passes,
    blockers,
  };
}

export function sevenPassBlocksFinalApproval(input: GeneratedDocumentGateInput): boolean {
  return !evaluateSevenPassGenerationGate(input).finalApprovalAllowed;
}
