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

// ─── Canonical field-state vocabulary ──────────────────────────────────────

export type CanonicalFieldStatus =
  | "EXTRACTED_AND_GROUNDED"   // Valid value + tender-source evidence (file + page + quote)
  | "EXTRACTED_UNVERIFIED"     // Valid value; missing or incomplete source evidence
  | "MANUAL_OVERRIDE"          // User entered a value (valid but ungrounded)
  | "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED" // User entered value, needs confirmation
  | "MANUAL_CONFIRMED"         // User explicitly confirmed a value
  | "NOT_STATED"               // Audited absence — field not stated in tender
  | "NOT_APPLICABLE"           // Field does not apply
  | "AMBIGUOUS_DATE"           // Date format ambiguous
  | "GENERIC_FIELD_LABEL"      // Value is a field heading
  | "INTERNAL_PLACEHOLDER"     // Contains TBD/N/A/etc
  | "INVALID_FORMAT"           // Format validation failed
  | "INVALID"                  // No value, no override
  | "BLOCKED";                 // Field is blocked from all gates

export type CanonicalFieldState = {
  fieldKey: string;
  label: string;
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
  extractionMethod: string | null;
  confidence: number;
  // Audit
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

// ─── Input type ────────────────────────────────────────────────────────────

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
    submissionEmails: string | null;
    submissionEmailSubject: string | null;
    clientContactName: string | null;
    clientContactEmail: string | null;
    metadataContaminated: boolean;
    clientNameSourcePage: number | null;
    clientNameSourceQuote: string | null;
    submissionMethodSourcePage: number | null;
    submissionMethodSourceQuote: string | null;
    submissionAddressSourcePage: number | null;
    submissionAddressSourceQuote: string | null;
    submissionEmailSourcePage: number | null;
    contactDetailsSourceJson: any;
  };
  overrides: Array<{
    field: string;
    fieldState: string;
    overrideValue: string | null;
    reason: string | null;
    overriddenBy: string | null;
    createdAt: Date | null;
  }>;
  hasExtractedRequirements: boolean;
  submissionMethodContext?: string;
};

// ─── Resolver ──────────────────────────────────────────────────────────────

const FIELDS_TO_EVALUATE = [
  "clientName", "procuringEntityName", "title", "reference", "deadline",
  "currency", "country", "submissionMethod", "submissionAddress",
  "submissionEmails", "submissionEmailSubject", "clientContactName",
  "clientContactEmail", "requiredDocuments",
] as const;

function getRawValue(tender: CanonicalResolverInput["tender"], field: string): string | null {
  const map: Record<string, string | null> = {
    clientName: tender.clientName,
    procuringEntityName: tender.procuringEntityName,
    title: tender.title,
    reference: tender.reference,
    deadline: tender.deadline ? tender.deadline.toISOString().split("T")[0] : null,
    currency: tender.currency,
    country: tender.country,
    submissionMethod: tender.submissionMethod,
    submissionAddress: tender.submissionAddress,
    submissionEmails: tender.submissionEmails,
    submissionEmailSubject: tender.submissionEmailSubject,
    clientContactName: tender.clientContactName,
    clientContactEmail: tender.clientContactEmail,
    requiredDocuments: null, // Derived from extracted requirements
  };
  return map[field] ?? null;
}

function getSourceEvidence(tender: CanonicalResolverInput["tender"], field: string) {
  const evidenceMap: Record<string, { page: number | null; quote: string | null; fileId: string | null }> = {
    clientName: { page: tender.clientNameSourcePage, quote: tender.clientNameSourceQuote, fileId: null },
    submissionMethod: { page: tender.submissionMethodSourcePage, quote: tender.submissionMethodSourceQuote, fileId: null },
    submissionAddress: { page: tender.submissionAddressSourcePage, quote: tender.submissionAddressSourceQuote, fileId: null },
    submissionEmails: { page: tender.submissionEmailSourcePage, quote: null, fileId: null },
  };
  return evidenceMap[field] ?? { page: null, quote: null, fileId: null };
}

function validateValue(field: string, value: string): { valid: boolean; reason: string | null } {
  if (!value || value.trim().length === 0) return { valid: false, reason: "No value detected." };
  if (containsMetadataPlaceholder(value)) return { valid: false, reason: "Value contains a placeholder (TBD / N/A / Bid-Team to confirm)." };
  if (isGenericFieldLabel(value)) return { valid: false, reason: "Value is a field heading, not real data." };
  if (field === "clientName" || field === "procuringEntityName") {
    if (!isValidClientName(value)) return { valid: false, reason: "Client name is too short or generic." };
  }
  if (field === "reference") {
    if (!isValidReferenceNumber(value)) return { valid: false, reason: "Reference must contain at least one digit." };
  }
  if (field === "deadline") {
    if (isAmbiguousDateString(value)) return { valid: false, reason: "Date format is ambiguous — use the date picker." };
  }
  return { valid: true, reason: null };
}

