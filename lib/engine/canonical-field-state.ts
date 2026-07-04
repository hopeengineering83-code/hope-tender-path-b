/**
 * Canonical Metadata Field-State Resolver
 *
 * ONE pure, reusable server-side resolver that returns the effective state
 * of every metadata field. Used by API routes, readiness gates, and UI-read
 * endpoints. Never duplicates logic across panels.
 *
 * Key principle: the same tender field must NEVER be green in one panel
 * and invalid in another. This resolver is the single source of truth.
 */

import {
  ALWAYS_CRITICAL_FIELDS,
  NEVER_NOT_APPLICABLE,
  isCriticalField,
  fieldDisplayLabel,
  type MetadataFieldState as PolicyFieldState,
} from "./tender-policy-registry";
import {
  containsMetadataPlaceholder,
  isValidClientName,
  isValidReferenceNumber,
  isGenericFieldLabel,
  isAmbiguousDateString,
} from "./metadata-validators";
import { isPhysicalSubmissionMethod, isEmailSubmissionMethod, isPortalSubmissionMethod } from "./submission-method-policy";
import { isGroundedEvidence as isGroundedSourceEvidence, isGroundedEvidenceWithFileCheck } from "./evidence-grounding";
// The export/completeness gate's placeholder set is broader than the validators'
// (e.g. "not available", "to be provided", mid-text "TBA", "fill in here"). The
// resolver consults it too so the Client & Submission panel never shows a value
// as valid that the export gate would reject as a placeholder. (We do NOT widen
// the global containsMetadataPlaceholder, because sanitize-stored-metadata nulls
// fields on it and mid-text matches would risk dropping legitimate values.)
import { looksLikeMetadataPlaceholder } from "./tender-metadata-completeness";

// ─── Canonical field-state vocabulary ──────────────────────────────────────

export type CanonicalFieldStatus =
  | "EXTRACTED_AND_GROUNDED"   // Valid value + tender-source evidence (file + page + quote)
  | "EXTRACTED_UNVERIFIED"     // Valid value; missing or incomplete source evidence
  | "MANUAL_OVERRIDE"          // User entered a candidate value (ungrounded; non-critical only)
  | "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED" // User entered value on critical field — blocked until source-grounded
  | "MANUAL_CONFIRMED"         // User confirmed a value; blocks generation on critical fields unless source-grounded
  | "NOT_FOUND_CONFIRMED"       // User confirmed value NOT found in source — blocked for critical fields
  | "NOT_STATED"               // Audited absence — field not stated in tender
  | "NOT_APPLICABLE"           // Field does not apply
  | "AMBIGUOUS_DATE"           // Date format ambiguous
  | "GENERIC_FIELD_LABEL"      // Value is a field heading
  | "INTERNAL_PLACEHOLDER"     // Contains TBD/N/A/etc
  | "PORTAL_CONTAMINATION"     // Entity name polluted by portal/navigation text
  | "INVALID_FORMAT"           // Format validation failed
  | "SOURCE_CONFLICT"          // Multiple contradictory source values detected
  | "INVALID"                  // No value, no override
  | "BLOCKED";                 // Field is blocked from all gates

/**
 * Shared metadata status type. Both the Client & Submission Details panel
 * and the Metadata Truth panel use this single vocabulary — no per-panel
 * status enum divergence is permitted.
 *
 * Migration note: metadata-truth.ts previously defined its own
 * MetadataFactStatus. That type is now an alias of CanonicalFieldStatus so
 * all panels always use the same controlled vocabulary.
 */
export type MetadataFactStatus = CanonicalFieldStatus;

// Entity-identity fields whose value can be contaminated by scraped portal
// navigation / unrelated-tender text (mirrors the Metadata Truth panel and the
// export gate's contamination handling).
const ENTITY_IDENTITY_FIELDS: ReadonlySet<string> = new Set([
  "clientName",
  "procuringEntityName",
]);

