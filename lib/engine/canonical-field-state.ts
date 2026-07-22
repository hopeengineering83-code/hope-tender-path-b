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
import { isGroundedEvidence as isGroundedSourceEvidence, isGroundedEvidenceWithFileCheck, isGroundedEvidenceInActiveFiles, type GroundingActiveFile } from "./evidence-grounding";
// The export/completeness gate's placeholder set is broader than the validators'
// (e.g. "not available", "to be provided", mid-text "TBA", "fill in here"). The
// resolver consults it too so the Client & Submission panel never shows a value
// as valid that the export gate would reject as a placeholder. (We do NOT widen
// the global containsMetadataPlaceholder, because sanitize-stored-metadata nulls
// fields on it and mid-text matches would risk dropping legitimate values.)
import { looksLikeMetadataPlaceholder } from "./tender-metadata-completeness";
// Authority model — manual tender facts flexibility
import {
  isSubmissionCriticalField,
  isConditionallySubmissionCritical,
  isMeaningfulReason,
  isValidConfirmationBasis,
  MIN_CRITICAL_REASON_LENGTH,
} from "./tender-fact-authority";
import type { TenderPolicyContext } from "./tender-policy-registry";
import { INDISPENSABLE_FINAL_DELIVERY_FIELDS } from "./tender-applicability";
import {
  deriveSourceDrivenTenderDetail,
  isFactRequiredForFinal,
} from "./source-driven-tender-detail";

/**
 * Check if a manual override's audit is sufficient for FINAL export.
 *
 * For submission-critical fields, the audit must include:
 *   - A meaningful reason (≥ MIN_CRITICAL_REASON_LENGTH chars, not boilerplate)
 *   - A valid confirmationBasis
 *
 * For non-critical fields, the audit is always sufficient (they don't block
 * final export).
 *
 * Returns true when the override is null (no manual entry — use source grounding)
 * or when the field is non-critical or when the audit is sufficient.
 */
function auditSufficientForFinal(
  override: { fieldState?: string; reason?: string | null; confirmationBasis?: string | null } | null,
  fieldName: string,
  policyCtx: TenderPolicyContext,
): boolean {
  if (!override) return true; // No override → source grounding decides
  if (override.fieldState !== "USER_EDITED" && override.fieldState !== "USER_CONFIRMED") return true;
  const isCritical = isSubmissionCriticalField(fieldName) || isConditionallySubmissionCritical(fieldName, policyCtx);
  if (!isCritical) return true; // Non-critical → audit not required for final
  // Critical field with manual value → audit required
  return isMeaningfulReason(override.reason, MIN_CRITICAL_REASON_LENGTH)
    && Boolean(override.confirmationBasis)
    && isValidConfirmationBasis(override.confirmationBasis ?? "");
}

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
  /**
   * Source-driven: true when this field is required for FINAL submission
   * based on what the tender itself requires (e.g. email endpoint for an
   * email-method tender). This complements `criticality` — `criticality`
   * reflects the legacy "always-critical" classification (kept for backward
   * compatibility with final-submission gates), while `requiredForFinal`
   * reflects the source-driven model. UI panels may use either; new code
   * should prefer `requiredForFinal` because it is tender-derived.
   */
  requiredForFinal: boolean;
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
    // Reference number source evidence
    referenceSourceFileId?: string | null;
    referenceSourcePage?: number | null;
    referenceSourceQuote?: string | null;
    // Submission email subject source evidence
    submissionEmailSubjectSourceFileId?: string | null;
    submissionEmailSubjectSourcePage?: number | null;
    submissionEmailSubjectSourceQuote?: string | null;
    // Extended fields for dashboard
    evaluationMethodology?: string | null;
    legalClientName?: string | null;
    donorAgency?: string | null;
    implementingAgency?: string | null;
    clientContactTitle?: string | null;
    clientContactPhone?: string | null;
    clientCity?: string | null;
    clientAddress?: string | null;
    clientWebsite?: string | null;
    clientRepresentative?: string | null;
    preBidChannel?: string | null;
    preBidMeetingDate?: string | null;
    preBidMeetingLocation?: string | null;
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
    // Authority model columns (additive — populated by the metadata-override route)
    authorityClass?: string | null;
    confirmationBasis?: string | null;
    confirmedAt?: Date | null;
  }[];
  activeTenderFileIds?: Set<string>;
  /**
   * ACTIVE TenderFile rows with extracted text / totalPages. When provided,
   * grounding uses the STRONGEST shared check (quote containment in the
   * referenced file's text + source page <= totalPages) — the same evidence
   * rules validateCriticalMetadataEvidenceForBuildPlan enforces, so a field
   * can never show "grounded" (green) here while the gate rejects its
   * evidence. Callers that have the file rows loaded MUST pass this.
   */
  activeFiles?: ReadonlyArray<GroundingActiveFile>;
  hasExtractedRequirements: boolean;
  submissionMethodContext?: string;
  /**
   * TenderFactsLedger snapshot (optional). When provided, the resolver
   * prefers ledger facts over raw scalar columns for each field. This
   * makes TenderFactsLedger the runtime authority — scalar columns are
   * used only as fallback when no ledger fact exists for a semantic key.
   *
   * Callers should fetch the snapshot via
   * `getTenderFactLedgerSnapshot(prisma, tenderId)` and pass it here.
   */
  ledgerFacts?: ReadonlyArray<{
    semanticKey: string;
    displayLabel: string;
    normalizedValue: string | null;
    rawSourceValue: string | null;
    authorityState: string;
    sourceFileId: string | null;
    sourcePage: number | null;
    sourceQuote: string | null;
    manuallyEntered: boolean;
    reason: string | null;
    confirmationBasis: string | null;
  }>;
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

