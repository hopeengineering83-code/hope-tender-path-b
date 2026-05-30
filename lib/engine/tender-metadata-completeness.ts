// Tender metadata completeness gate.
//
// Screenshots showed an "auto-fill coverage 5/16" tender with fields like
//   - reference number
//   - client contact
//   - submission email/address
//   - deadline
//   - validity
//   - bid bond
//   - copies required
//   - evaluation weights
//   - page limit
//   - mandatory site visit
// either empty or filled with "Bid-Team to confirm". The current
// generation flow happily proceeded with those gaps, then surfaced
// "Bid-Team to confirm" inside the generated proposals themselves.
//
// This module replaces that with a single source of truth:
//
//   assessTenderMetadataCompleteness(tender) -> {
//     overallRatio,        // 0..1, share of REQUIRED fields populated
//     missingCritical,     // critical fields that block final generation
//     missingNonCritical,  // optional fields surfaced for completeness
//     invalidFields,       // fields containing "Bid-Team to confirm" etc.
//     blockingForGeneration,
//     blockingForExport,
//     placeholderCount,
//   }
//
// Used by:
//   - lib/engine/readiness-scoring.ts (metadataCompletenessRatio cap)
//   - lib/engine/final-submission-readiness.ts (tender-level blocker
//     for METADATA_INCOMPLETE_FOR_FINAL_GENERATION)
//   - generated-document quality gate (rejects "Bid-Team to confirm")

export const METADATA_PLACEHOLDER_PATTERNS: RegExp[] = [
  /\bbid[\s-]?team\s+to\s+confirm\b/i,
  /\bto\s+be\s+(?:confirmed|determined|provided|completed|inserted)\b/i,
  /\b(?:tbd|tbc|tba)\b/i,
  /\b(?:not\s+provided|not\s+available|not\s+specified|unknown)\b/i,
  /\bn\/?a\b/i,
  /\bplaceholder\b/i,
  /\b(?:insert|add|fill)\b.{0,40}\b(?:here|later|manually)\b/i,
  /\b\[?fill[\s_-]?in\]?/i,
  /\bexact\s+site\s+to\s+be\s+determined\b/i,
  /\bwith\s+consultant'?s\s+assistance\b/i,
];

export type CriticalMetadataField =
  | "clientName"
  | "title"
  | "submissionMethod"
  | "submissionEndpoint"
  | "deadline"
  | "requiredDocuments"
  | "evaluationCriteria"
  | "pageLimit"
  | "bidBond"
  | "siteVisit"
  | "proposalValidity";

export type NonCriticalMetadataField =
  | "reference"
  | "clientContactName"
  | "clientContactEmail"
  | "clientContactPhone"
  | "submissionAddress"
  | "submissionEmails"
  | "country"
  | "budget"
  | "currency"
  | "numberOfCopiesRequired"
  | "preBidMeetingDate"
  | "preBidMeetingLocation";

export type MetadataCompletenessInput = {
  // Top-level tender fields
  clientName?: string | null;
  title?: string | null;
  reference?: string | null;
  country?: string | null;
  submissionMethod?: string | null;
  submissionAddress?: string | null;
  submissionEmails?: string | null;
  deadline?: Date | null;
  clientContactName?: string | null;
  clientContactEmail?: string | null;
  clientContactPhone?: string | null;
  pageLimit?: number | null;
  budget?: number | null;
  currency?: string | null;
  validityDays?: number | null;
  bidBondAmount?: number | null;
  bidBondCurrency?: string | null;
  mandatorySiteVisit?: boolean | null;
  numberOfCopiesRequired?: number | null;
  preBidMeetingDate?: Date | null;
  preBidMeetingLocation?: string | null;
  technicalWeight?: number | null;
  financialWeight?: number | null;

  // Derived inputs (so we don't need to redo SQL)
  /** Total number of requirement rows extracted from the tender. */
  requirementCount?: number | null;
  /** Whether the tender mentions an evaluation methodology / scoring criteria. */
  hasEvaluationMethodology?: boolean | null;
  /** Whether any submission rule signals were extracted (deadline / address / email / portal). */
  hasSubmissionRules?: boolean | null;
};

export type MetadataFieldFinding = {
  field: string;
  reason: string;
};