export type CanonicalFieldState = {
  fieldKey: string;
  label: string;
  /** The resolved canonical status for this field. */
  status: CanonicalFieldStatus;
  rawValue: string | null;
  effectiveValue: string | null;
  isValid: boolean;
  isGrounded: boolean;
  overrideState: PolicyFieldState | null;
  isManuallyConfirmed: boolean;
  criticality: "always-critical" | "conditionally-critical" | "non-critical";
  /** Hard gate blocker — blocks generation/export when set. */
  blockerReason: string | null;
  /**
   * Soft traceability warning. A valid value that is not yet linked to a
   * source page + quote sets this WITHOUT blocking any gate. Grounding is a
   * quality signal, never a hard generation/export gate (CLAUDE.md blocks on
   * missing/invalid/contaminated critical fields, not on a missing quote).
   */
  evidenceReviewNeeded: boolean;
  warningReason: string | null;
  generationEligible: boolean;
  exportEligible: boolean;
  zipEligible: boolean;
  permittedActions: string[];
  // Evidence
  sourceFileId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  // Audit (for overrides)
  extractionMethod: "text" | "OCR" | "manual" | null;
  confidence: number;
  overriddenBy: string | null;
  overrideReason: string | null;
  overrideTimestamp: Date | null;
};

export type CanonicalFieldStateResult = {
  fields: CanonicalFieldState[];
  hasGenerationBlocker: boolean;
  hasExportBlocker: boolean;
  hasZipBlocker: boolean;
  totalFields: number;
  validFields: number;
  groundedFields: number;
  blockedFields: number;
};

export type CanonicalResolverInput = {
  tender: {
    id: string;
    title: string | null;
    reference: string | null;
    clientName: string | null;
    procuringEntityName: string | null;
    deadline: Date | null;
    currency: string | null;
    country: string | null;
    submissionMethod: string | null;
    submissionAddress: string | null;
    preBidMeetingLocation?: string | null;
    preBidMeetingDate?: string | null;
    preBidChannel?: string | null;
    clientRepresentative?: string | null;
    clientWebsite?: string | null;
    clientAddress?: string | null;
    clientCity?: string | null;
    clientContactPhone?: string | null;
    clientContactTitle?: string | null;
    implementingAgency?: string | null;
    donorAgency?: string | null;
    legalClientName?: string | null;
    evaluationMethodology?: string | null;
    submissionEmails: string | null;
    submissionEmailSubject: string | null;
    clientContactName: string | null;
    clientContactEmail: string | null;
    metadataContaminated?: boolean;
    // Dedicated source-evidence columns for critical fields
    clientNameSourcePage?: number | null;
    clientNameSourceQuote?: string | null;
    clientNameSourceFileId?: string | null;
    submissionMethodSourcePage?: number | null;
    submissionMethodSourceQuote?: string | null;
    submissionMethodSourceFileId?: string | null;
    submissionAddressSourcePage?: number | null;
    submissionAddressSourceQuote?: string | null;
    submissionAddressSourceFileId?: string | null;
    submissionEmailSourcePage?: number | null;
    submissionEmailSourceQuote?: string | null;
    submissionEmailSourceFileId?: string | null;
    titleSourcePage?: number | null;
    titleSourceQuote?: string | null;
    titleSourceFileId?: string | null;
    deadlineSourcePage?: number | null;
    deadlineSourceQuote?: string | null;
    deadlineSourceFileId?: string | null;
    // Catch-all for non-critical fields or prior-extraction formats
    contactDetailsSourceJson?: unknown;
  };
  overrides: {
    field: string;
    fieldState: PolicyFieldState;
    overrideValue?: string | null;
    reason?: string | null;
    overriddenBy?: string | null;
    createdAt?: Date | null;
  }[];
  activeTenderFileIds?: Set<string>;
  hasExtractedRequirements: boolean;
  submissionMethodContext?: string;
};

/**
 * Normalise a metadata field value for exact comparison.
 */
function normalizeFieldValue(fieldKey: string, value: string): string {
  const v = value.trim().toLowerCase();
  if (fieldKey === "deadline" || fieldKey.toLowerCase().includes("date")) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? v : d.toISOString().split("T")[0];
  }
  return v;
}

/**
 * Format a Date object as a human-readable string (e.g. 12 Dec 2026).
 */