// Note: formatDateUnambiguous was previously exported here but never imported
// externally. The canonical implementation lives at
// lib/engine/metadata-validators.ts:formatDateUnambiguous — every consumer
// (tests/metadata-field-state.test.ts, app routes, lib files) imports from
// there. The dead duplicate was removed on 2026-07-19 during post-#1175
// gap closure.

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
  // Submission method must be classifiable as email, physical, or portal.
  // An unclassifiable method means the required submission endpoint cannot be
  // determined — the BuildPlan validator fails closed on this, so the resolver
  // must too (otherwise the panel shows green while the gate blocks).
  if (fieldKey === "submissionMethod") {
    if (
      !isEmailSubmissionMethod(trimmed) &&
      !isPhysicalSubmissionMethod(trimmed) &&
      !isPortalSubmissionMethod(trimmed)
    ) {
      return { valid: false, reason: "Submission method is not recognized as email, physical, or portal — the required submission endpoint cannot be determined." };
    }
  }
  return { valid: true, reason: null };
}

function isGroundedEvidence(
  evidence: { page: number | null; quote: string | null; fileId: string | null },
  activeTenderFileIds?: Set<string>,
  activeFiles?: ReadonlyArray<GroundingActiveFile>,
): boolean {
  // Grounded requires page AND a non-trivial quote + valid TenderFile ID.
  // When ACTIVE file rows (with extracted text / totalPages) are available,
  // apply the STRONGEST shared check — quote containment + page bound — the
  // same evidence rules the BuildPlan validator and release gates enforce.
  // With only the ID set, enforce active-file membership. With neither, fall
  // back to the basic page+quote check (legacy callers).
  if (activeFiles && activeFiles.length > 0) {
    return isGroundedEvidenceInActiveFiles(evidence.page, evidence.quote, evidence.fileId, activeFiles);
  }
  if (activeTenderFileIds) {
    return isGroundedEvidenceWithFileCheck(evidence.page, evidence.quote, evidence.fileId, activeTenderFileIds);
  }
  return isGroundedSourceEvidence(evidence.page, evidence.quote);
}

/**
 * Safely parse the contactDetailsSourceJson to extract source evidence.
 */
