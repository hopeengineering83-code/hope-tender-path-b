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
import { isPhysicalSubmissionMethod, isEmailSubmissionMethod } from "./submission-method-policy";
import { isGroundedEvidence as isGroundedSourceEvidence } from "./evidence-grounding";
import { looksLikeMetadataPlaceholder } from "./tender-metadata-completeness";

// ─── Canonical field-state vocabulary ──────────────────────────────────────

export type CanonicalFieldStatus =
  | "EXTRACTED_AND_GROUNDED"   // Valid value + tender-source evidence (file + page + quote)
  | "EXTRACTED_UNVERIFIED"     // Valid value; missing or incomplete source evidence
  | "MANUAL_OVERRIDE"          // User entered a candidate value (blocked if critical)
  | "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED" // Candidate needs confirmation (blocked if critical)
  | "MANUALLY_CONFIRMED_GROUNDED" // User confirmed a value that has source evidence
  | "MANUALLY_CONFIRMED_UNGROUNDED" // User confirmed a value without source evidence (blocked if critical)
  | "MANUAL_CONFIRMED"         // (Legacy alias) - Maps to confirmed states
  | "NOT_STATED"               // Audited absence (blocked if critical)
  | "NOT_APPLICABLE"           // Field does not apply (blocked if critical)
  | "AMBIGUOUS_DATE"           // Date format ambiguous
  | "GENERIC_FIELD_LABEL"      // Value is a field heading
  | "INTERNAL_PLACEHOLDER"     // Contains TBD/N/A/etc
  | "PORTAL_CONTAMINATION"     // Entity name polluted by portal/navigation text
  | "INVALID_FORMAT"           // Format validation failed
  | "INVALID"                  // Generic invalid / missing
  | "BLOCKED";                 // Hard blocked (e.g. N/A on critical field)