export function formatDateUnambiguous(value: string | Date | null): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function validateFieldFormat(fieldKey: string, value: string | null): { valid: boolean; reason: string | null } {
  if (!value) return { valid: true, reason: null };
  const trimmed = typeof value === "string" ? value.trim() : String(value);
  if (trimmed.length === 0) return { valid: true, reason: null };

  if (containsMetadataPlaceholder(trimmed) || looksLikeMetadataPlaceholder(trimmed)) {
    return { valid: false, reason: "Value is a placeholder (e.g. TBD, Bid-Team to confirm) and must be replaced." };
  }
  if (isGenericFieldLabel(trimmed)) {
    return { valid: false, reason: "Value is a generic field label (e.g. 'Reference Number') and not the actual data." };
  }
  if (fieldKey === "clientName" && !isValidClientName(trimmed)) {
    return { valid: false, reason: "Client name is too short or invalid." };
  }
  if (fieldKey === "reference" && !isValidReferenceNumber(trimmed)) {
    return { valid: false, reason: "Reference number format is invalid (no digits or too short)." };
  }
  if (fieldKey === "deadline") {
    if (isAmbiguousDateString(trimmed)) return { valid: false, reason: "Date format is ambiguous — use the date picker." };
  }
  return { valid: true, reason: null };
}

function isGroundedEvidence(
  evidence: { page: number | null; quote: string | null; fileId: string | null },
  activeTenderFileIds?: Set<string>,
): boolean {
  // Grounded requires page AND a non-trivial quote + valid TenderFile ID.
  // If activeTenderFileIds is provided, enforce that the fileId points to an
  // active (non-deleted) TenderFile. If not provided, fall back to basic check.
  if (activeTenderFileIds) {
    return isGroundedEvidenceWithFileCheck(evidence.page, evidence.quote, evidence.fileId, activeTenderFileIds);
  }
  return isGroundedSourceEvidence(evidence.page, evidence.quote);
}

/**
 * Resolve the effective state of all tender metadata fields.
 */
