import {
  isValidClientName,
  isValidReferenceNumber,
  isValidCountry,
  isValidClientContact,
} from "./engine/metadata-validators";

export type AnalysisQualitySeverity = "GOOD" | "WARNING" | "POOR" | "UNSAFE";

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
  sourcePageNumber?: number | null;
  sourceExactQuote?: string | null;
  sourceConfidence?: number | null;
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
  // Sub-scores (Gap 4 fix) — a 100/100 overall score must reflect ALL
  // dimensions, not just requirement extraction. If metadata is corrupted
  // or matching is 0, the overall score reflects that even when
  // requirement extraction looks fine.
  subScores: {
    extractionQuality: number;
    requirementExtraction: number;
    metadataQuality: number;
    submissionPlanQuality: number;
    matchingReadiness: number;
    sourceGrounding: number;
  };
  metadataIssues: string[];
  warnings: string[];
  recommendations: string[];
  // True when analysis source is regex/deterministic fallback.
  // When true, score is capped at REGEX_FALLBACK_SCORE_CAP (45) so the
  // panel can never show a passing score for unreviewed fallback analysis.
  isRegexFallback: boolean;
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
  // ─── Gap 4 fix — extra inputs so overall score reflects reality. ──────
  // All optional for backward compat; older callers get the legacy
  // "requirements only" score behaviour.
  clientName?: string | null;
  referenceNumber?: string | null;
  country?: string | null;
  clientContactName?: string | null;
  extractedTextLength?: number | null;
  // Engine-emitted matching score (0-100). When 0/null, matchingReadiness
  // sub-score collapses and overall score drops accordingly.
  matchingScore?: number | null;
  // Count of selected reviewed experts/projects — when zero AND a matching
  // score exists, we still penalise overall analysis quality.
  selectedReviewedExperts?: number | null;
  selectedReviewedProjects?: number | null;
  // Optional: analysis source from tender.notes. When present and indicates
  // regex/deterministic fallback, the score is capped at 45 so the panel
  // cannot show a passing score for unapproved fallback analysis.
  analysisSource?: string | null;
  // Optional: total page count of the tender (max across all files). Used
  // to apply UNSAFE caps when analysis returns very few results from a
  // multi-page tender.
  totalPageCount?: number | null;
  deadline?: Date | string | null;
  submissionMethod?: string | null;
  submissionAddress?: string | null;
  submissionEmails?: string | null;
  analysisExtractionStatus?: string | null;
  // ─── Canonical AI Analyze state ──────────────────────────────────────
  // The zero-requirements message below used to be keyed on requirementCount
  // alone, so a tender whose AI Analyze had FAILED — or been superseded, or
  // fallen back to unapproved regex — was told "Source-text-only generation
  // will proceed". Nothing was going to proceed: the generation gate blocks
  // every one of those states. The panel was reassuring the owner about a
  // path the backend had already closed.
  //
  // The state is supplied by the caller (lib/engine/analysis-state-resolver.ts
  // is the one authority). ABSENT means "not established", which is never
  // treated as release-ready — an unknown state is not grounds for
  // reassurance. This changes what is SAID, never what is allowed.
  analysisState?: string | null;
  /** False when the promoted analysis no longer matches the canonical source. */
  analysisMatchesCurrentSource?: boolean | null;
}): AnalysisQualityReport {
  const REGEX_FALLBACK_SCORE_CAP = 45;
  const analysisSourceText = (params.analysisSource ?? "").trim();
  const isHumanApprovedRegexFallback = /HUMAN_APPROVED_REGEX_FALLBACK/i.test(analysisSourceText);
  const isRegexFallback = Boolean(
    analysisSourceText &&
    !isHumanApprovedRegexFallback &&
    /REGEX_FALLBACK|DETERMINISTIC_FALLBACK|regex\s+fallback/i.test(analysisSourceText),
  );
  const requirements = params.requirements ?? [];
  const requirementCount = requirements.length;
  const mandatoryCount = requirements.filter((req) => /mandatory|required|shall|must/i.test(req.priority ?? "")).length;
  const scoredCount = requirements.filter((req) => textIncludesAny(`${req.title ?? ""} ${req.description ?? ""} ${req.restrictions ?? ""}`, [/score/i, /weight/i, /points?/i, /evaluation/i, /criteria/i])).length;
  const exactFileNameCount = requirements.filter((req) => Boolean((req.exactFileName ?? "").trim())).length;
  const sourceReferencedCount = requirements.filter((req) =>
    Boolean((req.sectionReference ?? "").trim()) ||
    (req.sourcePageNumber != null && req.sourcePageNumber > 0) ||
    Boolean((req.sourceExactQuote ?? "").trim())
  ).length;

  const exactFileNaming = parseStringArray(params.exactFileNaming);
  const exactFileOrder = parseStringArray(params.exactFileOrder);
  const hasEvaluationMethodology = Boolean((params.evaluationMethodology ?? "").trim());
  const hasSubmissionNotes = Boolean((params.submissionNotes ?? "").trim());
  const hasExactFileNaming = exactFileNaming.length > 0;
  const hasExactFileOrder = exactFileOrder.length > 0;
  const hasRequiredDocumentsOrForms = hasExactFileNaming || exactFileNameCount > 0 || requirements.some((req) => /form|annex|schedule|certificate|declaration|document|file|envelope|technical|financial/i.test(`${req.title ?? ""} ${req.description ?? ""} ${req.requirementType ?? ""}`));
  const hasDeadline = Boolean(params.deadline);
  const hasSubmissionMethodOrEndpoint = Boolean((params.submissionMethod ?? "").trim() || (params.submissionAddress ?? "").trim() || (params.submissionEmails ?? "").trim());
  // Mirrors canExportWithAnalysisState(): only a promoted AI_SUCCEEDED analysis
  // that still matches the current source is release-ready. This is a reading of
  // the gate, never a second copy of it — no decision here unblocks anything.
  const analysisStateText = String(params.analysisState ?? "").trim().toUpperCase();
  const analysisIsReleaseReady =
    analysisStateText === "AI_SUCCEEDED" && params.analysisMatchesCurrentSource !== false;
  const analysisStateSuffix = analysisStateText ? ` (current state: ${analysisStateText})` : "";
  const extractionStatusText = String(params.analysisExtractionStatus ?? "").toUpperCase();
  const extractionUnsafe = /EXTRACTION_CORRUPTED|OCR_REQUIRED|EXTRACTION_WEAK_REVIEW_REQUIRED|REGEX_FALLBACK_FROM_WEAK_EXTRACTION/.test(extractionStatusText);
  const extractionPartial = extractionStatusText === "PARTIAL_EXTRACTION_AI_ANALYZED";
  const allAnalysisText = `${params.analysisSummary ?? ""}\n${params.evaluationMethodology ?? ""}\n${params.submissionNotes ?? ""}\n${requirements.map((req) => `${req.title ?? ""} ${req.description ?? ""} ${req.restrictions ?? ""}`).join("\n")}`;

  const likelyHasEvaluationLanguage = textIncludesAny(allAnalysisText, [/evaluation/i, /scor/i, /points?/i, /weight/i, /technical\s+score/i, /financial\s+score/i]);
  const likelyHasSubmissionLanguage = textIncludesAny(allAnalysisText, [/submission/i, /deadline/i, /portal/i, /email/i, /envelope/i, /file\s+name/i, /format/i]);
  const likelyMissingEvaluationCriteria = !hasEvaluationMethodology && scoredCount === 0 && !likelyHasEvaluationLanguage;
  const likelyMissingSubmissionRules = !hasSubmissionNotes && !hasExactFileNaming && !hasExactFileOrder && !likelyHasSubmissionLanguage;

  const warnings: string[] = [];
  const recommendations: string[] = [];
  let score = 100;

  if (requirementCount === 0) {
    // Gap 1: No requirements is no longer a 70-point penalty. Readable,
    // integrity-verified extracted tender text must proceed even when there
    // are no structured requirements. Source-text-only generation uses the
    // extracted scope, tender type, requested services, deliverables, forms
    // and submission instructions. Genuinely absent information is stored as
    // NOT_STATED — never invented.
    //
    // That is true only while AI Analyze itself is release-ready. When it is
    // not — FAILED, superseded, unapproved regex fallback, still running, or
    // no longer matching the source — "generation will proceed" is a promise
    // the generation gate will refuse to keep, and stating it sends the owner
    // to a button that cannot work.
    if (analysisIsReleaseReady) {
      warnings.push("No structured requirements were extracted. Source-text-only generation will proceed using the extracted tender scope, deliverables, and submission instructions.");
      recommendations.push("Review the generated proposal carefully — it is based on source text only, not structured requirements.");
    } else {
      warnings.push(`No structured requirements were extracted, and AI Analyze is not in a release-ready state${analysisStateSuffix}. Any source-text-only output is DRAFT ONLY and is not export authority.`);
      recommendations.push("Re-run AI Analyze on the current tender source and let it complete before relying on anything generated from source text alone.");
    }
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
    warnings.push("Evaluation/scoring methodology not stated in tender — advisory only, does not cap analysis quality.");
  }
  if (likelyMissingSubmissionRules) {
    warnings.push("Submission rules, exact file naming, or file order appear missing.");
    recommendations.push("Extract deadline, submission method, file names, envelope rules, and required forms exactly.");
    score -= 20;
  }
  if (sourceReferencedCount === 0 && requirementCount > 0) {
    warnings.push("Requirements do not contain section/page references.");
    recommendations.push("Add or re-run analysis with source references for evaluator-grade traceability.");
    // Zero source traceability is a critical gap — raise from -10 to -25 so tenders
    // with 0% grounding cannot score WARNING (75+) and slip through export gates.
    score -= mandatoryCount > 0 ? 25 : 15;
  }
  if (exactFileNameCount === 0 && hasExactFileNaming) {
    warnings.push("Tender-level file naming exists, but individual requirements are not mapped to exact file names.");
    recommendations.push("Map exact required files/forms to the requirements they satisfy.");
    score -= 8;
  }

  // ─── Gap 4 fix — metadata validity ─────────────────────────────────
  // Earlier the score climbed to 100/100 even when client name was a TOC
  // fragment, reference was "only", country was "A ddis Ababa", and the
  // contact name was "s Contact Person". Now invalid metadata penalises
  // the overall score AND surfaces explicit metadataIssues[] for the UI.
  const metadataIssues: string[] = [];
  const clientNameProvided = (params.clientName ?? "").trim().length > 0;
  const referenceProvided = (params.referenceNumber ?? "").trim().length > 0;
  const countryProvided = (params.country ?? "").trim().length > 0;
  const contactProvided = (params.clientContactName ?? "").trim().length > 0;

  if (clientNameProvided && !isValidClientName(params.clientName)) {
    metadataIssues.push("clientName extracted but invalid — advisory only");
  }
  if (referenceProvided && !isValidReferenceNumber(params.referenceNumber)) {
    metadataIssues.push("referenceNumber extracted but invalid — advisory only");
  }
  if (countryProvided && !isValidCountry(params.country)) {
    metadataIssues.push("country value is not in the known country whitelist — advisory only");
  }
  if (contactProvided && !isValidClientContact(params.clientContactName)) {
    metadataIssues.push("clientContactName extracted but appears to be a fragment — advisory only");
  }
  if (metadataIssues.length > 0) {
    warnings.push(`Tender Details have ${metadataIssues.length} validation issue(s): ${metadataIssues.join("; ")}`);
    recommendations.push("Open Tender Detail and re-extract metadata, or correct the fields manually before generation.");
  }

  // ─── Gap 4 + Gap 5 fix — matching readiness affects analysis score ─
  // Previously analysis quality could be 100/100 while matching was
  // 0/100. They are not independent — if no candidates have been matched
  // to this tender, the analysis cannot be considered "usable for
  // matching, scoring, and generation".
  let matchingReadinessSub = 100;
  if (typeof params.matchingScore === "number") {
    if (params.matchingScore === 0) {
      warnings.push("Matching score is 0/100 — no expert/project candidates linked to this tender yet.");
      recommendations.push("Run Engine again to generate tender-specific matches before relying on this analysis.");
      score -= 20;
      matchingReadinessSub = 0;
    } else if (params.matchingScore < 50) {
      warnings.push(`Matching score is low (${params.matchingScore}/100). Selected evidence may not be strong enough.`);
      score -= 10;
      matchingReadinessSub = params.matchingScore;
    } else {
      matchingReadinessSub = params.matchingScore;
    }
  }

  // ─── Evidence quality: reviewed vs unreviewed selection ────────────
  // A non-zero matching score with zero REVIEWED experts/projects selected
  // means only unreviewed candidates were matched. Unreviewed CVs and project
  // refs have not been QA'd — proposals built from them are high-risk.
  const reviewedExperts = params.selectedReviewedExperts ?? null;
  const reviewedProjects = params.selectedReviewedProjects ?? null;
  const hasAnyReviewedEvidence = (reviewedExperts !== null && reviewedExperts > 0) || (reviewedProjects !== null && reviewedProjects > 0);
  const hasMatchingScore = typeof params.matchingScore === "number" && params.matchingScore > 0;
  if (hasMatchingScore && reviewedExperts !== null && reviewedProjects !== null && !hasAnyReviewedEvidence) {
    warnings.push("Matching score is non-zero but no REVIEWED experts or projects are selected. Proposals built from unreviewed evidence carry higher evaluator-rejection risk.");
    recommendations.push("Review and approve at least one expert CV and one comparable project reference in the Vault before generating documents.");
    score -= 12;
    matchingReadinessSub = Math.max(0, matchingReadinessSub - 20);
  }

  // ─── Sub-score breakdown ───────────────────────────────────────────
  const extractedTextLength = params.extractedTextLength ?? 0;
  const extractionQualitySub = extractedTextLength >= 5000 ? 100 : extractedTextLength >= 1000 ? 70 : extractedTextLength >= 200 ? 40 : extractedTextLength > 0 ? 20 : 0;
  const requirementExtractionSub = requirementCount === 0 ? 0 : requirementCount < 5 ? 50 : Math.min(100, 60 + requirementCount * 2);
  // Metadata sub-score: weighted per field to match the main-score deductions
  // (clientName −25, referenceNumber −15, country −8, contactName −6).
  // Using a flat 25 per issue misrepresents a minor country validation failure
  // as equally severe as a broken clientName.
  const metadataProvided = clientNameProvided || referenceProvided || countryProvided || contactProvided;
  const metadataIssuePenalty = metadataIssues.reduce((sum, issue) => {
    if (issue.includes("clientName")) return sum + 25;
    if (issue.includes("referenceNumber")) return sum + 15;
    if (issue.includes("country")) return sum + 8;
    if (issue.includes("clientContactName")) return sum + 6;
    return sum + 10;
  }, 0);
  const metadataQualitySub = !metadataProvided ? 70 : Math.max(0, 100 - metadataIssuePenalty);
  const submissionPlanQualitySub = likelyMissingSubmissionRules ? 30 : hasExactFileNaming || hasExactFileOrder ? 100 : hasSubmissionNotes ? 75 : 50;
  const rawGrounding = requirementCount === 0 ? 0 : Math.round((sourceReferencedCount / requirementCount) * 100);
  const groundingFloor = extractedTextLength >= 5000 ? 25 : extractedTextLength >= 1000 ? 15 : 0;
  const sourceGroundingSub = Math.min(100, Math.max(rawGrounding, groundingFloor));

  // ─── Hard safety caps (UNSAFE severity) ────────────────────────────
  // When a multi-page tender produces suspiciously few results, cap the
  // score and mark severity as UNSAFE so downstream gates treat it as
  // definitively blocking (same as POOR / FAILED).
  const pageCount = params.totalPageCount ?? 0;
  let isUnsafe = false;
  if (pageCount >= 5) {
    if (requirementCount < 3) {
      warnings.push("Analysis extracted fewer than 3 requirements from a multi-page tender — result is unreliable.");
      score = Math.min(score, 25);
      isUnsafe = true;
    }
    if (mandatoryCount === 0) {
      warnings.push("Analysis extracted zero mandatory requirements from a multi-page tender.");
      score = Math.min(score, 30);
      isUnsafe = true;
    }
    if (sourceReferencedCount === 0) {
      warnings.push("No requirements have source page or quote references — analysis cannot be verified.");
      score = Math.min(score, 30);
      isUnsafe = true;
    }
    if (!isValidClientName(params.clientName)) {
      warnings.push("Client/procuring entity not extracted — advisory only, does not cap analysis quality.");
    }
    if (!hasDeadline) {
      warnings.push("Deadline not extracted — advisory only, does not cap analysis quality.");
    }
    if (!hasSubmissionMethodOrEndpoint) {
      warnings.push("Submission method/endpoint not extracted — advisory only, does not cap analysis quality.");
    }
    if (!hasEvaluationMethodology) {
      // RUNTIME METADATA DEBLOCKER: Missing evaluation weights should NOT cap
      // the score at 40/UNSAFE. Many tenders do not provide evaluation weights
      // — this is "not stated", not an extraction failure. Only warn.
      warnings.push("Evaluation criteria/weights are not stated in the tender source. Treat as not stated, not extraction failure.");
      score -= 5; // Minor deduction, not a hard cap
    }
    if (!hasRequiredDocumentsOrForms) {
      warnings.push("Required documents/forms are not known from exact file names or extracted requirements.");
      score -= 5; // Minor deduction, not a hard cap
    }
  }
  if (extractionUnsafe) {
    warnings.push("Extraction status is weak/corrupted/OCR-required; analysis cannot be trusted for downstream gates.");
    score = Math.min(score, 25);
    isUnsafe = true;
  }
  if (extractionPartial) {
    warnings.push("AI analysis ran on partially-extracted tender pages — results may be missing sections. Upload a clearer, text-based copy for a fully reliable analysis.");
    score = Math.min(score, 74);
  }
  if (isRegexFallback) {
    isUnsafe = true;
  }

  score = Math.max(0, Math.min(100, score));
  if (isRegexFallback && score > REGEX_FALLBACK_SCORE_CAP) {
    score = REGEX_FALLBACK_SCORE_CAP;
    warnings.unshift("Analysis used regex/deterministic fallback — score capped at 45. Re-run AI Analyze or approve the fallback to unblock generation.");
    recommendations.unshift("Re-run AI Analyze when AI providers are healthy, or approve this fallback analysis with a written note via the Controls panel.");
  }
  // Zero source grounding cannot score GOOD regardless of other signals —
  // a proposal built on untraced requirements can silently miss evaluator
  // criteria. Cap at WARNING (max 74) when no requirement has source
  // traceability so this case cannot slip through export/generation gates.
  const zeroGrounding = sourceReferencedCount === 0 && requirementCount > 0;
  const rawSeverity: AnalysisQualitySeverity = isUnsafe ? "UNSAFE" : score < 50 ? "POOR" : score < 75 ? "WARNING" : "GOOD";
  const severity: AnalysisQualitySeverity = zeroGrounding && rawSeverity === "GOOD" ? "WARNING" : rawSeverity;
  if (zeroGrounding && severity === "WARNING") score = Math.min(score, 74);
  // Only claim usability when the analysis behind the score is itself
  // release-ready. A good score computed over a FAILED or superseded analysis
  // describes the data, not permission to use it.
  if (severity === "GOOD" && warnings.length === 0) {
    recommendations.push(
      analysisIsReleaseReady || !analysisStateText
        ? "Tender analysis appears usable for matching, scoring, and generation."
        : `Extracted content looks good, but AI Analyze is not release-ready${analysisStateSuffix} — re-run it before relying on this analysis for generation or export.`,
    );
  }

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
    subScores: {
      extractionQuality: extractionQualitySub,
      requirementExtraction: requirementExtractionSub,
      metadataQuality: metadataQualitySub,
      submissionPlanQuality: submissionPlanQualitySub,
      matchingReadiness: matchingReadinessSub,
      sourceGrounding: sourceGroundingSub,
    },
    metadataIssues,
    warnings,
    recommendations,
    isRegexFallback,
  };
}