export type CanonicalFieldState = {
  fieldKey: string;
  label: string;
  status: CanonicalFieldStatus;
  rawValue: any;
  effectiveValue: string | null;
  isValid: boolean;
  isGrounded: boolean;
  overrideState: PolicyFieldState | null;
  isManuallyConfirmed: boolean;
  criticality: "always-critical" | "conditionally-critical" | "non-critical";
  blockerReason: string | null;
  evidenceReviewNeeded: boolean;
  warningReason: string | null;
  generationEligible: boolean;
  exportEligible: boolean;
  zipEligible: boolean;
  permittedActions: string[];
  sourceFileId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  extractionMethod: string | null;
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

// ─── Internal logic ─────────────────────────────────────────────────────────

export const FIELDS_TO_EVALUATE = [
  "clientName",
  "title",
  "reference",
  "deadline",
  "country",
  "currency",
  "submissionMethod",
  "submissionEndpoint",
  "submissionAddress",
  "submissionEmails",
  "submissionEmailSubject",
  "requiredDocuments",
  "clientContactName",
  "clientContactEmail",
  "clientContactPhone",
  "budget",
  "numberOfCopiesRequired",
  "preBidMeetingDate",
  "preBidMeetingLocation",
  "clientCity",
  "clientAddress",
  "clientWebsite",
  "clientRepresentative",
  "legalClientName",
  "donorAgency",
  "implementingAgency",
  "pageLimit",
  "bidBond",
  "siteVisit",
  "proposalValidity",
  "evaluationCriteria"
];

const ENTITY_IDENTITY_FIELDS = new Set(["clientName", "procuringEntityName", "legalClientName"]);

function getRawValue(tender: any, key: string): any {
  if (key === "submissionEndpoint") {
    return tender.submissionEmails || tender.submissionAddress || null;
  }
  return tender[key] ?? null;
}

function validateValue(field: string, value: any): { valid: boolean; reason?: string } {
  const text = (typeof value === "string" ? value : String(value ?? "")).trim();
  if (!text || text === "null") return { valid: false, reason: "No value provided." };

  if (containsMetadataPlaceholder(text) || looksLikeMetadataPlaceholder(text)) {
    return { valid: false, reason: "Value contains internal placeholder text (TBD/TBC/N/A)." };
  }

  if (isGenericFieldLabel(text)) {
    return { valid: false, reason: "Value appears to be a field heading rather than extracted data." };
  }

  switch (field) {
    case "clientName":
      if (!isValidClientName(text)) return { valid: false, reason: "Invalid procuring entity name." };
      break;
    case "reference":
      if (!isValidReferenceNumber(text)) return { valid: false, reason: "Invalid reference number format." };
      break;
    case "deadline": {
      const d = new Date(text);
      if (isNaN(d.getTime())) return { valid: false, reason: "Invalid date format." };
      if (isAmbiguousDateString(text)) return { valid: false, reason: "Date format is ambiguous (e.g. DD/MM vs MM/DD)." };
      break;
    }
  }

  return { valid: true };
}

type FieldEvidence = {
  fileId: string | null;
  page: number | null;
  quote: string | null;
};

function getSourceEvidence(tender: any, key: string, contactDetails: any): FieldEvidence {
  if (key === "clientName") {
    return { fileId: null, page: tender.clientNameSourcePage, quote: tender.clientNameSourceQuote };
  }
  if (key === "submissionMethod") {
    return { fileId: null, page: tender.submissionMethodSourcePage, quote: tender.submissionMethodSourceQuote };
  }
  if (key === "submissionAddress") {
    return { fileId: null, page: tender.submissionAddressSourcePage, quote: tender.submissionAddressSourceQuote };
  }
  if (key === "submissionEmails") {
    return { fileId: null, page: tender.submissionEmailSourcePage, quote: contactDetails?.submissionEmails?.quote ?? null };
  }
  if (key === "clientContactName") {
    return { fileId: null, page: null, quote: contactDetails?.clientContactName?.quote ?? null };
  }
  return { fileId: null, page: null, quote: null };
}

function parseContactDetailsSource(json: string | null): any {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}

function isGroundedEvidence(evidence: FieldEvidence): boolean {
  return isGroundedSourceEvidence(evidence.page, evidence.quote);
}

export type CanonicalResolverInput = {
  tender: any;
  overrides: any[];
  hasExtractedRequirements: boolean;
};

export function resolveCanonicalFieldState(input: CanonicalResolverInput): CanonicalFieldStateResult {
  const { tender, overrides, hasExtractedRequirements } = input;
  const overrideMap = new Map(overrides.map(o => [o.field, o]));
  const contactDetails = parseContactDetailsSource(tender.contactDetailsSourceJson);
  const fields: CanonicalFieldState[] = [];

  let hasGenerationBlocker = false;
  let hasExportBlocker = false;
  let hasZipBlocker = false;
  let validCount = 0;
  let groundedCount = 0;
  let blockedCount = 0;

  for (const fieldKey of FIELDS_TO_EVALUATE) {
    const rawValue = getRawValue(tender, fieldKey);
    const override = overrideMap.get(fieldKey);
    const evidence = getSourceEvidence(tender, fieldKey, contactDetails);
    const label = fieldDisplayLabel(fieldKey);
    const isCritical = ALWAYS_CRITICAL_FIELDS.has(fieldKey) || isCriticalField(fieldKey, { submissionMethod: tender.submissionMethod ?? undefined });
    const criticality: CanonicalFieldState["criticality"] = ALWAYS_CRITICAL_FIELDS.has(fieldKey)
      ? "always-critical"
      : isCritical ? "conditionally-critical" : "non-critical";

    let effectiveValue = rawValue;
    if (fieldKey === "clientName" && !effectiveValue && (tender.procuringEntityName)) {
      effectiveValue = tender.procuringEntityName;
    }

    let overrideState: PolicyFieldState | null = null;
    let isManuallyConfirmed = false;

    if (override) {
      overrideState = override.fieldState as PolicyFieldState;
      if (override.fieldState === "USER_EDITED" || override.fieldState === "USER_CONFIRMED") {
        effectiveValue = override.overrideValue ?? effectiveValue;
        isManuallyConfirmed = override.fieldState === "USER_CONFIRMED";
      }
    }

    const effectiveStr = (effectiveValue && String(effectiveValue) !== "null") ? String(effectiveValue) : "";
    const validation = effectiveStr ? validateValue(fieldKey, effectiveStr) : { valid: false, reason: "No value detected." };
    const groundedInSource = validation.valid && isGroundedEvidence(evidence);

    let status: CanonicalFieldStatus;
    let blockerReason: string | null = null;
    let evidenceReviewNeeded = false;
    let warningReason: string | null = null;

    if (override?.fieldState === "NOT_APPLICABLE") {
      status = "NOT_APPLICABLE";
      if (NEVER_NOT_APPLICABLE.has(fieldKey) || isCritical) {
        status = "BLOCKED";
        blockerReason = `Field "${label}" is critical and cannot be marked Not Applicable. Critical fields remain blocked until source-grounded.`;
      }
    } else if (override?.fieldState === "IGNORED_WITH_REASON") {
      status = "NOT_STATED";
      if (isCritical) {
        status = "BLOCKED";
        blockerReason = `Field "${label}" is critical but not stated in tender. Critical fields remain blocked until source-grounded.`;
      }
    } else if (tender.metadataContaminated === true && ENTITY_IDENTITY_FIELDS.has(fieldKey) && effectiveStr && !override) {
      status = "PORTAL_CONTAMINATION";
      blockerReason = `Field "${label}" appears contaminated by tender-portal navigation or unrelated-tender text. Correct it before generating documents.`;
    } else if (!effectiveStr) {
      status = "INVALID";
      if (isCritical) {
        blockerReason = `Missing critical field: ${label}. Record a candidate value or resolve from a tender source. Critical fields remain blocked until source-grounded.`;
      }
    } else if (!validation.valid) {
      status = validation.reason?.includes("placeholder") ? "INTERNAL_PLACEHOLDER"
        : validation.reason?.includes("heading") ? "GENERIC_FIELD_LABEL"
        : validation.reason?.includes("ambiguous") ? "AMBIGUOUS_DATE"
        : "INVALID_FORMAT";
      blockerReason = validation.reason || null;
    } else if (override?.fieldState === "USER_CONFIRMED") {
      if (groundedInSource) {
        status = "MANUALLY_CONFIRMED_GROUNDED";
      } else {
        status = "MANUALLY_CONFIRMED_UNGROUNDED";
        if (isCritical) {
          blockerReason = `Field "${label}" was confirmed manually but lacks active tender-source evidence. Critical fields remain blocked until source-grounded.`;
        }
      }
    } else if (override?.fieldState === "USER_EDITED") {
      status = isCritical ? "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED" : "MANUAL_OVERRIDE";
      if (isCritical) {
        blockerReason = `Field "${label}" has a manual candidate value. Resolve from a tender source to unblock. Critical fields remain blocked until source-grounded.`;
      }
    } else if (groundedInSource) {
      status = "EXTRACTED_AND_GROUNDED";
    } else {
      status = "EXTRACTED_UNVERIFIED";
      if (isCritical) {
        evidenceReviewNeeded = true;
        blockerReason = `Field "${label}" has an extracted value but lacks active tender-source evidence. Confirm the evidence for full traceability. Critical fields remain blocked until source-grounded.`;
      }
    }

    if (fieldKey === "requiredDocuments") {
      if (hasExtractedRequirements) {
        status = "EXTRACTED_AND_GROUNDED";
        blockerReason = null;
      } else {
        status = "INVALID";
        blockerReason = "No extracted requirements. Run AI Analyze or manually enter requirements. Critical fields remain blocked until source-grounded.";
      }
    }

    const isBlocked = blockerReason !== null;
    const generationEligible = !isBlocked;
    const exportEligible = !isBlocked;
    const zipEligible = !isBlocked;

    if (isBlocked) {
      hasGenerationBlocker = true;
      hasExportBlocker = true;
      hasZipBlocker = true;
      blockedCount++;
    }

    if (validation.valid && status !== "PORTAL_CONTAMINATION") validCount++;
    if (groundedInSource && status !== "PORTAL_CONTAMINATION") groundedCount++;

    const permittedActions: string[] = [];
    if (!effectiveStr || !validation.valid) permittedActions.push("edit");
    if (validation.valid && !groundedInSource && !override) permittedActions.push("confirm");
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
      isValid: validation.valid && status !== "PORTAL_CONTAMINATION",
      isGrounded: groundedInSource && status !== "PORTAL_CONTAMINATION",
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
      confidence: groundedInSource ? 0.8 : 0,
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
  if (state.overrideState === "MISSING") return "RETRY_ON_ANALYZE";
  switch (state.status) {
    case "EXTRACTED_AND_GROUNDED":
    case "MANUALLY_CONFIRMED_GROUNDED": return "EXTRACTED_GROUNDED";
    case "EXTRACTED_UNVERIFIED": return "EXTRACTED_NO_EVIDENCE";
    case "MANUAL_OVERRIDE":
    case "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED": return "MANUAL_OVERRIDE";
    case "MANUALLY_CONFIRMED_UNGROUNDED": return "MANUALLY_CONFIRMED";
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
