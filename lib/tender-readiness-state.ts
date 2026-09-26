import { isFinalExportCandidateDocument } from "./engine/document-output-state";

export type TenderReadinessInput = {
  analysisExtractionStatus?: string | null;
  analysisSource?: string | null;
  analysisSeverity?: "GOOD" | "WARNING" | "POOR" | "UNSAFE" | null;
  notes?: string | null;
  title?: string | null;
  clientName?: string | null;
  procuringEntityName?: string | null;
  reference?: string | null;
  metadataContaminated?: boolean | null;
  requirements?: Array<{ priority?: string | null; sourcePageNumber?: number | null; sourceExactQuote?: string | null; sectionReference?: string | null; sourceConfidence?: number | null; exactFileName?: string | null }>;
  exactFileNaming?: string | null;
  exactFileOrder?: string | null;
  /**
   * Callers may pass the raw tender rows — the current/active subset is
   * selected here with the canonical predicate, not by the caller.
   */
  generatedDocuments?: Array<{
    contentSummary?: string | null;
    generationStatus?: string | null;
    validationStatus?: string | null;
    reviewStatus?: string | null;
    documentType?: string | null;
    format?: string | null;
    name?: string | null;
    exactFileName?: string | null;
  }>;
  complianceGaps?: Array<{ severity: string; isResolved: boolean }>;
};

export type TenderReadinessState = {
  extractionTrusted: boolean;
  analysisTrusted: boolean;
  requirementsTrusted: boolean;
  metadataTrusted: boolean;
  submissionPlanBuilt: boolean;
  complianceCurrent: boolean;
  documentsCurrent: boolean;
  exportAllowed: boolean;
  rawRequirementsCount: number;
  trustedRequirementsCount: number;
  sourceTracedRequirementsCount: number;
  mandatoryRequirementsCount: number;
  mandatoryTracedCount: number;
  currentAnalysisHash: string;
  docsGeneratedFromCurrentAnalysis: boolean;
  blockers: string[];
  warnings: string[];
};

function mandatory(priority?: string | null) { return /mandatory|critical/i.test(priority ?? ""); }
export function traced(r: NonNullable<TenderReadinessInput["requirements"]>[0]) {
  return (r.sourcePageNumber != null && r.sourcePageNumber > 0) || Boolean((r.sourceExactQuote ?? "").trim()) || Boolean((r.sectionReference ?? "").trim()) || (r.sourceConfidence != null && r.sourceConfidence > 0);
}

/**
 * Detect analysis source from tender.notes. Same logic as detectAnalysisSource
 * in lib/engine/analysis-source.ts but inlined here to avoid a circular import.
 * Returns "AI", "REGEX_FALLBACK_AI_ERROR", or "UNKNOWN".
 */
function detectAnalysisSourceFromNotes(notes?: string | null): string {
  if (!notes) return "UNKNOWN";
  if (/^analysis\s+source:\s*regex\s+fallback\b/im.test(notes)) return "REGEX_FALLBACK_AI_ERROR";
  if (/^analysis\s+source:\s*ai\b/im.test(notes)) return "AI";
  return "UNKNOWN";
}