export type MetadataCompletenessReport = {
  /** 0..1, share of REQUIRED critical fields populated. */
  overallRatio: number;
  /** Critical fields that are missing — blocks final generation/export. */
  missingCritical: MetadataFieldFinding[];
  /** Non-critical fields that are missing — surfaced as warnings only. */
  missingNonCritical: MetadataFieldFinding[];
  /** Fields containing "Bid-Team to confirm" or similar placeholders. */
  invalidFields: MetadataFieldFinding[];
  /** Convenience flags. */
  blockingForGeneration: boolean;
  blockingForExport: boolean;
  /** Total placeholder hits across all string fields. */
  placeholderCount: number;
  /** Free-form list of explainer notes for the readiness panel. */
  notes: string[];
};

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === "boolean") return value !== null && value !== undefined;
  return Boolean(value);
}

export function looksLikeMetadataPlaceholder(value?: string | null): boolean {
  if (!value || typeof value !== "string") return false;
  const text = value.trim();
  if (text.length === 0) return false;
  // Do not treat a legitimate acronym-only response as placeholder when the
  // field is a long descriptive field; for short fields, the patterns above
  // still catch exact "TBD/TBC/N/A" style placeholders.
  return METADATA_PLACEHOLDER_PATTERNS.some((rx) => rx.test(text));
}

// Polluted-text detection — distinct from placeholder detection. The
// production screenshots showed metadata fields polluted with scraped
// tender-portal navigation text ("Status CLOSED", "related tender alerts",
// "View Tender") and adjacent unrelated tender headings. These markers are
// CONTAMINATION (wrong content from a scrape), not placeholders.
//
// Conservative on purpose — must not reject legitimate long descriptions.
// Returns the first matching contamination signal, or null when the value
// looks clean.
export const METADATA_CONTAMINATION_PATTERNS: Array<{ rx: RegExp; signal: string }> = [
  { rx: /\bStatus\s*:?\s*(?:CLOSED|OPEN|PENDING)\b/i, signal: "TENDER_PORTAL_STATUS_BANNER" },
  { rx: /\brelated\s+tender\s+alerts?\b/i, signal: "TENDER_PORTAL_RELATED_ALERTS" },
  { rx: /\btender\s+alerts?\s+(?:for|from)\b/i, signal: "TENDER_PORTAL_ALERTS_FEED" },
  { rx: /\bview\s+tender\b/i, signal: "TENDER_PORTAL_NAV_LINK" },
  { rx: /\bclick\s+here\s+to\s+(?:view|download)\b/i, signal: "PORTAL_CALL_TO_ACTION" },
  { rx: /\bSubscribe\s+to\s+Tender\s+Alerts\b/i, signal: "PORTAL_SUBSCRIBE_LINK" },
];

export function detectMetadataContamination(value?: string | null): { contaminated: boolean; signal: string | null } {
  if (!value || typeof value !== "string") return { contaminated: false, signal: null };
  const text = value.trim();
  if (text.length === 0) return { contaminated: false, signal: null };
  for (const { rx, signal } of METADATA_CONTAMINATION_PATTERNS) {
    if (rx.test(text)) return { contaminated: true, signal };
  }
  // Heuristic: a SHORT field (≤300 chars) containing ≥3 distinct ALL-CAPS
  // heading-style lines is almost always a scrape, not a legitimate value.
  if (text.length <= 300) {
    const allCapsLines = text.split(/\n/).filter((line) => /^[A-Z][A-Z\s]{6,}$/.test(line.trim())).length;
    if (allCapsLines >= 3) return { contaminated: true, signal: "MULTIPLE_HEADING_LINES_IN_SHORT_FIELD" };
  }
  return { contaminated: false, signal: null };
}

/** Document-level placeholder patterns — superset of metadata patterns plus
 *  bracket/template markers common in generated proposal text.
 *  Used by seven-pass-generation-wiring.ts (single canonical source). */
export const DOCUMENT_PLACEHOLDER_PATTERNS: RegExp[] = [
  ...METADATA_PLACEHOLDER_PATTERNS,
  /\[INSERT\b/i,
  /\[ADD\b/i,
  /\bADD HERE\b/i,
  /\bPLACEHOLDER\b/i,
  /\[Company Name\]/i,
  /\[Client Name\]/i,
  /\[DATE\]/i,
  /\[YEAR\]/i,
  /\[AMOUNT\]/i,
  /\[NUMBER\]/i,
  // Seven-pass wiring patterns (merged from seven-pass-generation-wiring.ts)
  /Bid-Team\s+Action/i,
  /Source-evidence\s+action/i,
  /\bTODO\b/,
  /\[CLIENT\s+TO\s+BE\s+CONFIRMED[^\]]*\]/i,
  /\[(insert|add here|fill|name of|date here|signature here|stamp here|tbd|tbc)[^\]]*\]/i,
  /PLACEHOLDER FOR TENDER-ISSUED ORIGINAL/i,
];