export function resolveCanonicalFieldState(input: CanonicalResolverInput): CanonicalFieldStateResult {
  const { tender, overrides, activeTenderFileIds, hasExtractedRequirements, submissionMethodContext } = input;
  const fields: CanonicalFieldState[] = [];

  const policyCtx = {
    submissionMethod: submissionMethodContext || tender.submissionMethod,
    // We do NOT have a simple boolean for this here, but the resolver reads
    // the email subject field directly — if it's missing it will block if critical.
  };

  const fieldKeys = [
    "clientName", "title", "reference", "deadline", "country", "currency",
    "submissionMethod", "submissionEndpoint", "submissionAddress", "submissionEmails",
    "requiredDocuments", "evaluationCriteria", "clientContactName", "clientContactEmail",
  ];

  let hasGenerationBlocker = false;
  let hasExportBlocker = false;
  let hasZipBlocker = false;

  let validCount = 0;
  let groundedCount = 0;
  let blockedCount = 0;

  for (const fieldKey of fieldKeys) {
    const label = fieldDisplayLabel(fieldKey);
    const isCritical = isCriticalField(fieldKey, policyCtx);
    const criticality = ALWAYS_CRITICAL_FIELDS.has(fieldKey) ? "always-critical" : isCritical ? "conditionally-critical" : "non-critical";

    const override = overrides.find((o) => o.field === fieldKey);
    const rawValueRaw = tender[fieldKey as keyof typeof tender];
    const rawValue = rawValueRaw instanceof Date ? rawValueRaw.toISOString() : typeof rawValueRaw === "string" ? rawValueRaw : rawValueRaw ? String(rawValueRaw) : null;
    const effectiveStr = override?.overrideValue ?? rawValue;
    const overrideState = override?.fieldState ?? null;
    const isManuallyConfirmed = overrideState === "USER_CONFIRMED";

    // Evidence resolution
    const evidence: { page: number | null; quote: string | null; fileId: string | null } = {
      page: (tender as any)[`${fieldKey}SourcePage`] ?? null,
      quote: (tender as any)[`${fieldKey}SourceQuote`] ?? null,
      fileId: (tender as any)[`${fieldKey}SourceFileId`] ?? null,
    };

    // Fallback evidence for reference (no dedicated columns) or prior extractions
    if (!evidence.fileId && tender.contactDetailsSourceJson) {
      try {
        const json = typeof tender.contactDetailsSourceJson === "string" ? JSON.parse(tender.contactDetailsSourceJson) : tender.contactDetailsSourceJson;
        const key = fieldKey === "reference" ? "procurementReferenceNumber" : fieldKey;
        const info = (json as Record<string, any>)[key];
        if (info) {
          if (!evidence.page) evidence.page = info.page ?? null;
          if (!evidence.quote) evidence.quote = info.quote ?? null;
          if (!evidence.fileId) evidence.fileId = info.fileId ?? null;
        }
      } catch {}
    }

    const validation = validateFieldFormat(fieldKey, effectiveStr);

    // Grounding Rule: a value is grounded only when it carries a valid fileId,
    // page > 0, and quote > 5 chars. This state is used for valid/grounded
    // counts, and dashboard metrics consistent with the status.
    const overrideMatchesGroundedForIsGrounded =
      override != null &&
      (override.fieldState === "USER_EDITED" || override.fieldState === "USER_CONFIRMED") &&
      validation.valid &&
      isGroundedEvidence(evidence, activeTenderFileIds) &&
      normalizeFieldValue(fieldKey, effectiveStr || "") === normalizeFieldValue(fieldKey, rawValue ?? "") &&
      normalizeFieldValue(fieldKey, effectiveStr || "") !== "";
    const isGrounded = (validation.valid && isGroundedEvidence(evidence, activeTenderFileIds) && !override) || overrideMatchesGroundedForIsGrounded;

    // Determine status
    let status: CanonicalFieldStatus;
    let blockerReason: string | null = null;
    let evidenceReviewNeeded = false;
    let warningReason: string | null = null;

    if (override?.fieldState === "NOT_APPLICABLE") {
      // Not Applicable is never permitted on a critical field (always- OR
      // conditionally-critical), and never on a never-N/A field (deadline).
      // This mirrors the registry's allowedOverrideStates (Policy F1) so a
      // user cannot dismiss a required field by marking it N/A.
      if (NEVER_NOT_APPLICABLE.has(fieldKey) || isCritical) {
        status = "BLOCKED";
        blockerReason = `Field "${label}" is critical. Not Applicable cannot unblock it. Record a candidate value or resolve from an active tender source.`;
      } else {
        status = "NOT_APPLICABLE";
      }
    } else if (override?.fieldState === "IGNORED_WITH_REASON") {
      status = "NOT_STATED";
      if (isCritical) {
        blockerReason = `Field "${label}" is critical. Not Stated cannot unblock it. Critical fields remain blocked until source-grounded.`;
      }
    } else if (tender.metadataContaminated === true && ENTITY_IDENTITY_FIELDS.has(fieldKey) && effectiveStr) {
      // Contamination takes priority over validity (matches the Metadata Truth
      // panel): a client/procuring name polluted by portal navigation or
      // unrelated-tender text must be corrected before generation/export.
      // A contaminated field stays blocked even if an override exists — the
      // override must be independently proven by active field-specific
      // tender evidence (page + quote matching the corrected value).
      const overrideMatchesGroundedSource =
        override != null &&
        (override.fieldState === "USER_EDITED" || override.fieldState === "USER_CONFIRMED") &&
        validation.valid &&
        isGroundedEvidence(evidence, activeTenderFileIds) &&
        normalizeFieldValue(fieldKey, effectiveStr) === normalizeFieldValue(fieldKey, rawValue ?? "") &&
        normalizeFieldValue(fieldKey, effectiveStr) !== "";
      if (overrideMatchesGroundedSource) {
        // The override value matches the grounded extracted value — the
        // contamination is resolved by independent source proof.
        status = "EXTRACTED_AND_GROUNDED";
      } else {
        status = "PORTAL_CONTAMINATION";
        blockerReason = `Field "${label}" appears contaminated by tender-portal navigation or unrelated-tender text. Correct it with a value proven by active tender-source evidence (matching page + quote) before generating documents.`;
      }
    } else if (!effectiveStr) {
      status = "INVALID";
      blockerReason = isCritical ? `Missing critical field: ${label}.` : null;
    } else if (!validation.valid) {
      status = validation.reason?.includes("placeholder") ? "INTERNAL_PLACEHOLDER"
        : validation.reason?.includes("heading") ? "GENERIC_FIELD_LABEL"
        : validation.reason?.includes("ambiguous") ? "AMBIGUOUS_DATE"
        : "INVALID_FORMAT";
      blockerReason = validation.reason;
    } else if (override?.fieldState === "USER_CONFIRMED") {
      // USER_CONFIRMED unblocks a critical field ONLY when the confirmed value
      // exactly matches the field-specific extracted value that has active
      // tender-source evidence (valid page + meaningful quote from a current
      // tender source file). Unrelated, stale, or missing evidence keeps the
      // field blocked.
      //
      // Normalize dates before comparison so "2026-12-11" and "12/11/2026"
      // are treated as the same value.
      const normalizedConfirmed = normalizeFieldValue(fieldKey, effectiveStr);
      const normalizedRaw = normalizeFieldValue(fieldKey, rawValue ?? "");
      const confirmedMatchesGroundedSource =
        validation.valid &&
        isGroundedEvidence(evidence, activeTenderFileIds) &&
        normalizedConfirmed === normalizedRaw &&
        normalizedConfirmed !== "";
      if (confirmedMatchesGroundedSource) {
        status = "EXTRACTED_AND_GROUNDED";
      } else {
        status = isGroundedEvidence(evidence, activeTenderFileIds) ? "MANUAL_CONFIRMED" : "NOT_FOUND_CONFIRMED";
        if (isCritical && !isGroundedEvidence(evidence, activeTenderFileIds)) {
          blockerReason = `Field "${label}" was manually confirmed but has no active tender-source evidence (page + quote + valid file). Link to an active tender source to unblock generation.`;
        } else if (isCritical && isGroundedEvidence(evidence, activeTenderFileIds) && normalizedConfirmed !== normalizedRaw) {
          blockerReason = `Field "${label}" was manually confirmed with a value that does not match the active tender-source evidence. The confirmed value must exactly match the extracted source value.`;
        }
      }
    } else if (override?.fieldState === "USER_EDITED") {
      // USER_EDITED unblocks a critical field ONLY when the edited value
      // exactly matches the field-specific extracted value with active
      // tender-source evidence. A user edit of a *different* value is a
      // candidate, not a grounded fact — it must not unlock generation.
      const normalizedEdited = normalizeFieldValue(fieldKey, effectiveStr);
      const normalizedRaw = normalizeFieldValue(fieldKey, rawValue ?? "");
      const editedMatchesGroundedSource =
        validation.valid &&
        isGroundedEvidence(evidence, activeTenderFileIds) &&
        normalizedEdited === normalizedRaw &&
        normalizedEdited !== "";
      if (editedMatchesGroundedSource) {
        status = "EXTRACTED_AND_GROUNDED";
      } else {
        status = isCritical ? "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED" : "MANUAL_OVERRIDE";
        if (isCritical) {
          blockerReason = `Field "${label}" has a candidate value that does not match active tender-source evidence. Critical fields remain blocked until the value exactly matches the grounded source evidence.`;
        }
      }
    } else if (isGrounded) {
      status = "EXTRACTED_AND_GROUNDED";
    } else {
      status = "EXTRACTED_UNVERIFIED";
      if (isCritical) {
        // Rule 3 / Rule 8: Critical fields remain blocked until source-grounded.
        blockerReason = `Field "${label}" has a value but is not yet source-grounded (missing page, quote, or active file). Critical fields remain blocked until source-grounded.`;
      }
    }

    // Special handling for requiredDocuments
    if (fieldKey === "requiredDocuments") {
      if (hasExtractedRequirements) {
        status = "EXTRACTED_AND_GROUNDED";
        blockerReason = null;
      } else {
        status = "INVALID";
        blockerReason = "No extracted requirements. Run AI Analyze or manually enter requirements.";
      }
    }

    // A contaminated value is NOT valid and NOT grounded, regardless of whether
    // its raw text passes format validation (it is polluted by portal text).
    // Mirrors the Metadata Truth panel, which excludes PORTAL_CONTAMINATION from
    // the valid/grounded metrics.
    // A MANUAL_OVERRIDE_CONFIRMATION_REQUIRED value is a candidate — it has
    // a valid format but is not usable for the generation gate until confirmed
    // against an active tender source, so isValid = false.
    const contaminated = status === "PORTAL_CONTAMINATION";
    const candidateUnconfirmed = status === "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED";
    const effectiveValid = validation.valid && !contaminated && !candidateUnconfirmed;
    const effectiveGrounded = isGrounded && !contaminated;

    // Determine gate eligibility
    const isBlocked = blockerReason !== null;
    const generationEligible = !isBlocked || (!isCritical && status !== "BLOCKED");
    const exportEligible = !isBlocked || (!isCritical && status !== "BLOCKED");
    const zipEligible = !isBlocked;

    if (isCritical && isBlocked) {
      hasGenerationBlocker = true;
      hasExportBlocker = true;
      hasZipBlocker = true;
    }

    if (effectiveValid) validCount++;
    if (effectiveGrounded) groundedCount++;
    if (isBlocked) blockedCount++;

    // Permitted actions
    const permittedActions: string[] = [];
    if (!effectiveStr || !effectiveValid) permittedActions.push("edit");
    if (effectiveValid && !effectiveGrounded && !override) permittedActions.push("confirm");
    if (override && override.fieldState === "USER_EDITED") permittedActions.push("confirm");
    if (!NEVER_NOT_APPLICABLE.has(fieldKey) && !isCritical) permittedActions.push("not_applicable");
    if (effectiveStr && !override) permittedActions.push("not_stated");
    if (evidence.page) permittedActions.push("review_source");

    fields.push({
      fieldKey,
      label,
      status,
      rawValue,
      effectiveValue: effectiveStr || null,
      isValid: effectiveValid,
      isGrounded: effectiveGrounded,
      overrideState,
      isManuallyConfirmed,
      criticality,
      blockerReason,
      evidenceReviewNeeded,
      warningReason,
      generationEligible,
      exportEligible,
      zipEligible,
      permittedActions,
      sourceFileId: evidence.fileId,
      sourcePage: evidence.page,
      sourceQuote: evidence.quote,
      extractionMethod: null,
      confidence: effectiveGrounded ? 0.8 : 0,
      overriddenBy: override?.overriddenBy ?? null,
      overrideReason: override?.reason ?? null,
      overrideTimestamp: override?.createdAt ?? null,
    });
  }

  return {
    fields,
    hasGenerationBlocker,
    hasExportBlocker,
    hasZipBlocker,
    totalFields: fields.length,
    validFields: validCount,
    groundedFields: groundedCount,
    blockedFields: blockedCount,
  };
}

