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

import {
  DOCUMENT_PLACEHOLDER_PATTERNS as _DOCUMENT_PLACEHOLDER_PATTERNS,
  METADATA_PLACEHOLDER_PATTERNS,
} from "./detection-patterns";
// Re-export so existing callers that import METADATA_PLACEHOLDER_PATTERNS from
// this module continue to work. The canonical declaration lives in
// detection-patterns.ts — keeping a single source of truth prevents the two
// copies from drifting (they were byte-for-byte identical before this change).
export { METADATA_PLACEHOLDER_PATTERNS };
// Submission-method classification lives in the neutral submission-method-policy
// module so the policy registry, the canonical field-state resolver, and this
// completeness gate all share ONE definition (no duplicated regex that could
// drift between gates).
import {
  isPhysicalSubmissionMethod,
  isEmailSubmissionMethod,
} from "./submission-method-policy";

// Criticality classification here is kept in lock-step with the canonical
// tender-policy registry (lib/engine/tender-policy-registry.ts), which imports
// this module's submission-method predicates. The always-critical set enforced
// at runtime below — clientName, title, submissionMethod, submissionEndpoint,
// deadline, requiredDocuments, plus submissionAddress when the method is
// physical — is exactly the registry's set. evaluationCriteria and reference
// are non-critical in both (Manual Override & Evidence Policy point 7).
export type CriticalMetadataField =
  | "clientName"
  | "title"
  | "submissionMethod"
  | "submissionEndpoint"
  | "submissionAddress"
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
  | "preBidMeetingLocation"
  | "clientCity"
  | "clientAddress"
  | "clientWebsite"
  | "submissionEmailSubject"
  | "preBidChannel"
  | "clientRepresentative"
  // CLAUDE.md items 2-4: entity-identity fields
  | "legalClientName"
  | "donorAgency"
  | "implementingAgency";