/**
 * Counts placeholder occurrences in document content.
 * Returns 0 for empty/null content (safe to call on any stored text).
 */
export function detectDocumentPlaceholders(content?: string | null): number {
  if (!content || typeof content !== "string") return 0;
  let count = 0;
  for (const rx of DOCUMENT_PLACEHOLDER_PATTERNS) {
    const matches = content.match(new RegExp(rx.source, rx.flags + (rx.flags.includes("g") ? "" : "g")));
    if (matches) count += matches.length;
  }
  return count;
}

/**
 * Removes any metadata placeholder phrase ("Bid-Team to confirm", "TBC", etc.)
 * from a candidate string. Used by the document quality gate so generated
 * proposals never include internal placeholder language.
 */
export function stripMetadataPlaceholders(value: string): string {
  let out = value;
  for (const rx of METADATA_PLACEHOLDER_PATTERNS) {
    out = out.replace(new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : `${rx.flags}g`), "");
  }
  return out.replace(/\s{2,}/g, " ").replace(/\s*[,;:.]\s*[,;:.]/g, ".").trim();
}

export function assessTenderMetadataCompleteness(input: MetadataCompletenessInput): MetadataCompletenessReport {
  const missingCritical: MetadataFieldFinding[] = [];
  const missingNonCritical: MetadataFieldFinding[] = [];
  const invalidFields: MetadataFieldFinding[] = [];
  const notes: string[] = [];

  const isValidPresent = (value: unknown): boolean => {
    if (!isPresent(value)) return false;
    if (typeof value === "string" && looksLikeMetadataPlaceholder(value)) return false;
    return true;
  };

  // ── Critical fields. ─────────────────────────────────────────────────────
  // A critical field missing means the generated proposal cannot accurately
  // address the procuring entity or the submission deadline / rules.
  const checkCritical = (
    field: CriticalMetadataField,
    value: unknown,
    reason: string,
  ) => {
    if (!isValidPresent(value)) missingCritical.push({ field, reason });
  };

  checkCritical("clientName", input.clientName, "Client / procuring entity name is required for cover letter and declarations.");
  checkCritical("title", input.title, "Tender title is required throughout the proposal.");
  checkCritical("submissionMethod", input.submissionMethod, "Submission method (portal / sealed envelope / email) drives package mode and final ZIP behaviour.");
  // submissionEndpoint = either an email list, a submission address, or a portal URL
  const hasAnyEndpoint = isValidPresent(input.submissionEmails) || isValidPresent(input.submissionAddress);
  if (!hasAnyEndpoint) missingCritical.push({ field: "submissionEndpoint", reason: "Submission endpoint (email or address) is required for the cover letter and submission package label." });
  checkCritical("deadline", input.deadline, "Submission deadline is required for scheduling and final approval rules.");
  if ((input.requirementCount ?? 0) === 0) {
    missingCritical.push({ field: "requiredDocuments", reason: "No tender requirements extracted yet — required-document list is empty." });
  }
  if (input.hasEvaluationMethodology !== true && (input.technicalWeight === null || input.technicalWeight === undefined)) {
    missingCritical.push({ field: "evaluationCriteria", reason: "Evaluation criteria / scoring weights are not extracted — needed for scored tenders." });
  }

  // ── Non-critical fields (surfaced as warnings, not blockers). ───────────
  const checkNonCritical = (field: NonCriticalMetadataField, value: unknown, reason: string) => {
    if (!isValidPresent(value)) missingNonCritical.push({ field, reason });
  };

  checkNonCritical("reference", input.reference, "Tender reference number improves identification on the cover letter.");
  checkNonCritical("clientContactName", input.clientContactName, "Client contact name is useful for cover letters and clarifications.");
  checkNonCritical("clientContactEmail", input.clientContactEmail, "Client contact email is useful for clarifications.");
  checkNonCritical("clientContactPhone", input.clientContactPhone, "Client contact phone improves the cover letter.");
  checkNonCritical("submissionAddress", input.submissionAddress, "Physical submission address is useful when sealed envelopes are required.");
  checkNonCritical("submissionEmails", input.submissionEmails, "Submission email list is useful when email submission is allowed.");
  checkNonCritical("country", input.country, "Tender country improves jurisdiction-specific declarations.");
  checkNonCritical("budget", input.budget, "Budget guidance informs financial proposal sizing.");
  checkNonCritical("currency", input.currency, "Currency informs financial declarations.");
  checkNonCritical("numberOfCopiesRequired", input.numberOfCopiesRequired, "Number of submission copies informs the package handout count.");
  checkNonCritical("preBidMeetingDate", input.preBidMeetingDate, "Pre-bid meeting date informs the bid schedule.");
  checkNonCritical("preBidMeetingLocation", input.preBidMeetingLocation, "Pre-bid meeting location informs the bid schedule.");

  // Page limit, bid bond, site visit, validity — track per spec.
  if (!isPresent(input.pageLimit)) {
    missingNonCritical.push({ field: "pageLimit", reason: "Page limit is useful when the tender restricts proposal length." });
  }
  if (!isPresent(input.bidBondAmount)) {
    missingNonCritical.push({ field: "bidBond", reason: "Bid bond amount is useful when a bid security is required." });
  }
  if (input.mandatorySiteVisit === null || input.mandatorySiteVisit === undefined) {
    missingNonCritical.push({ field: "siteVisit", reason: "Site visit flag is useful when a mandatory site visit is part of the bid timeline." });
  }
  if (!isPresent(input.validityDays)) {
    missingNonCritical.push({ field: "proposalValidity", reason: "Proposal validity period is useful for the cover letter and declarations." });
  }

  // ── Invalid placeholder detection. ───────────────────────────────────────
  // Anything containing "Bid-Team to confirm" / "TBC" etc. counts as
  // invalid — it would otherwise leak into generated proposals verbatim.
  const stringFieldsForScan: Array<[string, unknown]> = [
    ["clientName", input.clientName],
    ["title", input.title],
    ["reference", input.reference],
    ["country", input.country],
    ["submissionMethod", input.submissionMethod],
    ["submissionAddress", input.submissionAddress],
    ["submissionEmails", input.submissionEmails],
    ["clientContactName", input.clientContactName],
    ["clientContactEmail", input.clientContactEmail],
    ["clientContactPhone", input.clientContactPhone],
    ["currency", input.currency],
    ["bidBondCurrency", input.bidBondCurrency],
    ["preBidMeetingLocation", input.preBidMeetingLocation],
  ];
  let placeholderCount = 0;
  for (const [field, raw] of stringFieldsForScan) {
    if (typeof raw === "string" && looksLikeMetadataPlaceholder(raw)) {
      invalidFields.push({ field, reason: `Value "${raw.trim().slice(0, 60)}" is an internal placeholder (e.g. "Bid-Team to confirm", "TBD", "N/A") and must not enter generated proposals.` });
      placeholderCount += 1;
    }
  }

  // ── Compute overall ratio. ───────────────────────────────────────────────
  // Critical-field universe is the 11 fields above (clientName, title,
  // submissionMethod, submissionEndpoint, deadline, requiredDocuments,
  // evaluationCriteria, pageLimit, bidBond, siteVisit, proposalValidity).
  // We count critical AND non-critical present fields so the ratio aligns
  // with the "5/16" auto-fill coverage UI label.
  const tracked: Array<unknown> = [
    input.clientName,
    input.title,
    input.reference,
    input.country,
    input.submissionMethod,
    input.submissionAddress,
    input.submissionEmails,
    input.deadline,
    input.clientContactName,
    input.clientContactEmail,
    input.clientContactPhone,
    input.pageLimit,
    input.budget,
    input.bidBondAmount,
    input.mandatorySiteVisit,
    input.validityDays,
  ];
  const present = tracked.filter((v) => isValidPresent(v)).length;
  const overallRatio = present / tracked.length;

  if (missingCritical.length > 0) {
    notes.push(`${missingCritical.length} critical metadata field(s) missing or placeholder-filled — final generation is blocked until completed.`);
  }
  if (invalidFields.length > 0) {
    notes.push(`${invalidFields.length} field(s) contain internal placeholder language (e.g. "Bid-Team to confirm") and must be cleaned before generation.`);
  }
  if (overallRatio < 0.6) {
    notes.push(`Tender metadata auto-fill coverage is ${Math.round(overallRatio * 100)}% — below the 60% threshold required for senior-grade generation.`);
  }

  return {
    overallRatio,
    missingCritical,
    missingNonCritical,
    invalidFields,
    blockingForGeneration: missingCritical.length > 0 || invalidFields.length > 0,
    blockingForExport: missingCritical.length > 0 || invalidFields.length > 0,
    placeholderCount,
    notes,
  };
}

export const __testing__ = { isPresent, METADATA_PLACEHOLDER_PATTERNS, looksLikeMetadataPlaceholder };