// ─── Client & Submission Details panel chip vocabulary ─────────────────────
//
// The panel renders a small set of human-readable chips. This mapper is the
// SINGLE place the resolver's canonical status is translated to those chips,
// so the panel never re-derives status from raw values client-side.

export type ClientChipStatus =
  | "EXTRACTED_GROUNDED"
  | "EXTRACTED_NO_EVIDENCE"
  | "MANUAL_OVERRIDE"
  | "MANUALLY_CONFIRMED"
  | "NOT_STATED"
  | "NOT_APPLICABLE"
  | "RETRY_ON_ANALYZE"
  | "INVALID_VALUE"
  | "CONTAMINATED"
  | "BLOCKED"
  | "NOT_DETECTED";

export function canonicalToClientChip(state: CanonicalFieldState): ClientChipStatus {
  // A user "Retry on next AI Analyze" override is stored as MISSING.
  if (state.overrideState === "MISSING") return "RETRY_ON_ANALYZE";
  switch (state.status) {
    case "EXTRACTED_AND_GROUNDED": return "EXTRACTED_GROUNDED";
    case "EXTRACTED_UNVERIFIED": return "EXTRACTED_NO_EVIDENCE";
    case "MANUAL_OVERRIDE": return "MANUAL_OVERRIDE";
    case "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED": return "MANUAL_OVERRIDE";
    case "MANUAL_CONFIRMED":
    case "NOT_FOUND_CONFIRMED": return "MANUALLY_CONFIRMED";
    case "NOT_STATED": return "NOT_STATED";
    case "NOT_APPLICABLE": return "NOT_APPLICABLE";
    case "PORTAL_CONTAMINATION": return "CONTAMINATED";
    case "AMBIGUOUS_DATE":
    case "GENERIC_FIELD_LABEL":
    case "INTERNAL_PLACEHOLDER":
    case "INVALID_FORMAT": return "INVALID_VALUE";
    case "BLOCKED": return "BLOCKED";
    case "INVALID": return "NOT_DETECTED";
    default: return "NOT_DETECTED";
  }
}