export type MetadataCompletenessInput = {
  // Top-level tender fields
  clientName?: string | null;
  /** Canonical procuring-entity name extracted by AI. Used as fallback for
   *  the clientName gate so a tender with procuringEntityName set (but
   *  clientName not yet back-filled) is not incorrectly blocked. */
  procuringEntityName?: string | null;
  title?: string | null;
  reference?: string | null;
  country?: string | null;
  submissionMethod?: string | null;
  submissionAddress?: string | null;
  submissionEmails?: string | null;
  metadataContaminated?: boolean | null;
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
  // Extended client fields (CLAUDE.md items 8–19)
  clientCity?: string | null;
  clientAddress?: string | null;
  clientWebsite?: string | null;
  submissionEmailSubject?: string | null;
  preBidChannel?: string | null;
  clientRepresentative?: string | null;
  // CLAUDE.md items 2–4: entity-identity disambiguation fields
  legalClientName?: string | null;
  donorAgency?: string | null;
  implementingAgency?: string | null;

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
  /** Fields explicitly marked NOT_APPLICABLE by user override. */
  notApplicableFields: MetadataFieldFinding[];
  /** Fields containing "Bid-Team to confirm" or similar placeholders. */
  invalidFields: MetadataFieldFinding[];
  /** Convenience flags. */
  blockingForGeneration: boolean;
  blockingForExport: boolean;
  /** Total placeholder hits across all string fields. */
  placeholderCount: number;
  /** True when the submission deadline is in the past. Warning only — does not block generation. */
  deadlinePassed: boolean;
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
  { rx: /\bStatus\s*:?\s*(?:CLOSED|OPEN|PENDING|AWARDED|CANCELLED|SUSPENDED)\b/i, signal: "TENDER_PORTAL_STATUS_BANNER" },
  { rx: /\brelated\s+tender\s+alerts?\b/i, signal: "TENDER_PORTAL_RELATED_ALERTS" },
  { rx: /\btender\s+alerts?\s+(?:for|from)\b/i, signal: "TENDER_PORTAL_ALERTS_FEED" },
  { rx: /\bview\s+tender\b/i, signal: "TENDER_PORTAL_NAV_LINK" },
  { rx: /\bclick\s+here\s+to\s+(?:view|download)\b/i, signal: "PORTAL_CALL_TO_ACTION" },
  { rx: /\bSubscribe\s+to\s+Tender\s+Alerts\b/i, signal: "PORTAL_SUBSCRIBE_LINK" },
  // Breadcrumb / navigation fragments scraped from portal pages
  { rx: /\bHome\s*[>\/»]\s*Tender/i, signal: "PORTAL_BREADCRUMB" },
  { rx: /\bTenders?\s*[>\/»]\s*/i, signal: "PORTAL_BREADCRUMB" },
  // Pagination / search-result noise
  { rx: /\bShowing\s+\d+\s+(?:of|to)\s+\d+\s+(?:results?|tenders?)\b/i, signal: "PORTAL_SEARCH_RESULTS_NOISE" },
  { rx: /\b(?:Previous|Next)\s+Tender\b/i, signal: "PORTAL_PAGINATION_NOISE" },
  // Bidder-registration / login prompts scraped from portal pages
  { rx: /\bLogin\s*[\/|]\s*Register\b/i, signal: "PORTAL_AUTH_NAVIGATION" },
  { rx: /\bBidder\s+Registration\b/i, signal: "PORTAL_BIDDER_REGISTRATION_NAV" },
  // Closing / opening date labels that bleed into client name from structured scrapes
  { rx: /\bClosing\s+Date\s*:/i, signal: "PORTAL_DATE_LABEL_BLEED" },
  { rx: /\bOpening\s+Date\s*:/i, signal: "PORTAL_DATE_LABEL_BLEED" },
  { rx: /\bDeadline\s*:\s*\d/i, signal: "PORTAL_DATE_LABEL_BLEED" },
  // Reference-number labels that bleed into entity name field
  { rx: /\bReference\s+(?:No|Number)\s*:/i, signal: "PORTAL_REFERENCE_LABEL_BLEED" },
  // "Print" / "Share" standalone portal nav items (only flag as noise in short values)
  { rx: /^\s*(?:Print|Share|Download|Save)\s*$/i, signal: "PORTAL_ACTION_BUTTON_TEXT" },
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

/** Document-level placeholder patterns — canonical set from detection-patterns.ts.
 *  Re-exported here so modules importing from this file automatically get the
 *  comprehensive production-grade set (31+ patterns) rather than the old local
 *  subset (18 patterns). Single source of truth is detection-patterns.ts. */
export const DOCUMENT_PLACEHOLDER_PATTERNS: RegExp[] = _DOCUMENT_PLACEHOLDER_PATTERNS;

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

// Re-exported to preserve the public import surface used by existing
// callers/tests (they import these predicates from this module).
export { isPhysicalSubmissionMethod, isEmailSubmissionMethod };

export function assessTenderMetadataCompleteness(
  input: MetadataCompletenessInput,
  overrides?: Array<{ field: string; fieldState: string; overrideValue?: string | null }>,
): MetadataCompletenessReport {
  const missingCritical: MetadataFieldFinding[] = [];
  const missingNonCritical: MetadataFieldFinding[] = [];
  const notApplicableFields: MetadataFieldFinding[] = [];
  const invalidFields: MetadataFieldFinding[] = [];
  const notes: string[] = [];

  // Build a fast override lookup by field name.
  const overrideByField = new Map<string, { fieldState: string; overrideValue?: string | null }>();
  if (overrides) {
    for (const o of overrides) {
      overrideByField.set(o.field, o);
    }
  }

  // Returns true when a field has a user-override that resolves it (not blocking).
  const isOverrideResolved = (field: string): boolean => {
    const o = overrideByField.get(field);
    if (!o) return false;
    return ["NOT_APPLICABLE", "USER_CONFIRMED", "USER_EDITED", "IGNORED_WITH_REASON"].includes(o.fieldState);
  };

  // Returns true when a field has a NOT_APPLICABLE override specifically.
  const isNotApplicable = (field: string): boolean => {
    const o = overrideByField.get(field);
    return o?.fieldState === "NOT_APPLICABLE";
  };

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
    if (!isValidPresent(value)) {
      if (isNotApplicable(field)) {
        notApplicableFields.push({ field, reason });
      } else if (!isOverrideResolved(field)) {
        missingCritical.push({ field, reason });
      }
      // USER_CONFIRMED / USER_EDITED / IGNORED_WITH_REASON → not blocking, not in any list
    }
  };

  // Accept either clientName or procuringEntityName — if the AI set procuringEntityName
  // but the back-fill into clientName hasn't run yet, do not block generation.
  const effectiveClientName = input.clientName || input.procuringEntityName;
  checkCritical("clientName", effectiveClientName, "Client / procuring entity name is required for cover letter and declarations.");
  checkCritical("title", input.title, "Tender title is required throughout the proposal.");
  checkCritical("submissionMethod", input.submissionMethod, "Submission method (portal / sealed envelope / email) drives package mode and final ZIP behaviour.");
  // submissionEndpoint = either an email list, a submission address, or a portal URL
  const hasAnyEndpoint = isValidPresent(input.submissionEmails) || isValidPresent(input.submissionAddress);
  if (!hasAnyEndpoint) {
    const endpointField = "submissionEndpoint";
    if (isNotApplicable(endpointField)) {
      notApplicableFields.push({ field: endpointField, reason: "Submission endpoint (email or address) is required for the cover letter and submission package label." });
    } else if (!isOverrideResolved(endpointField)) {
      missingCritical.push({ field: endpointField, reason: "Submission endpoint (email or address) is required for the cover letter and submission package label." });
    }
  }
  checkCritical("deadline", input.deadline, "Submission deadline is required for scheduling and final approval rules.");
  if ((input.requirementCount ?? 0) === 0) {
    const reqField = "requiredDocuments";
    if (!isOverrideResolved(reqField)) {
      missingCritical.push({ field: reqField, reason: "No tender requirements extracted yet — required-document list is empty." });
    }
  }
  if (input.hasEvaluationMethodology !== true && (input.technicalWeight === null || input.technicalWeight === undefined)) {
    const evalField = "evaluationCriteria";
    if (isNotApplicable(evalField)) {
      notApplicableFields.push({ field: evalField, reason: "Evaluation criteria / scoring weights were not issued in this tender." });
    } else if (!isOverrideResolved(evalField)) {
      missingNonCritical.push({ field: evalField, reason: "Evaluation criteria / scoring weights were not extracted. Confirm manually when the tender is scored; otherwise mark not applicable or ignore for this tender." });
    }
  }

  // ── Non-critical fields (surfaced as warnings, not blockers). ───────────
  const checkNonCritical = (field: NonCriticalMetadataField, value: unknown, reason: string) => {
    if (!isValidPresent(value) && !isOverrideResolved(field)) {
      missingNonCritical.push({ field, reason });
    }
  };

  checkNonCritical("reference", input.reference, "Tender reference number improves identification on the cover letter.");
  checkNonCritical("clientContactName", input.clientContactName, "Client contact name is useful for cover letters and clarifications.");
  checkNonCritical("clientContactEmail", input.clientContactEmail, "Client contact email is useful for clarifications.");
  checkNonCritical("clientContactPhone", input.clientContactPhone, "Client contact phone improves the cover letter.");
  // submissionAddress is critical when the method is physical/sealed — the bidder
  // cannot deliver without a verified delivery address. For email/portal methods
  // it remains a non-critical warning.
  if (isPhysicalSubmissionMethod(input.submissionMethod)) {
    checkCritical("submissionAddress", input.submissionAddress, "Physical submission address is required when the submission method is sealed envelope / hard copy / physical delivery.");
  } else {
    checkNonCritical("submissionAddress", input.submissionAddress, "Physical submission address is useful when sealed envelopes are required.");
  }
  checkNonCritical("submissionEmails", input.submissionEmails, "Submission email list is useful when email submission is allowed.");
  checkNonCritical("country", input.country, "Tender country improves jurisdiction-specific declarations.");
  checkNonCritical("budget", input.budget, "Budget guidance informs financial proposal sizing.");
  checkNonCritical("currency", input.currency, "Currency informs financial declarations.");
  checkNonCritical("numberOfCopiesRequired", input.numberOfCopiesRequired, "Number of submission copies informs the package handout count.");
  checkNonCritical("preBidMeetingDate", input.preBidMeetingDate, "Pre-bid meeting date informs the bid schedule.");
  checkNonCritical("preBidMeetingLocation", input.preBidMeetingLocation, "Pre-bid meeting location informs the bid schedule.");
  checkNonCritical("clientCity", input.clientCity, "City/location of the procuring entity improves address blocks.");
  checkNonCritical("clientAddress", input.clientAddress, "Client physical address is needed for sealed-envelope logistics and declarations.");
  checkNonCritical("clientWebsite", input.clientWebsite, "Procuring entity website is useful for portal submission links.");
  checkNonCritical("submissionEmailSubject", input.submissionEmailSubject, "Required email subject line must appear verbatim in the submission email.");
  checkNonCritical("preBidChannel", input.preBidChannel, "Pre-bid clarification channel informs the questions submission process.");
  checkNonCritical("clientRepresentative", input.clientRepresentative, "Authorized client representative name may be required in declarations.");
  // CLAUDE.md items 2–4: entity-identity disambiguation — surfaced as non-critical warnings
  // so donor-funded tenders can be identified and the correct legal counterparty used.
  checkNonCritical("legalClientName", input.legalClientName, "Full legal client name (if different from display name) is required on formal declarations.");
  checkNonCritical("donorAgency", input.donorAgency, "Donor/funding agency name is needed for donor-compliance cover letters and acknowledgements.");
  checkNonCritical("implementingAgency", input.implementingAgency, "Project owner/implementing agency name is required when different from the procuring entity.");

  // Page limit, bid bond, site visit, validity — track per spec.
  if (!isPresent(input.pageLimit) && !isOverrideResolved("pageLimit")) {
    missingNonCritical.push({ field: "pageLimit", reason: "Page limit is useful when the tender restricts proposal length." });
  }
  if (!isPresent(input.bidBondAmount) && !isOverrideResolved("bidBond")) {
    missingNonCritical.push({ field: "bidBond", reason: "Bid bond amount is useful when a bid security is required." });
  }
  if ((input.mandatorySiteVisit === null || input.mandatorySiteVisit === undefined) && !isOverrideResolved("siteVisit")) {
    missingNonCritical.push({ field: "siteVisit", reason: "Site visit flag is useful when a mandatory site visit is part of the bid timeline." });
  }
  if (!isPresent(input.validityDays) && !isOverrideResolved("proposalValidity")) {
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
    ["clientCity", input.clientCity],
    ["clientAddress", input.clientAddress],
    ["clientWebsite", input.clientWebsite],
    ["submissionEmailSubject", input.submissionEmailSubject],
    ["preBidChannel", input.preBidChannel],
    ["clientRepresentative", input.clientRepresentative],
    ["legalClientName", input.legalClientName],
    ["donorAgency", input.donorAgency],
    ["implementingAgency", input.implementingAgency],
  ];
  let placeholderCount = 0;
  for (const [field, raw] of stringFieldsForScan) {
    // Skip fields the user has explicitly marked NOT_APPLICABLE — they may still
    // have an old placeholder value in the DB column but the override means the
    // user confirmed the field does not apply to this tender.
    if (isNotApplicable(field)) continue;
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
  // Budget and bidBondAmount are FINANCIAL-PROPOSAL-ONLY metadata. Most
  // tenders never publish the ceiling budget and the bond is often expressed
  // as "1% of the bid value" — there is no honest absolute amount to extract.
  // Including them in the auto-fill denominator dragged the coverage ratio
  // below the 60% threshold even on fully-populated tenders, surfacing a
  // misleading "tender metadata is weak" note in the readiness panel.
  // They remain non-critical missing warnings (see checkNonCritical above)
  // but no longer count against the cross-tender auto-fill ratio.
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
    input.mandatorySiteVisit,
    input.validityDays,
  ];
  const present = tracked.filter((v) => isValidPresent(v)).length;
  const overallRatio = present / tracked.length;

  if (input.metadataContaminated === true) {
    notes.push("Client name is contaminated with portal noise or navigation text. This blocks final generation and export until corrected.");
  }
  if (missingCritical.length > 0) {
    notes.push(`${missingCritical.length} critical metadata field(s) missing or placeholder-filled — final generation is blocked until completed.`);
  }
  if (invalidFields.length > 0) {
    notes.push(`${invalidFields.length} field(s) contain internal placeholder language (e.g. "Bid-Team to confirm") and must be cleaned before generation.`);
  }
  if (overallRatio < 0.6) {
    notes.push(`Tender metadata auto-fill coverage is ${Math.round(overallRatio * 100)}% — review missing fields, then mark absent tender-specific fields as not applicable or ignored.`);
  }

  const dl = input.deadline;
  const deadlinePassed =
    dl instanceof Date &&
    !isNaN(dl.getTime()) &&
    dl < new Date();
  if (deadlinePassed && dl) {
    notes.push(`Submission deadline has passed (${dl.toLocaleDateString()}). Confirm with the client whether an extension has been granted before proceeding.`);
  }

  return {
    overallRatio,
    missingCritical,
    missingNonCritical,
    notApplicableFields,
    invalidFields,
    blockingForGeneration: false, // Metadata never blocks draft work
    blockingForExport: missingCritical.length > 0 || invalidFields.length > 0 || input.metadataContaminated === true,
    placeholderCount,
    deadlinePassed,
    notes,
  };
}

export const __testing__ = { isPresent, METADATA_PLACEHOLDER_PATTERNS, looksLikeMetadataPlaceholder };