export function computeTenderReadinessState(input: TenderReadinessInput): TenderReadinessState {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const extractionStatus = (input.analysisExtractionStatus ?? "").toUpperCase();
  // CRITICAL FIX (investigation FM-008): the previous code read
  // (input.analysisSource ?? "UNKNOWN") which does NOT exist on the Tender
  // model in production. In production this was always "UNKNOWN", making
  // analysisTrusted always false, which blocked all downstream readiness.
  // Now reads the actual tender.notes marker via detectAnalysisSource.
  // Falls back to input.analysisSource for legacy callers that set it directly.
  const detectedSource = detectAnalysisSourceFromNotes(input.notes);
  const analysisSource = (detectedSource === "UNKNOWN" && input.analysisSource
    ? input.analysisSource.toUpperCase()
    : detectedSource.toUpperCase());
  const reqs = input.requirements ?? [];
  const gaps = input.complianceGaps ?? [];

  const extractionBlocked = /EXTRACTION_CORRUPTED|EXTRACTION_WEAK_REVIEW_REQUIRED|OCR_REQUIRED|REGEX_FALLBACK_FROM_WEAK_EXTRACTION|PARTIAL_EXTRACTION_AI_ANALYZED|AI_ANALYSIS_PARTIAL/.test(extractionStatus);
  const extractionTrusted = !extractionBlocked;
  if (extractionBlocked) blockers.push("Extraction is not reliable enough for final readiness.");

  const analysisFallback = /REGEX_FALLBACK/.test(analysisSource);
  const analysisUnsafe = input.analysisSeverity === "UNSAFE" || input.analysisSeverity === "POOR";
  const analysisTrusted = analysisSource === "AI" && !analysisUnsafe && extractionTrusted;
  if (analysisFallback) blockers.push("Regex fallback is draft-review only unless an explicit final admin override exists.");
  if (analysisUnsafe) blockers.push("AI analysis quality is unsafe or poor.");

  const rawRequirementsCount = reqs.length;
  const sourceTracedRequirementsCount = reqs.filter(traced).length;
  const mandatoryRequirementsCount = reqs.filter((r) => mandatory(r.priority)).length;
  const mandatoryTracedCount = reqs.filter((r) => mandatory(r.priority) && traced(r)).length;
  const trustedRequirementsCount = analysisTrusted ? rawRequirementsCount : 0;
  const requirementsTrusted = analysisTrusted && rawRequirementsCount > 0 && sourceTracedRequirementsCount > 0 && (mandatoryRequirementsCount === 0 || mandatoryTracedCount > 0);
  if (!requirementsTrusted) blockers.push("Requirements are missing, untrusted, or not sufficiently source-traced.");

  const titleOk = (input.title ?? "").trim().length >= 3;
  const clientOk = ((input.clientName ?? "").trim() || (input.procuringEntityName ?? "").trim()).length > 0;
  const referenceOk = (input.reference ?? "").trim().length > 0;
  const metadataTrusted = titleOk && clientOk && referenceOk && input.metadataContaminated !== true;
  if (!metadataTrusted) warnings.push("Tender metadata has gaps — advisory only, does not block.");

  const submissionPlanBuilt = Boolean((input.exactFileNaming ?? "").trim() && input.exactFileNaming !== "[]") || Boolean((input.exactFileOrder ?? "").trim() && input.exactFileOrder !== "[]") || reqs.some((r) => Boolean((r.exactFileName ?? "").trim()));
  if (!submissionPlanBuilt) warnings.push("Submission plan is not built.");

  const currentAnalysisHash = deriveAnalysisHash({ extractionStatus, analysisSource, requirementCount: rawRequirementsCount, mandatoryCount: mandatoryRequirementsCount, sourceTracedCount: sourceTracedRequirementsCount });
  // Canonical current-document selection — the same one the export gate, the
  // Final Package Manifest and the Document Validator use. This was a private
  // regex testing generationStatus for SUPERSEDED|PLANNED only, so a QUEUED,
  // STALE, GENERATING or FAILED row, a row whose validationStatus is SUPERSEDED,
  // a NOT_EXPORTABLE / REPLACE_WITH_ORIGINAL row, a CONTROL-format row and an
  // internal draft all counted as active here while every gate treated them as
  // historical. Readiness must not count what the export gate will not ship.
  const activeDocs = (input.generatedDocuments ?? []).filter((d) => isFinalExportCandidateDocument(d));
  const docsGeneratedFromCurrentAnalysis = activeDocs.length > 0 && activeDocs.every((d) => parseDocAnalysisHash(d.contentSummary) === currentAnalysisHash);
  if (activeDocs.length > 0 && !docsGeneratedFromCurrentAnalysis) warnings.push("Generated documents are stale or missing analysisHash.");

  const unresolvedCriticalGaps = gaps.filter(g => !g.isResolved && g.severity === "CRITICAL").length;
  if (unresolvedCriticalGaps > 0) blockers.push(`${unresolvedCriticalGaps} unresolved CRITICAL compliance gap(s).`);

  const complianceCurrent = requirementsTrusted && analysisTrusted && extractionTrusted && unresolvedCriticalGaps === 0;
  const documentsCurrent = activeDocs.length > 0 && submissionPlanBuilt && requirementsTrusted && analysisTrusted && docsGeneratedFromCurrentAnalysis;
  const exportAllowed = extractionTrusted && analysisTrusted && requirementsTrusted && submissionPlanBuilt && documentsCurrent && unresolvedCriticalGaps === 0;

  return { extractionTrusted, analysisTrusted, requirementsTrusted, metadataTrusted, submissionPlanBuilt, complianceCurrent, documentsCurrent, exportAllowed, rawRequirementsCount, trustedRequirementsCount, sourceTracedRequirementsCount, mandatoryRequirementsCount, mandatoryTracedCount, currentAnalysisHash, docsGeneratedFromCurrentAnalysis, blockers, warnings };
}

export function deriveAnalysisHash(state: { extractionStatus: string; analysisSource: string; requirementCount: number; mandatoryCount: number; sourceTracedCount: number }) {
  const str = [state.extractionStatus, state.analysisSource, state.requirementCount, state.mandatoryCount, state.sourceTracedCount].join("|");
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = Math.imul(31, h) + str.charCodeAt(i);
  return `v1:${(h >>> 0).toString(16)}`;
}

export function parseDocAnalysisHash(contentSummary: string | null | undefined): string | null {
  if (!contentSummary) return null;
  try {
    const obj = JSON.parse(contentSummary) as Record<string, unknown>;
    return typeof obj.analysisHash === "string" && obj.analysisHash.length > 0 ? obj.analysisHash : null;
  } catch { return null; }
}
