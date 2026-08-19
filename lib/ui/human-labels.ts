/**
 * Human-readable labels for database field names and error codes.
 */

export const FIELD_LABELS: Record<string, string> = {
  title: "Tender title",
  reference: "Reference number",
  referenceNumber: "Reference number",
  description: "Description",
  deadline: "Submission deadline",
  budget: "Budget",
  currency: "Currency",
  category: "Category",
  country: "Country",
  status: "Status",
  stage: "Stage",
  intakeSummary: "Intake summary",
  analysisSummary: "Analysis summary",
  evaluationMethodology: "Evaluation criteria / scoring",
  evaluationCriteria: "Evaluation criteria / scoring",
  notes: "Notes",
  submissionMethod: "Submission method",
  submissionAddress: "Submission address / portal",
  submissionEmails: "Submission email(s)",
  submissionEmailSubject: "Submission email subject",
  validityDays: "Validity (days)",
  bidBondAmount: "Bid bond amount",
  bidBondCurrency: "Bid bond currency",
  preBidMeetingDate: "Pre-bid meeting date",
  preBidMeetingLocation: "Pre-bid meeting location",
  preBidChannel: "Pre-bid channel",
  mandatorySiteVisit: "Mandatory site visit",
  numberOfCopiesRequired: "Number of copies required",
  technicalWeight: "Technical weight",
  financialWeight: "Financial weight",
  clientName: "Client / procuring entity",
  procuringEntityName: "Client / procuring entity",
  legalClientName: "Full legal client name",
  donorAgency: "Donor / funding agency",
  implementingAgency: "Implementing agency",
  clientContactName: "Contact person",
  clientContactTitle: "Contact title",
  clientContactEmail: "Contact email",
  clientContactPhone: "Contact phone",
  clientAddress: "Client address",
  clientCity: "City / location",
  clientWebsite: "Client website / portal",
  clientRepresentative: "Client representative",
  requiredDocuments: "Required documents / forms",
  exactFileName: "Exact file name",
  exactFileNaming: "Exact file naming",
  exactFileOrder: "Exact file order",
  sectionReference: "Section reference",
  metadataContaminated: "Tender Details contaminated",
  analysisExtractionStatus: "Extraction status",
};

export function fieldLabel(fieldKey: string): string {
  return FIELD_LABELS[fieldKey] ?? fieldKey;
}

export const ERROR_CODE_LABELS: Record<string, string> = {
  MISSING_REQUIRED_SECTION: "Required document is missing",
  MISSING_REQUIRED_DOCUMENT: "Required document is missing",
  PLACEHOLDER_DETECTED: "Placeholder text found in document",
  TODO_FIXME_IN_CONTENT: "Developer notes found in document",
  AI_TRACE_PATTERN: "AI generation traces found in document",
  LOW_WORD_COUNT: "Document is too short",
  EMPTY_DOCUMENT: "Document has no content",
  CONTENT_MISSING: "Document has not been generated or content is missing",
  BLOCKED_REGEX_FALLBACK: "AI analysis used regex fallback — re-run AI analysis",
  BLOCKED_PARTIAL_SUCCESS: "AI analysis is incomplete — re-run to finish",
  BLOCKED_LEGACY_ANALYSIS: "Analysis is outdated — re-run AI analysis",
  BLOCKED_UNPROMOTED: "AI analysis has not been promoted — promote the latest result",
  BLOCKED_FALLBACK_UNAPPROVED: "Fallback analysis requires approval",
  BLOCKED_UNGROUNDED_CRITICAL: "Critical Tender Details lack source evidence",
  BLOCKED_UNGROUNDED_MANDATORY: "Mandatory requirements lack source evidence",
  FALLBACK_NOT_ALLOWED: "Fallback analysis is not allowed for this tender",
  LEGACY_ANALYSIS_BLOCKED: "Legacy analysis is blocked — re-run AI analysis",
  INVALID: "Invalid extracted value",
  GENERIC_FIELD_LABEL: "Generic field label detected",
  INTERNAL_PLACEHOLDER: "Placeholder detected",
  PORTAL_CONTAMINATION: "Contaminated — portal text detected",
  PORTAL_REFERENCE_LABEL_BLEED: "Reference label bled into field",
  AMBIGUOUS_SOURCE_TEXT: "Extracted — review needed",
  EXTRACTED_UNVERIFIED: "Extracted — review evidence",
  NOT_APPLICABLE: "Not applicable",
  IGNORED_WITH_REASON: "Ignored with reason",
  EXPORT_BLOCKED: "Export is blocked",
  TENDER_DELETE_FAILED: "Failed to delete tender",
  // ─── Release / readiness blockers ────────────────────────────────────────
  // These reached the owner as raw UPPER_SNAKE codes in the release panel's
  // "Pending items" list, sitting directly beneath a properly worded sentence
  // about the same problem. They describe workflow state, so they say what is
  // missing and what produces it — without asserting who did or did not act,
  // which the readiness layer cannot know.
  FULL_PROPOSAL_ENGINE_NOT_RUN: "Full proposal is waiting for evidence matching from Run Engine",
  ENGINE_NOT_COMPLETED: "Engine has not finished for this tender revision",
  NO_TENDER_SPECIFIC_EXPERT_MATCHES: "No expert matches exist for this tender yet",
  NO_TENDER_SPECIFIC_PROJECT_MATCHES: "No project matches exist for this tender yet",
  NO_SELECTED_REVIEWED_EXPERTS: "No reviewed experts have been selected as evidence yet",
  NO_SELECTED_REVIEWED_PROJECTS: "No reviewed projects have been selected as evidence yet",
  NO_ACTIVE_GENERATED_DOCUMENTS: "No documents have been generated yet",
  NO_CURRENT_CONFIRMED_BUILD_PLAN: "The submission Build Plan has not been source-verified for this revision",
  NO_REQUIREMENTS: "No tender requirements have been extracted yet",
};

export function errorCodeLabel(code: string): string {
  return ERROR_CODE_LABELS[code] ?? code;
}

/**
 * Label for a release/readiness blocker code shown to the owner.
 *
 * Unlike errorCodeLabel, this NEVER falls through to the raw code: an unmapped
 * blocker is humanised rather than rendered as UPPER_SNAKE next to sentences.
 * A new code added by the readiness layer should read like a gap, not like a log
 * line leaking into the product.
 */
export function releaseBlockerLabel(code: string): string {
  return ERROR_CODE_LABELS[code] ?? humanizeEnumValue(code);
}

/**
 * Render an UPPER_SNAKE enum value as readable text.
 *
 * Label maps are written against the values known when they were written, and
 * the producer keeps shipping new ones. Falling back to the raw value makes the
 * newcomer SHOUT next to its Title Case siblings — which is how a requirement
 * typed FORMAT ended up rendering as "FORMAT" beside "Form" and "Submission".
 * A humanising fallback means an unmapped value still looks like a label.
 */
export function humanizeEnumValue(value: string): string {
  const cleaned = value.trim().replace(/[_-]+/g, " ").toLowerCase();
  if (cleaned.length === 0) return value;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function formatRevision(hash: string | null | undefined): string | null {
  if (!hash || hash.length < 8) return null;
  return `Snapshot ${hash.slice(0, 8)}`;
}
