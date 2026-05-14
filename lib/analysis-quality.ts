export type AnalysisQualitySeverity = "GOOD" | "WARNING" | "POOR";

export type AnalysisRequirementLike = {
  title?: string | null;
  description?: string | null;
  requirementType?: string | null;
  priority?: string | null;
  exactFileName?: string | null;
  requiredQuantity?: number | null;
  pageLimit?: number | null;
  restrictions?: string | null;
  sectionReference?: string | null;
};

export type AnalysisQualityReport = {
  severity: AnalysisQualitySeverity;
  score: number;
  requirementCount: number;
  mandatoryCount: number;
  scoredCount: number;
  exactFileNameCount: number;
  sourceReferencedCount: number;
  hasEvaluationMethodology: boolean;
  hasSubmissionNotes: boolean;
  hasExactFileNaming: boolean;
  hasExactFileOrder: boolean;
  likelyMissingEvaluationCriteria: boolean;
  likelyMissingSubmissionRules: boolean;
  warnings: string[];
  recommendations: string[];
};

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return value.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
  }
}

function textIncludesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function assessTenderAnalysisQuality(params: {
  requirements: AnalysisRequirementLike[];
  analysisSummary?: string | null;
  evaluationMethodology?: string | null;
  submissionNotes?: string | null;
  exactFileNaming?: string | null;
  exactFileOrder?: string | null;
}): AnalysisQualityReport {
  const requirements = params.requirements ?? [];
  const requirementCount = requirements.length;
  const mandatoryCount = requirements.filter((req) => /mandatory|required|shall|must/i.test(req.priority ?? "")).length;
  const scoredCount = requirements.filter((req) => textIncludesAny(`${req.title ?? ""} ${req.description ?? ""} ${req.restrictions ?? ""}`, [/score/i, /weight/i, /points?/i, /evaluation/i, /criteria/i])).length;
  const exactFileNameCount = requirements.filter((req) => Boolean((req.exactFileName ?? "").trim())).length;
  const sourceReferencedCount = requirements.filter((req) => Boolean((req.sectionReference ?? "").trim())).length;

  const exactFileNaming = parseStringArray(params.exactFileNaming);
  const exactFileOrder = parseStringArray(params.exactFileOrder);
  const hasEvaluationMethodology = Boolean((params.evaluationMethodology ?? "").trim());
  const hasSubmissionNotes = Boolean((params.submissionNotes ?? "").trim());
  const hasExactFileNaming = exactFileNaming.length > 0;
  const hasExactFileOrder = exactFileOrder.length > 0;
  const allAnalysisText = `${params.analysisSummary ?? ""}\n${params.evaluationMethodology ?? ""}\n${params.submissionNotes ?? ""}\n${requirements.map((req) => `${req.title ?? ""} ${req.description ?? ""} ${req.restrictions ?? ""}`).join("\n")}`;

  const likelyHasEvaluationLanguage = textIncludesAny(allAnalysisText, [/evaluation/i, /scor/i, /points?/i, /weight/i, /technical\s+score/i, /financial\s+score/i]);
  const likelyHasSubmissionLanguage = textIncludesAny(allAnalysisText, [/submission/i, /deadline/i, /portal/i, /email/i, /envelope/i, /file\s+name/i, /format/i]);
  const likelyMissingEvaluationCriteria = !hasEvaluationMethodology && scoredCount === 0 && !likelyHasEvaluationLanguage;
  const likelyMissingSubmissionRules = !hasSubmissionNotes && !hasExactFileNaming && !hasExactFileOrder && !likelyHasSubmissionLanguage;

  const warnings: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  if (requirementCount === 0) {
    warnings.push("No requirements were extracted from the tender.");
    recommendations.push("Run AI Analyze / Run Engine again after confirming extraction quality.");
    score -= 70;
  } else if (requirementCount < 5) {
    warnings.push(`Only ${requirementCount} requirement(s) were extracted; complex tenders usually contain more.`);
    recommendations.push("Review the tender manually for missing eligibility, technical, financial, form, and submission requirements.");
    score -= 20;
  }

  if (mandatoryCount === 0 && requirementCount > 0) {
    warnings.push("No mandatory requirements were detected.");
    recommendations.push("Confirm whether mandatory eligibility and submission requirements were missed.");
    score -= 15;
  }
  if (likelyMissingEvaluationCriteria) {
    warnings.push("Evaluation/scoring methodology appears missing or weak.");
    recommendations.push("Extract the evaluation matrix/criteria exactly before scoring and generation.");
    score -= 25;
  }
  if (likelyMissingSubmissionRules) {
    warnings.push("Submission rules, exact file naming, or file order appear missing.");
    recommendations.push("Extract deadline, submission method, file names, envelope rules, and required forms exactly.");
    score -= 20;
  }
  if (sourceReferencedCount === 0 && requirementCount > 0) {
    warnings.push("Requirements do not contain section/page references.");
    recommendations.push("Add or re-run analysis with source references for evaluator-grade traceability.");
    score -= 10;
  }
  if (exactFileNameCount === 0 && hasExactFileNaming) {
    warnings.push("Tender-level file naming exists, but individual requirements are not mapped to exact file names.");
    recommendations.push("Map exact required files/forms to the requirements they satisfy.");
    score -= 8;
  }

  score = Math.max(0, Math.min(100, score));
  const severity: AnalysisQualitySeverity = score < 50 ? "POOR" : score < 75 ? "WARNING" : "GOOD";
  if (severity === "GOOD" && warnings.length === 0) recommendations.push("Tender analysis appears usable for matching, scoring, and generation.");

  return {
    severity,
    score,
    requirementCount,
    mandatoryCount,
    scoredCount,
    exactFileNameCount,
    sourceReferencedCount,
    hasEvaluationMethodology,
    hasSubmissionNotes,
    hasExactFileNaming,
    hasExactFileOrder,
    likelyMissingEvaluationCriteria,
    likelyMissingSubmissionRules,
    warnings,
    recommendations,
  };
}