function isGroundedEvidence(evidence: { page: number | null; quote: string | null; fileId: string | null }): boolean {
  // Grounded requires: page AND quote (fileId is ideal but not always available)
  return evidence.page != null && evidence.page > 0 &&
    evidence.quote != null && evidence.quote.trim().length > 5;
}

export function resolveCanonicalFieldState(input: CanonicalResolverInput): CanonicalFieldStateResult {
  const { tender, overrides, hasExtractedRequirements } = input;
  const overrideMap = new Map(overrides.map(o => [o.field, o]));
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
    const evidence = getSourceEvidence(tender, fieldKey);
    const label = fieldDisplayLabel(fieldKey);
    const isCritical = ALWAYS_CRITICAL_FIELDS.has(fieldKey) || isCriticalField(fieldKey, { submissionMethod: tender.submissionMethod ?? undefined });
    const criticality: CanonicalFieldState["criticality"] = ALWAYS_CRITICAL_FIELDS.has(fieldKey)
      ? "always-critical"
      : isCritical ? "conditionally-critical" : "non-critical";

    // Determine effective value and override state
    let effectiveValue = rawValue;
    let overrideState: PolicyFieldState | null = null;
    let isManuallyConfirmed = false;

    if (override) {
      overrideState = override.fieldState as PolicyFieldState;
      if (override.fieldState === "USER_EDITED" || override.fieldState === "USER_CONFIRMED") {
        effectiveValue = override.overrideValue ?? rawValue;
        isManuallyConfirmed = override.fieldState === "USER_CONFIRMED";
      } else if (override.fieldState === "NOT_APPLICABLE" || override.fieldState === "IGNORED_WITH_REASON") {
        // These are audited absence states — they do NOT provide a value
        effectiveValue = rawValue; // Keep the raw value if any
      }
    }

    // Validate the effective value
    const effectiveStr = effectiveValue ?? "";
    const validation = effectiveStr ? validateValue(fieldKey, effectiveStr) : { valid: false, reason: "No value detected." };

    // Determine grounding
    const isGrounded = validation.valid && isGroundedEvidence(evidence) && !override;

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
        blockerReason = `Field "${label}" is critical and cannot be marked Not Applicable. Provide a value or confirm it.`;
      } else {
        status = "NOT_APPLICABLE";
      }
    } else if (override?.fieldState === "IGNORED_WITH_REASON") {
      status = "NOT_STATED";
      if (isCritical) {
        blockerReason = `Field "${label}" is critical but not stated in tender. All gates remain blocked.`;
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
      status = "MANUAL_CONFIRMED";
    } else if (override?.fieldState === "USER_EDITED") {
      status = isCritical ? "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED" : "MANUAL_OVERRIDE";
    } else if (isGrounded) {
      status = "EXTRACTED_AND_GROUNDED";
    } else {
      // Valid value, but no stored page+quote evidence. This is a TRACEABILITY
      // warning ("review evidence"), NOT a hard gate blocker. A clean,
      // fully-populated tender whose title/deadline have no source-evidence
      // columns at all must still be allowed to generate and export. Grounding
      // drives the grounded metric and the review prompt — never the block.
      status = "EXTRACTED_UNVERIFIED";
      if (isCritical) {
        evidenceReviewNeeded = true;
        warningReason = `Field "${label}" has a value but is not yet linked to a source page + quote. Confirm the evidence for full traceability.`;
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

    if (validation.valid) validCount++;
    if (isGrounded) groundedCount++;
    if (isBlocked) blockedCount++;

    // Permitted actions
    const permittedActions: string[] = [];
    if (!effectiveStr || !validation.valid) permittedActions.push("edit");
    if (validation.valid && !isGrounded && !override) permittedActions.push("confirm");
    if (override && override.fieldState === "USER_EDITED") permittedActions.push("confirm");
    if (!NEVER_NOT_APPLICABLE.has(fieldKey) && !isCritical) permittedActions.push("not_applicable");
    if (effectiveStr && !override) permittedActions.push("not_stated");
    if (evidence.page) permittedActions.push("review_source");

    fields.push({
      fieldKey,
      label,
      rawValue,
      effectiveValue: effectiveStr || null,
      isValid: validation.valid,
      isGrounded,
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
      confidence: isGrounded ? 0.8 : 0,
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
