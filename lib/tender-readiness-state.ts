// Shared readiness trust signal helper.
//
// Computes whether each layer of the pipeline can be trusted:
//   extractionTrusted  — extraction quality is usable
//   analysisTrusted    — AI analysis came from a trustworthy source
//   requirementsTrusted — requirements are source-traced and from trusted analysis
//   metadataTrusted    — title, client name, reference are present and not contaminated
//   submissionPlanBuilt — explicit or requirement-derived file list exists
//
// Derived signals:
//   complianceCurrent  — compliance matrix is valid for the current requirements
//   documentsCurrent   — generated documents were produced from the current analysis
//   exportAllowed      — all upstream gates pass
//
// This module is intentionally DB-free and side-effect-free.
// Every downstream panel (compliance, documents, export readiness, health)
// must consult these signals before displaying a green/passing status.
// A "10/10 compliance" display while requirementsTrusted=false is a
// contradiction that these signals are designed to block.

export type TenderReadinessInput = {
  // Extraction
  analysisExtractionStatus?: string | null;

  // Analysis
  /** "AI" | "REGEX_FALLBACK_AI_ERROR" | "HUMAN_APPROVED_REGEX_FALLBACK" | "UNKNOWN" */
  analysisSource?: string | null;
  analysisSeverity?: "GOOD" | "WARNING" | "POOR" | "UNSAFE" | null;

  // Metadata
  title?: string | null;
  clientName?: string | null;
  procuringEntityName?: string | null;
  reference?: string | null;
  metadataContaminated?: boolean | null;

  // Requirements
  requirements?: Array<{
    priority?: string | null;
    sourcePageNumber?: number | null;
    sourceExactQuote?: string | null;
    sectionReference?: string | null;
    sourceConfidence?: number | null;
    exactFileName?: string | null;
  }>;

  // Submission plan markers
  exactFileNaming?: string | null;
  exactFileOrder?: string | null;

  // Generated documents — used to detect analysis staleness.
  // Each doc's contentSummary may contain a JSON blob with { analysisHash }.
  // When that hash differs from the current derived hash, the doc is stale.
  generatedDocuments?: Array<{
    contentSummary?: string | null;
    generationStatus?: string | null;
  }>;
};

export type TenderReadinessState = {
  // ── Upstream trust signals ────────────────────────────────────────────────
  extractionTrusted: boolean;
  analysisTrusted: boolean;
  requirementsTrusted: boolean;
  metadataTrusted: boolean;
  submissionPlanBuilt: boolean;

  // ── Derived downstream validity ───────────────────────────────────────────
  /** Compliance matrix reflects the current trusted requirements. */
  complianceCurrent: boolean;
  /** Generated documents were produced from the current trusted analysis. */
  documentsCurrent: boolean;
  /** All upstream gates pass — export is allowed. */
  exportAllowed: boolean;

  // ── Requirement counts (for UI display) ───────────────────────────────────
  rawRequirementsCount: number;
  /** Requirements that came from a trusted (non-fallback, non-unsafe) analysis. */
  trustedRequirementsCount: number;
  /** Requirements with at least one source trace (page / quote / section ref / confidence). */
  sourceTracedRequirementsCount: number;
  mandatoryRequirementsCount: number;
  /** Mandatory requirements that also have source traceability. */
  mandatoryTracedCount: number;

  // ── Staleness ─────────────────────────────────────────────────────────────
  /** Deterministic hash of the current analysis state (extraction status + source + counts). */
  currentAnalysisHash: string;
  /** True when every active generated document was produced from the current analysis hash. */
  docsGeneratedFromCurrentAnalysis: boolean;

  // ── Blockers and warnings ─────────────────────────────────────────────────
  /** Hard blockers — must be resolved before generation / export. */
  blockers: string[];
  /** Soft warnings — surfaced to the user but do not block. */
  warnings: string[];
};

// ── Public API ────────────────────────────────────────────────────────────────