function parseContactDetailsSource(json: unknown): Record<string, { page: number | null; quote: string | null; fileId: string | null }> {
  try {
    const data = typeof json === "string" ? JSON.parse(json) : json;
    if (!data || typeof data !== "object") return {};
    const result: Record<string, { page: number | null; quote: string | null; fileId: string | null }> = {};
    for (const [k, v] of Object.entries(data as Record<string, any>)) {
      if (v && typeof v === "object") {
        const e = v as any;
        result[k] = {
          page: typeof e.page === "number" ? e.page : null,
          quote: typeof e.quote === "string" ? e.quote : null,
          fileId: typeof e.fileId === "string" && e.fileId.length > 0 ? e.fileId : null
        };
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Resolve the effective state of all tender metadata fields.
 */
export function resolveCanonicalFieldState(input: CanonicalResolverInput): CanonicalFieldStateResult {
  const { tender, overrides, activeTenderFileIds, activeFiles, hasExtractedRequirements, submissionMethodContext } = input;
  const fields: CanonicalFieldState[] = [];

  // ── Source-driven tender detail (computed once) ───────────────────────
  // Derive the source-driven tender detail from the tender record. This
  // drives the new `requiredForFinal` field on each CanonicalFieldState,
  // which is tender-derived (e.g. email endpoint required only when the
  // tender uses email submission) — not based on a universal list.
  const sourceDrivenDetail = deriveSourceDrivenTenderDetail(tender as Record<string, unknown>);

  // EFFECTIVE submission method (override-aware) drives conditional
  // criticality AND the value-driven email-subject rule — a USER_EDITED /
  // USER_CONFIRMED method override switches the applicable endpoint here
  // exactly like effectiveValue() does in the BuildPlan validator and the
  // canonical hash. Without this, overriding email→physical would leave the
  // panel demanding an email endpoint the gate no longer requires (and vice
  // versa).
  const methodOverride = overrides.find((o) => o.field === "submissionMethod");
  const effectiveSubmissionMethod =
    (methodOverride && (methodOverride.fieldState === "USER_EDITED" || methodOverride.fieldState === "USER_CONFIRMED") && methodOverride.overrideValue)
      ? methodOverride.overrideValue
      : (submissionMethodContext || tender.submissionMethod);

  const policyCtx = {
    submissionMethod: effectiveSubmissionMethod,
  };

  // EFFECTIVE endpoint values (override-aware) — needed to mirror the
  // BuildPlan validator's portal endpoint selection: on portal methods the
  // validator requires ONE fully grounded endpoint, preferring email when an
  // email candidate (value + source file + page) exists. The email-subject
  // value-driven rule follows the SAME selection (the validator only checks
  // the subject when the email endpoint is in play).
  const endpointOverride = (field: string, raw: string | null): string | null => {
    const ov = overrides.find((o) => o.field === field);
    if (ov && (ov.fieldState === "USER_EDITED" || ov.fieldState === "USER_CONFIRMED")) {
      return ov.overrideValue ?? null;
    }
    return raw ?? null;
  };
  const effectiveEmailsValue = endpointOverride("submissionEmails", tender.submissionEmails);
  const effectiveAddressValue = endpointOverride("submissionAddress", tender.submissionAddress);
  const portalHasEmailCandidate = !!(effectiveEmailsValue && tender.submissionEmailSourceFileId && tender.submissionEmailSourcePage);
  const portalHasAddressCandidate = !!(effectiveAddressValue && tender.submissionAddressSourceFileId && tender.submissionAddressSourcePage);

  const fieldKeys = [
    "clientName", "title", "reference", "deadline", "country", "currency",
    "submissionMethod", "submissionAddress", "submissionEmails", "submissionEmailSubject",
    "requiredDocuments", "evaluationCriteria", "clientContactName", "clientContactEmail",
    "legalClientName", "donorAgency", "implementingAgency", "clientContactTitle", "clientContactPhone",
    "clientCity", "clientAddress", "clientWebsite", "clientRepresentative", "preBidChannel",
    "preBidMeetingDate", "preBidMeetingLocation",
  ];

  let hasGenerationBlocker = false;
  let hasExportBlocker = false;
  let hasZipBlocker = false;

  let validCount = 0;
  let groundedCount = 0;
  let blockedCount = 0;

  const contactEvidenceMap = parseContactDetailsSource(tender.contactDetailsSourceJson);

  function getSourceEvidence(fieldKey: string): { page: number | null; quote: string | null; fileId: string | null } {
    const sourceKeyBase = fieldKey === "submissionEmails" ? "submissionEmail" : fieldKey;
    const page = (tender as any)[`${sourceKeyBase}SourcePage`];
    const quote = (tender as any)[`${sourceKeyBase}SourceQuote`];
    const fileId = (tender as any)[`${sourceKeyBase}SourceFileId`];

    if (typeof page === "number" || typeof quote === "string" || typeof fileId === "string") {
      return { page: page ?? null, quote: quote ?? null, fileId: fileId ?? null };
    }

    // Fallback for reference or extended fields
    const key = fieldKey === "reference" ? "procurementReferenceNumber" : fieldKey;
    const ce = contactEvidenceMap[key];
    if (ce) return { page: ce.page, quote: ce.quote, fileId: ce.fileId };

    return { page: null, quote: null, fileId: null };
  }

  for (const fieldKey of fieldKeys) {
    const label = fieldDisplayLabel(fieldKey);
    const isCritical = isCriticalField(fieldKey, policyCtx);
    const criticality = ALWAYS_CRITICAL_FIELDS.has(fieldKey) ? "always-critical" : isCritical ? "conditionally-critical" : "non-critical";

    const override = overrides.find((o) => o.field === fieldKey);
    // clientName fallback to procuringEntityName (P1-B/C parity)
    // evaluationCriteria is a virtual fieldKey that maps to the evaluationMethodology column
    // (the field is named "Evaluation criteria" in the UI but stored as evaluationMethodology).
    // Without this mapping, the resolver would always report INVALID for evaluationCriteria
    // even when evaluationMethodology is populated, producing a spurious INVALID row.
    const rawValueRaw = (fieldKey === "clientName" && !tender.clientName)
      ? tender.procuringEntityName
      : (fieldKey === "evaluationCriteria"
        ? tender.evaluationMethodology
        : tender[fieldKey as keyof typeof tender]);
    let rawValue = rawValueRaw instanceof Date ? rawValueRaw.toISOString() : typeof rawValueRaw === "string" ? rawValueRaw : rawValueRaw ? String(rawValueRaw) : null;

    // ── TenderFactsLedger authority resolution ──────────────────────────
    // When a ledger fact exists for this semantic key, prefer it over the
    // raw scalar column. The ledger is the durable authority; scalar columns
    // are fallback only when no ledger fact exists.
    //
    // Authority resolution order:
    //   1. SOURCE_GROUNDED_CONFIRMED  — use ledger value + evidence
    //   2. HUMAN_CONFIRMED_OPERATIONAL — use ledger value (USER_CONFIRMED/EDITED)
    //   3. NOT_APPLICABLE              — fact does not apply (omit from output)
    //   4. CANDIDATE_NEEDS_REVIEW      — use ledger value as candidate
    //   5. (fall through to scalar rawValue)
    //   6. REJECTED_EXTRACTION / SUPERSEDED — ignore ledger, fall through to scalar
    const ledgerFact = input.ledgerFacts?.find((f) =>
      f.semanticKey === fieldKey
      || (fieldKey === "evaluationCriteria" && f.semanticKey === "evaluationMethodology")
    );
    let ledgerAuthorityState: string | null = null;
    if (ledgerFact) {
      const ls = ledgerFact.authorityState.toUpperCase();
      if (ls === "SOURCE_GROUNDED_CONFIRMED" || ls === "HUMAN_CONFIRMED_OPERATIONAL" || ls === "CANDIDATE_NEEDS_REVIEW") {
        // Ledger provides the authoritative value
        if (ledgerFact.normalizedValue !== null) {
          rawValue = ledgerFact.normalizedValue;
        }
        ledgerAuthorityState = ls;
      } else if (ls === "NOT_APPLICABLE") {
        // Fact does not apply — treat as explicitly null
        rawValue = null;
        ledgerAuthorityState = ls;
      } else if (ls === "REJECTED_EXTRACTION" || ls === "SUPERSEDED") {
        // Ledger rejected this fact — don't use ledger value; fall through to scalar
        // but mark so we know the ledger rejected it
        ledgerAuthorityState = ls;
      }
    }

    const effectiveStr = override?.overrideValue ?? rawValue;
    const overrideState = override?.fieldState ?? null;
    const isManuallyConfirmed = overrideState === "USER_CONFIRMED"; // isManuallyConfirmed = override.fieldState === "USER_CONFIRMED"

    // Evidence resolution
    const evidence = getSourceEvidence(fieldKey);

    const validation = validateFieldFormat(fieldKey, effectiveStr);

    const overrideMatchesGroundedSourceCheck = (): boolean => {
       if (!override || (override.fieldState !== "USER_EDITED" && override.fieldState !== "USER_CONFIRMED")) return false;
       const normalizedEdited = normalizeFieldValue(fieldKey, effectiveStr || "");
       const normalizedRaw = normalizeFieldValue(fieldKey, rawValue ?? "");
       return validation.valid &&
         isGroundedEvidence(evidence, activeTenderFileIds, activeFiles) &&
         normalizedEdited === normalizedRaw &&
         normalizedEdited !== "";
    };

    const isGrounded = (validation.valid && isGroundedEvidence(evidence, activeTenderFileIds, activeFiles) && !override) || overrideMatchesGroundedSourceCheck();

    // Value-driven fields are handled by the final-export authority model below;
    // they do not independently hard-block draft work.

    // Determine status
    let status: CanonicalFieldStatus;
    let blockerReason: string | null = null;
    let evidenceReviewNeeded = false;
    let warningReason: string | null = null;

    if (override?.fieldState === "NOT_APPLICABLE") {
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
    } else if (ledgerAuthorityState === "NOT_APPLICABLE") {
      // ── Ledger NOT_APPLICABLE (without override) ──────────────────────
      // The ledger says this fact does not apply. Mirror the override
      // NOT_APPLICABLE branch so a ledger N/A entry does NOT produce
      // status=INVALID (which would block final export — the opposite of
      // the user's intent when marking a fact N/A).
      if (NEVER_NOT_APPLICABLE.has(fieldKey) || isCritical) {
        status = "BLOCKED";
        blockerReason = `Field "${label}" is critical. Ledger Not Applicable cannot unblock it. Record a candidate value or resolve from an active tender source.`;
      } else {
        status = "NOT_APPLICABLE";
      }
    } else if (tender.metadataContaminated === true && ENTITY_IDENTITY_FIELDS.has(fieldKey) && effectiveStr) {
      if (overrideMatchesGroundedSourceCheck()) {
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
      const normalizedConfirmed = normalizeFieldValue(fieldKey, effectiveStr);
      const normalizedRaw = normalizeFieldValue(fieldKey, rawValue ?? "");
      const isGroundedSource = isGroundedEvidence(evidence, activeTenderFileIds, activeFiles);
      const confirmedMatchesGroundedSource =
        validation.valid &&
        isGroundedSource &&
        normalizedConfirmed === normalizedRaw &&
        normalizedConfirmed !== "";
      if (confirmedMatchesGroundedSource) {
        status = "EXTRACTED_AND_GROUNDED";
      } else {
        status = isGroundedSource ? "MANUAL_CONFIRMED" : "NOT_FOUND_CONFIRMED";
        if (isCritical && status === "NOT_FOUND_CONFIRMED") {
          blockerReason = `Field "${label}" was manually confirmed but has no active tender-source evidence (page + quote + valid file). Link to an active tender source to unblock generation.`;
        } else if (isCritical && isGroundedSource && normalizedConfirmed !== normalizedRaw) {
          blockerReason = `Field "${label}" was manually confirmed with a value that does not match the active tender-source evidence. The confirmed value must exactly match the extracted source value.`;
        }
        // NOTE: valueDrivenEvidenceMandatory no longer sets a blockerReason.
        // Under the authority model, reference and submissionEmailSubject are
        // operational-warning fields — they NEVER block draft or final work.
      }
    } else if (override?.fieldState === "USER_EDITED") {
      if (overrideMatchesGroundedSourceCheck()) {
        status = "EXTRACTED_AND_GROUNDED";
      } else {
        status = isCritical ? "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED" : "MANUAL_OVERRIDE";
        if (isCritical) {
          blockerReason = `Field "${label}" has a candidate value that does not match active tender-source evidence. Critical fields remain blocked until the value exactly matches the grounded source evidence.`;
        }
        // NOTE: valueDrivenEvidenceMandatory no longer sets a blockerReason.
        // Under the authority model, reference and submissionEmailSubject are
        // operational-warning fields — they NEVER block draft or final work.
      }
    } else if (isGrounded) {
      status = "EXTRACTED_AND_GROUNDED";
    } else {
      status = "EXTRACTED_UNVERIFIED";
      if (isCritical) {
        // Rule 3 / Rule 8: Critical fields remain blocked until source-grounded.
        blockerReason = `Field "${label}" has a value but is not yet source-grounded (missing page, quote, or active file). Critical fields remain blocked until source-grounded.`;
      } else {
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

    const contaminated = status === "PORTAL_CONTAMINATION";
    const candidateUnconfirmed = status === "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED";
    const effectiveValid = validation.valid && !contaminated && !candidateUnconfirmed;
    const effectiveGrounded = isGrounded && !contaminated;

    // ─── Authority model (manual tender facts flexibility) ──────────────
    // DRAFT work (analysis, extraction, matching, BuildPlan, draft proposal)
    // is NEVER blocked by a manual value on a metadata field. The only
    // exception is `requiredDocuments` (a requirement-extraction concern,
    // handled above). A USER_EDITED or USER_CONFIRMED value — even without
    // source evidence — allows draft work to proceed.
    //
    // FINAL export requires SOURCE_GROUNDED OR HUMAN_CONFIRMED_OPERATIONAL
    // (with sufficient audit) on every submission-critical field.
    //
    // Reference and submissionEmailSubject previously became hard blockers
    // the moment they had ANY value. Under the authority model, these are operational-warning
    // fields — they NEVER block draft work, and only block final export when
    // they have a value but no grounding AND no audit. This removes the
    // "reference number becomes a hard blocker merely because it exists
    // without source evidence" rigidity.
    const isManualOverride = override?.fieldState === "USER_EDITED" || override?.fieldState === "USER_CONFIRMED";
    const isManualValuePresent = isManualOverride && !!effectiveStr?.trim();

    // Value-driven fields no longer hard-block draft work. They may still
    // block FINAL export if ungrounded AND unaudited through exportEligible below.

    // Determine gate eligibility
    const isBlocked = blockerReason !== null;
    // DRAFT: metadata is NEVER a hard blocker for draft work. Missing,
    // contaminated, placeholder, or invalid metadata values are treated
    // as unavailable — they are omitted from generated output and surfaced
    // as warnings, but they do NOT block analysis, draft generation,
    // support-file generation, regeneration, or review export.
    //
    // The only field that can block draft work is requiredDocuments
    // (handled above at lines 562-571) — when no requirements are
    // extracted at all, the draft has nothing to work with.
    const draftHardBlockReasons = false;

    // FINAL: blocked by missing critical field, manual value without
    // sufficient audit, contamination, placeholder, invalid format, or
    // BLOCKED status. Only FINAL_SUBMISSION_CHECK uses this gate.
    // Per Pillar 5: use applicability-aware blocking. Only block when the
    // field is genuinely indispensable for final delivery (deadline,
    // submissionMethod, clientName, title) or when the field has a BLOCKED
    // status (contamination, placeholder, invalid format). Non-indispensable
    // critical fields that are simply absent (NOT_STATED) do NOT block.
    const isIndispensable = INDISPENSABLE_FINAL_DELIVERY_FIELDS.has(fieldKey);
    const exportHardBlockReasons =
      status === "PORTAL_CONTAMINATION" ||
      status === "INTERNAL_PLACEHOLDER" ||
      status === "GENERIC_FIELD_LABEL" ||
      status === "INVALID_FORMAT" ||
      status === "BLOCKED" ||
      (isCritical && !isManualValuePresent && isBlocked && !isGrounded) ||
      (isIndispensable && !effectiveStr?.trim() && !override) || // only indispensable fields block when empty
      (isCritical && isManualValuePresent && !isGrounded && !(auditSufficientForFinal(override, fieldKey, policyCtx)));

    const generationEligible = !draftHardBlockReasons && (!isBlocked || (!isCritical && status !== "BLOCKED") || isManualValuePresent);
    const exportEligible = !exportHardBlockReasons && (!isBlocked || (!isCritical && status !== "BLOCKED") || (isManualValuePresent && auditSufficientForFinal(override, fieldKey, policyCtx)));
    const zipEligible = exportEligible; // ZIP = final export

    const isHardBlock = exportHardBlockReasons;
    if (isHardBlock) {
      // Metadata never blocks draft work — only export/final.
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

    // ── Source-driven requiredForFinal ─────────────────────────────────
    // A field is required for FINAL submission when:
    //   1. The legacy criticality says it's always-critical OR conditionally-critical
    //      (preserves backward compat with existing final-submission gates)
    //   2. OR the source-driven model says it's required for this tender
    //      (e.g. submissionEmails required when tender uses email method)
    // The OR preserves backward compat: legacy always-critical fields stay
    // required, AND source-driven tender-derived fields are also required.
    // NOTE: evaluationCriteria in canonical-field-state maps to
    // evaluationMethodology in the source-driven model (the field is named
    // "Evaluation criteria" in the UI but stored as evaluationMethodology).
    // The source-driven model uses the storage column name; we fall back to
    // both keys so the source-driven signal is not lost.
    const matchingFact = sourceDrivenDetail.facts.find((f) =>
      f.key === fieldKey
      || (fieldKey === "evaluationCriteria" && f.key === "evaluationMethodology")
    );
    const sourceDrivenRequired = matchingFact
      ? isFactRequiredForFinal(matchingFact, sourceDrivenDetail)
      : false;
    const requiredForFinal = isCritical || sourceDrivenRequired;

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
      requiredForFinal,
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

  // PORTAL one-of-two endpoint rule (mirrors the BuildPlan validator's portal
  // branch): a portal-method tender must have at least ONE fully grounded
  // declared endpoint (submission email or address). Per-field criticality
  // cannot express a one-of-two constraint, so it is enforced here as a
  // post-pass — otherwise both endpoint fields read as harmless warnings
  // while validateCriticalMetadataEvidenceForBuildPlan blocks the build.
  if (isPortalSubmissionMethod(effectiveSubmissionMethod)) {
    const emailsField = fields.find((f) => f.fieldKey === "submissionEmails");
    const addressField = fields.find((f) => f.fieldKey === "submissionAddress");
    let portalBlockReason: string | null = null;
    let fieldsToBlock: CanonicalFieldState[] = [];
    if (!portalHasEmailCandidate && !portalHasAddressCandidate) {
      portalBlockReason = "Portal submission requires at least one fully grounded endpoint (email or address with source file + page).";
      fieldsToBlock = [emailsField, addressField].filter((f): f is CanonicalFieldState => !!f);
    } else if (portalHasEmailCandidate) {
      // The validator picks the email endpoint and applies the full evidence
      // check to it — the resolver must agree that it is grounded.
      if (emailsField && !(emailsField.isGrounded && emailsField.effectiveValue)) {
        portalBlockReason = "Portal submission's email endpoint is not fully source-grounded (active file + page + contained quote required).";
        fieldsToBlock = [emailsField];
      }
    } else if (addressField && !(addressField.isGrounded && addressField.effectiveValue)) {
      portalBlockReason = "Portal submission's address endpoint is not fully source-grounded (active file + page + contained quote required).";
      fieldsToBlock = [addressField];
    }
    if (portalBlockReason && fieldsToBlock.length > 0) {
      for (const f of fieldsToBlock) {
        if (f.blockerReason === null) blockedCount++;
        f.blockerReason = f.blockerReason ?? portalBlockReason;
        // Authority model: portal endpoint without grounding blocks FINAL
        // export only (not draft). Draft work proceeds so the user can
        // manually enter the endpoint.
        f.exportEligible = false;
        f.zipEligible = false;
      }
      hasExportBlocker = true;
      hasZipBlocker = true;
    }
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