export function computeTenderReadinessState(input: TenderReadinessInput): TenderReadinessState {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const extractionStatus = (input.analysisExtractionStatus ?? "").toUpperCase();
  const analysisSource = (input.analysisSource ?? "").toUpperCase();
  const requirements = input.requirements ?? [];

  // ── Extraction trust ──────────────────────────────────────────────────────
  const extractionCorrupted = /EXTRACTION_CORRUPTED|EXTRACTION_WEAK_REVIEW_REQUIRED/.test(extractionStatus);
  const extractionOcrRequired = extractionStatus === "OCR_REQUIRED";
  const extractionRegexWeak = extractionStatus === "REGEX_FALLBACK_FROM_WEAK_EXTRACTION";
  const extractionPartial = extractionStatus === "PARTIAL_EXTRACTION_AI_ANALYZED";

  const extractionTrusted = !extractionCorrupted && !extractionOcrRequired && !extractionRegexWeak;

  if (extractionCorrupted) {
    blockers.push("Tender extraction was corrupted or too weak to run AI Analyze — re-extract and re-run AI Analyze.");
  }
  if (extractionOcrRequired) {
    blockers.push("Tender requires OCR extraction — run OCR before AI Analyze.");
  }
  if (extractionRegexWeak) {
    blockers.push("AI analysis fell back to regex due to weak extraction — re-extract and re-run AI Analyze.");
  }
  if (extractionPartial) {
    warnings.push("AI analysis ran on partially-extracted pages — some tender sections may be missing. Re-extract or run OCR for complete results.");
  }

  // ── Analysis trust ────────────────────────────────────────────────────────
  const analysisIsRegexFallback = /REGEX_FALLBACK_AI_ERROR/.test(analysisSource);
  const analysisIsHumanApproved = /HUMAN_APPROVED_REGEX_FALLBACK/.test(analysisSource);
  const analysisIsAi = analysisSource === "AI";
  const analysisSeverity = input.analysisSeverity ?? null;
  const analysisUnsafe = analysisSeverity === "UNSAFE" || analysisSeverity === "POOR";

  // Human-approved regex fallback is trusted (with warnings); unapproved regex fallback is not.
  const analysisTrusted =
    (analysisIsAi || analysisIsHumanApproved) && !analysisUnsafe && extractionTrusted;

  if (analysisIsRegexFallback) {
    blockers.push("Analysis came from the regex fallback (all AI providers failed) — re-run AI Analyze or approve the fallback via the Controls panel.");
  }
  if (analysisUnsafe && !analysisIsRegexFallback) {
    blockers.push(`Analysis quality is ${analysisSeverity} — re-run AI Analyze to obtain a reliable result.`);
  }
  if (analysisIsHumanApproved && !analysisUnsafe) {
    warnings.push("Analysis is from a human-approved regex fallback — generation is allowed but results should be independently verified.");
  }

  // ── Requirements trust ────────────────────────────────────────────────────
  const rawRequirementsCount = requirements.length;

  const mandatoryRequirementsCount = requirements.filter((r) =>
    /mandatory/i.test(r.priority ?? ""),
  ).length;

  const isSourceTraced = (r: NonNullable<TenderReadinessInput["requirements"]>[0]): boolean =>
    (r.sourcePageNumber != null && r.sourcePageNumber > 0) ||
    Boolean((r.sourceExactQuote ?? "").trim()) ||
    Boolean((r.sectionReference ?? "").trim()) ||
    (r.sourceConfidence != null && r.sourceConfidence > 0);

  const sourceTracedRequirementsCount = requirements.filter(isSourceTraced).length;

  const mandatoryTracedCount = requirements.filter(
    (r) => /mandatory/i.test(r.priority ?? "") && isSourceTraced(r),
  ).length;

  // Requirements come from the analysis — if analysis is untrusted, so are requirements.
  const trustedRequirementsCount = analysisTrusted ? rawRequirementsCount : 0;

  const requirementsTrusted =
    analysisTrusted &&
    rawRequirementsCount > 0 &&
    // When mandatory requirements exist, at least one must be source-traced.
    (mandatoryRequirementsCount === 0 || mandatoryTracedCount > 0);

  if (rawRequirementsCount === 0) {
    blockers.push("No requirements extracted — run AI Analyze to extract requirements from the tender document.");
  } else if (!analysisTrusted) {
    blockers.push("Requirements cannot be trusted because the analysis source is not reliable — resolve the analysis blocker first.");
  } else if (mandatoryRequirementsCount > 0 && mandatoryTracedCount === 0) {
    blockers.push(
      `${mandatoryRequirementsCount} mandatory requirement(s) exist but none have source traceability (page / quote / section reference) — re-run AI Analyze.`,
    );
  }

  // ── Metadata trust ────────────────────────────────────────────────────────
  const effectiveClientName =
    (input.clientName ?? "").trim() || (input.procuringEntityName ?? "").trim();
  const titleValue = (input.title ?? "").trim();

  const clientNameMissing = !effectiveClientName;
  const titleMissing = titleValue.length < 3;
  const metadataContaminated = input.metadataContaminated === true;

  const metadataTrusted = !clientNameMissing && !titleMissing && !metadataContaminated;

  if (clientNameMissing) {
    blockers.push("Client/procuring entity name is missing — fill in Tender Detail before generating documents.");
  }
  if (titleMissing) {
    blockers.push("Tender title is missing or too short — fill in Tender Detail before generating documents.");
  }
  if (metadataContaminated) {
    blockers.push("Client/entity name may be contaminated by portal noise — review and correct in Tender Detail.");
  }

  // ── Submission plan presence ──────────────────────────────────────────────
  const hasExplicitFileNaming = Boolean((input.exactFileNaming ?? "").trim()) &&
    (input.exactFileNaming ?? "") !== "[]";
  const hasExplicitFileOrder = Boolean((input.exactFileOrder ?? "").trim()) &&
    (input.exactFileOrder ?? "") !== "[]";
  const hasRequirementsWithFileNames = requirements.some((r) =>
    Boolean((r.exactFileName ?? "").trim()),
  );

  const submissionPlanBuilt =
    hasExplicitFileNaming || hasExplicitFileOrder || hasRequirementsWithFileNames;

  if (!submissionPlanBuilt && mandatoryRequirementsCount > 0) {
    warnings.push(
      "Submission plan has not been built — run Build Plan to create a file list before generating documents.",
    );
  }

  // ── Analysis hash (staleness detection) ───────────────────────────────────
  const currentAnalysisHash = deriveAnalysisHash({
    extractionStatus,
    analysisSource,
    requirementCount: rawRequirementsCount,
    mandatoryCount: mandatoryRequirementsCount,
    sourceTracedCount: sourceTracedRequirementsCount,
  });

  // ── Document staleness ─────────────────────────────────────────────────────
  const activeDocs = (input.generatedDocuments ?? []).filter(
    (d) => !/SUPERSEDED|PLANNED/i.test(d.generationStatus ?? ""),
  );

  let docsGeneratedFromCurrentAnalysis = true;
  for (const doc of activeDocs) {
    const storedHash = parseDocAnalysisHash(doc.contentSummary);
    if (storedHash !== null && storedHash !== currentAnalysisHash) {
      docsGeneratedFromCurrentAnalysis = false;
      break;
    }
  }

  // ── Compliance current ─────────────────────────────────────────────────────
  // Compliance is only valid when requirements are trusted AND extraction is usable.
  // When requirementsTrusted=false, showing "10/10 compliance" is misleading.
  const complianceCurrent =
    requirementsTrusted &&
    analysisTrusted &&
    !extractionOcrRequired &&
    !extractionCorrupted &&
    !extractionRegexWeak &&
    metadataTrusted;

  if (!complianceCurrent && !requirementsTrusted && rawRequirementsCount > 0) {
    warnings.push(
      "Compliance matrix may not reflect the current state — resolve upstream blockers and re-run compliance.",
    );
  }

  // ── Documents current ──────────────────────────────────────────────────────
  // Documents are only current when the plan exists, requirements are trusted,
  // analysis is trusted, and docs were generated from the current analysis hash.
  const documentsCurrent =
    submissionPlanBuilt &&
    requirementsTrusted &&
    analysisTrusted &&
    docsGeneratedFromCurrentAnalysis;

  if (submissionPlanBuilt && requirementsTrusted && analysisTrusted && !docsGeneratedFromCurrentAnalysis && activeDocs.length > 0) {
    warnings.push(
      "Generated documents may be based on stale analysis — regenerate documents after re-running AI Analyze.",
    );
  }

  // ── Export allowed ─────────────────────────────────────────────────────────
  const exportAllowed =
    extractionTrusted &&
    analysisTrusted &&
    requirementsTrusted &&
    metadataTrusted &&
    submissionPlanBuilt &&
    documentsCurrent;

  return {
    extractionTrusted,
    analysisTrusted,
    requirementsTrusted,
    metadataTrusted,
    submissionPlanBuilt,
    complianceCurrent,
    documentsCurrent,
    exportAllowed,
    rawRequirementsCount,
    trustedRequirementsCount,
    sourceTracedRequirementsCount,
    mandatoryRequirementsCount,
    mandatoryTracedCount,
    currentAnalysisHash,
    docsGeneratedFromCurrentAnalysis,
    blockers,
    warnings,
  };
}

// ── Helpers (exported for tests and for document-generation write path) ───────

/**
 * Derive a deterministic change-detection hash from the key analysis state fields.
 * Not cryptographic — only used to detect whether the analysis has changed since
 * documents were last generated.
 */
export function deriveAnalysisHash(state: {
  extractionStatus: string;
  analysisSource: string;
  requirementCount: number;
  mandatoryCount: number;
  sourceTracedCount: number;
}): string {
  const str = [
    state.extractionStatus,
    state.analysisSource,
    state.requirementCount,
    state.mandatoryCount,
    state.sourceTracedCount,
  ].join("|");
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i);
  }
  return `v1:${(h >>> 0).toString(16)}`;
}

/**
 * Extract the analysisHash written into GeneratedDocument.contentSummary at generation time.
 * Returns null when the field is absent, unparseable, or was written without a hash.
 */
export function parseDocAnalysisHash(contentSummary: string | null | undefined): string | null {
  if (!contentSummary) return null;
  try {
    const obj = JSON.parse(contentSummary) as Record<string, unknown>;
    if (typeof obj?.analysisHash === "string" && obj.analysisHash.length > 0) {
      return obj.analysisHash;
    }
    return null;
  } catch {
    return null;
  }
}
