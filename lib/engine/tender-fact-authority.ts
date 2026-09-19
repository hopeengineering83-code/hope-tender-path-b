/**
 * Tender Fact Authority Model
 *
 * One clear authority class for every tender fact. Replaces the implicit
 * "override must match raw tender scalar + grounded source" rule with an
 * explicit, auditable authority classification.
 *
 * Authority classes:
 *
 * 1. SOURCE_GROUNDED
 *    The value came from an active tender source file with file, page,
 *    quote, and content-hash evidence. This is the strongest authority.
 *    Satisfies ALL gates (draft + final).
 *
 * 2. HUMAN_CONFIRMED_OPERATIONAL
 *    An authorized Admin or Proposal Manager entered or confirmed the
 *    value because it is known from a procurement notice, email
 *    invitation, portal, phone call, client instruction, or other
 *    legitimate external operational source.
 *
 *    - Accepted for ALL draft work (analysis, extraction, matching,
 *      BuildPlan, draft proposal).
 *    - Accepted for FINAL export ONLY when the field is
 *      submission-critical AND the user provided a meaningful audit
 *      reason + confirmation basis.
 *    - NEVER displayed as "extracted from tender source."
 *    - Re-extraction must NEVER erase a valid HUMAN_CONFIRMED_OPERATIONAL
 *      value.
 *
 * 3. NOT_STATED_IN_SOURCE
 *    The tender source does not state the value. The user has audited
 *    the source and confirmed absence. Non-blocking for all workflows.
 *
 * 4. UNKNOWN
 *    No usable value exists. No override has been recorded.
 *    - For optional operational fields: non-blocking (warning only).
 *    - For submission-critical fields: blocks FINAL export only (draft
 *      work proceeds).
 *
 * 5. REJECTED_CANDIDATE
 *    A bad extraction candidate: "Not", "Only", footer text, heading,
 *    placeholder, partial email, or corrupted OCR fragment. The value
 *    is discarded and the field reverts to UNKNOWN.
 *
 * DRAFT vs FINAL distinction:
 *   - DRAFT work (analysis, extraction, matching, BuildPlan, draft
 *     proposal) is NEVER blocked by metadata authority. The only
 *     exception is `requiredDocuments` (a requirement-extraction
 *     concern, not a metadata concern).
 *   - FINAL export requires:
 *       * SOURCE_GROUNDED OR HUMAN_CONFIRMED_OPERATIONAL on every
 *         submission-critical field (clientName, title, deadline,
 *         submissionMethod, submissionEndpoint).
 *       * A meaningful audit reason + confirmation basis for every
 *         HUMAN_CONFIRMED_OPERATIONAL value used in the final package.
 *
 * This module is PURE — no DB access. It consumes the same inputs as
 * the canonical resolver and produces an authority classification that
 * the resolver, the gates, and the UI all consume.
 */

import type { TenderMetadataOverride } from "@prisma/client";
import { isCriticalField, type TenderPolicyContext } from "./tender-policy-registry";
import {
  isEmailSubmissionMethod,
  isPhysicalSubmissionMethod,
  isPortalSubmissionMethod,
} from "./submission-method-policy";
import {
  OPERATIONAL_WARNING_FIELDS as CANONICAL_OPERATIONAL_WARNING_FIELDS,
  SUBMISSION_CRITICAL_FIELDS as CANONICAL_SUBMISSION_CRITICAL_FIELDS,
} from "./draft-final-gate-separation";

// ─── Authority classes ─────────────────────────────────────────────────────

export type TenderFactAuthority =
  | "SOURCE_GROUNDED"
  | "HUMAN_CONFIRMED_OPERATIONAL"
  | "NOT_STATED_IN_SOURCE"
  | "UNKNOWN"
  | "REJECTED_CANDIDATE";

// ─── Audit requirement ─────────────────────────────────────────────────────

/**
 * The audit context for a HUMAN_CONFIRMED_OPERATIONAL value.
 *
 * Required for FINAL export when the field is submission-critical.
 * Optional (but recommended) for draft work.
 */
export type HumanConfirmedAudit = {
  /** The user-typed reason for the manual entry (≥ 10 chars for critical fields). */
  reason: string;
  /** The basis for the confirmation — where the user learned the value. */
  confirmationBasis: ConfirmationBasis;
  /** The user ID of the confirmer. */
  confirmedBy: string;
  /** When the confirmation was recorded. */
  confirmedAt: Date;
};

/**
 * The legitimate external sources a user can cite for a
 * HUMAN_CONFIRMED_OPERATIONAL value.
 *
 * These are the SAME for all tender types (RFP, RFQ, EOI, REOI, ITB,
 * works, consultancy, goods) and all procurement methods (email,
 * portal, physical).
 */
export const CONFIRMATION_BASES = [
  "PROCUREMENT_NOTICE",
  "EMAIL_INVITATION",
  "PORTAL_LISTING",
  "PHONE_CALL_WITH_CLIENT",
  "CLIENT_INSTRUCTION",
  "PRE_BID_MEETING",
  "CLARIFICATION_DOCUMENT",
  "PRIOR_KNOWLEDGE_OF_CLIENT",
  "PUBLIC_REGISTRY",
  "OTHER_DOCUMENTED_SOURCE",
] as const;

export type ConfirmationBasis = (typeof CONFIRMATION_BASES)[number];

/**
 * The minimum reason length for a HUMAN_CONFIRMED_OPERATIONAL value on
 * a submission-critical field. The reason must be meaningful (not a
 * boilerplate string) so the audit trail is useful.
 */
export const MIN_CRITICAL_REASON_LENGTH = 10;

// ─── Field classification ──────────────────────────────────────────────────

/**
 * The operational-warning fields. These NEVER block any workflow — draft
 * or final.
 *
 * Re-exported (not re-declared) from draft-final-gate-separation.ts, the
 * canonical source, so the two modules cannot silently drift apart again.
 */
export const OPERATIONAL_WARNING_FIELDS = CANONICAL_OPERATIONAL_WARNING_FIELDS;

/**
 * The submission-critical fields. These are the ONLY fields that can
 * block FINAL export. They NEVER block draft work.
 *
 * `submissionEndpoint` is virtual — it's either `submissionEmails` or
 * `submissionAddress` depending on the method.
 *
 * Re-exported (not re-declared) from draft-final-gate-separation.ts, the
 * canonical source, so the two modules cannot silently drift apart.
 * Previously this was a byte-for-byte duplicate Set declaration —
 * consolidated to prevent divergence.
 */
export const SUBMISSION_CRITICAL_FIELDS = CANONICAL_SUBMISSION_CRITICAL_FIELDS;

/**
 * Check if a field is an operational-warning field (never blocks).
 */
export function isOperationalWarningField(field: string): boolean {
  return OPERATIONAL_WARNING_FIELDS.has(field);
}

/**
 * Check if a field is submission-critical (blocks final export only).
 */
export function isSubmissionCriticalField(field: string): boolean {
  return SUBMISSION_CRITICAL_FIELDS.has(field);
}

/**
 * Check if a field is conditionally submission-critical based on the
 * submission method. Delegates to the policy registry.
 */
export function isConditionallySubmissionCritical(
  field: string,
  policyCtx: TenderPolicyContext,
): boolean {
  if (SUBMISSION_CRITICAL_FIELDS.has(field)) return false; // always-critical, not conditional
  return isCriticalField(field, policyCtx);
}

// ─── REJECTED_CANDIDATE detection ──────────────────────────────────────────

/**
 * The set of values that are ALWAYS rejected as extraction candidates.
 * These are the "bad extraction" examples from the mission spec.
 */
const REJECTED_VALUES = new Set([
  "not",
  "only",
  "n/a",
  "na",
  "tbd",
  "tba",
  "tbc",
  "none",
  "null",
  "undefined",
  "unknown",
  "not specified",
  "not set",
  "not applicable",
  "to be confirmed",
  "to be determined",
  "to be advised",
  "pending",
  "awaiting",
  "refer",
  "see above",
  "see below",
  "reference number",
  "tender reference",
  "client name",
  "deadline",
  "submission method",
]);

/**
 * Check if an extracted value is a REJECTED_CANDIDATE.
 *
 * A value is rejected when:
 *   - It's a known placeholder ("TBD", "N/A", "Not", "Only", etc.)
 *   - It's a generic field label ("Reference Number", "Client Name")
 *   - It's a partial email (no @ or no domain)
 *   - It's too short (< 2 chars after trim)
 *   - It's a table heading or footer fragment
 */
export function isRejectedCandidate(value: string | null | undefined): boolean {
  if (!value) return false; // empty is UNKNOWN, not REJECTED
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length < 2) return true;
  if (REJECTED_VALUES.has(trimmed)) return true;
  // Partial email: contains "@" but no valid local-part + domain structure.
  // A valid email must have: non-empty local part + @ + non-empty domain part with a dot.
  if (trimmed.includes("@") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return true;
  // Footer fragment: starts with "page " followed by digits
  if (/^page\s+\d+\s+of\s+\d+$/i.test(trimmed)) return true;
  return false;
}

// ─── Authority classification ──────────────────────────────────────────────

/**
 * The input shape for classifyTenderFactAuthority.
 *
 * This mirrors the inputs the canonical resolver already has, so the
 * authority model can be computed alongside the canonical status
 * without additional DB queries.
 */
export type AuthorityClassificationInput = {
  field: string;
  /** The effective value (override ?? raw tender scalar). */
  effectiveValue: string | null;
  /** The raw tender scalar value (before override). */
  rawValue: string | null;
  /** The override row, if any. */
  override: TenderMetadataOverride | null;
  /** Whether source evidence (fileId + page + quote) exists and is grounded. */
  isSourceGrounded: boolean;
  /** The policy context (submission method). */
  policyCtx: TenderPolicyContext;
  /** The audit context for HUMAN_CONFIRMED_OPERATIONAL values. */
  audit?: HumanConfirmedAudit | null;
};

/**
 * The result of classifying a tender fact's authority.
 */
export type AuthorityClassification = {
  authority: TenderFactAuthority;
  /** True if this field blocks DRAFT work (always false except for requiredDocuments). */
  blocksDraft: boolean;
  /** True if this field blocks FINAL export. */
  blocksFinalExport: boolean;
  /** The reason for blocking (if any). */
  blockerReason: string | null;
  /** The audit context (only for HUMAN_CONFIRMED_OPERATIONAL). */
  audit: HumanConfirmedAudit | null;
  /** Whether the audit is sufficient for final export (critical fields only). */
  auditSufficientForFinal: boolean;
};

/**
 * Classify a tender fact's authority.
 *
 * This is the SINGLE source of truth for "does this manual value block
 * draft or final work?" It replaces the scattered logic in
 * canonical-field-state.ts's `overrideMatchesGroundedSourceCheck` and
 * `valueDrivenEvidenceMandatory`.
 *
 * Rules:
 *   1. If the value is a REJECTED_CANDIDATE → REJECTED_CANDIDATE (no block,
 *      but the value is discarded → reverts to UNKNOWN).
 *   2. If the override is NOT_APPLICABLE or IGNORED_WITH_REASON and the
 *      field is operational → NOT_STATED_IN_SOURCE (no block).
 *   3. If the override is NOT_APPLICABLE or IGNORED_WITH_REASON and the
 *      field is submission-critical → NOT_STATED_IN_SOURCE (blocks final
 *      export — the user confirmed the tender doesn't state it, so the
 *      final package can't proceed without an external source).
 *   4. If isSourceGrounded AND the override value matches the raw value
 *      (or there's no override) → SOURCE_GROUNDED (no block).
 *   5. If isSourceGrounded AND the override value DIFFERS from the raw
 *      value → still SOURCE_GROUNDED if the override value itself is
 *      grounded (the user corrected the value AND the corrected value
 *      is in the source). Otherwise HUMAN_CONFIRMED_OPERATIONAL.
 *   6. If the override is USER_EDITED or USER_CONFIRMED and there's NO
 *      source grounding → HUMAN_CONFIRMED_OPERATIONAL.
 *      - For operational fields: no block (draft or final).
 *      - For submission-critical fields: blocks final export UNLESS the
 *        audit is sufficient (reason ≥ MIN_CRITICAL_REASON_LENGTH +
 *        confirmationBasis set + authorized role).
 *   7. If no value and no override → UNKNOWN.
 *      - For operational fields: no block.
 *      - For submission-critical fields: blocks final export only.
 */
export function classifyTenderFactAuthority(
  input: AuthorityClassificationInput,
): AuthorityClassification {
  const { field, effectiveValue, override, isSourceGrounded, policyCtx, audit } = input;

  // Rule 1: REJECTED_CANDIDATE
  if (isRejectedCandidate(effectiveValue)) {
    return {
      authority: "REJECTED_CANDIDATE",
      blocksDraft: false,
      blocksFinalExport: false, // The value is discarded → reverts to UNKNOWN
      blockerReason: null,
      audit: null,
      auditSufficientForFinal: false,
    };
  }

  const isOperational = isOperationalWarningField(field);
  const isAlwaysCritical = SUBMISSION_CRITICAL_FIELDS.has(field);
  const isConditionallyCritical = isConditionallySubmissionCritical(field, policyCtx);
  const isCritical = isAlwaysCritical || isConditionallyCritical;

  // Rule 2 & 3: NOT_STATED_IN_SOURCE (NOT_APPLICABLE or IGNORED_WITH_REASON)
  if (override && (override.fieldState === "NOT_APPLICABLE" || override.fieldState === "IGNORED_WITH_REASON")) {
    return {
      authority: "NOT_STATED_IN_SOURCE",
      blocksDraft: false, // Never blocks draft
      blocksFinalExport: isCritical, // Blocks final only for critical fields
      blockerReason: isCritical
        ? `Field "${field}" is submission-critical and was confirmed not stated in the tender source. Provide a HUMAN_CONFIRMED_OPERATIONAL value from an external source to proceed with final export.`
        : null,
      audit: null,
      auditSufficientForFinal: false,
    };
  }

  // Rule 4 & 5: SOURCE_GROUNDED
  if (isSourceGrounded && effectiveValue && effectiveValue.trim()) {
    return {
      authority: "SOURCE_GROUNDED",
      blocksDraft: false,
      blocksFinalExport: false,
      blockerReason: null,
      audit: null,
      auditSufficientForFinal: true,
    };
  }

  // Rule 6: HUMAN_CONFIRMED_OPERATIONAL (USER_EDITED or USER_CONFIRMED without grounding)
  if (override && (override.fieldState === "USER_EDITED" || override.fieldState === "USER_CONFIRMED") && effectiveValue && effectiveValue.trim()) {
    // Compute audit sufficiency for critical fields
    const auditSufficientForFinal = isCritical
      ? Boolean(audit &&
        audit.reason &&
        audit.reason.trim().length >= MIN_CRITICAL_REASON_LENGTH &&
        CONFIRMATION_BASES.includes(audit.confirmationBasis) &&
        audit.confirmedBy)
      : true; // Non-critical fields don't need audit for final

    return {
      authority: "HUMAN_CONFIRMED_OPERATIONAL",
      blocksDraft: false, // NEVER blocks draft work
      blocksFinalExport: isCritical && !auditSufficientForFinal,
      blockerReason: (isCritical && !auditSufficientForFinal)
        ? `Field "${field}" has a human-confirmed operational value but the audit is incomplete. Provide a meaningful reason (≥ ${MIN_CRITICAL_REASON_LENGTH} chars) and a confirmation basis to proceed with final export.`
        : null,
      audit: audit ?? null,
      auditSufficientForFinal,
    };
  }

  // Rule 7: UNKNOWN
  return {
    authority: "UNKNOWN",
    blocksDraft: false, // Never blocks draft
    blocksFinalExport: isCritical, // Blocks final only for critical fields
    blockerReason: isCritical
      ? `Field "${field}" is submission-critical and has no value. Enter a value manually or extract from the tender source to proceed with final export.`
      : null,
    audit: null,
    auditSufficientForFinal: false,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Check if an authority classification allows draft work.
 *
 * Draft work includes: analysis, extraction, matching, BuildPlan,
 * draft proposal generation. Only `requiredDocuments` (a requirement-
 * extraction concern) can block draft work — and that's handled
 * outside the authority model.
 */
export function authorityAllowsDraft(classification: AuthorityClassification): boolean {
  return !classification.blocksDraft;
}

/**
 * Check if an authority classification allows final export.
 *
 * Final export requires SOURCE_GROUNDED or HUMAN_CONFIRMED_OPERATIONAL
 * (with sufficient audit) on every submission-critical field.
 */
export function authorityAllowsFinalExport(classification: AuthorityClassification): boolean {
  return !classification.blocksFinalExport;
}

/**
 * Get a human-readable label for an authority class.
 *
 * Used by the UI to show the authority alongside each field.
 */
export function authorityLabel(authority: TenderFactAuthority): string {
  switch (authority) {
    case "SOURCE_GROUNDED":
      return "Source-grounded confirmed";
    case "HUMAN_CONFIRMED_OPERATIONAL":
      return "Human-confirmed operational value";
    case "NOT_STATED_IN_SOURCE":
      return "Not stated in source";
    case "UNKNOWN":
      return "Not detected";
    case "REJECTED_CANDIDATE":
      return "Candidate needs review";
  }
}

/**
 * Get a human-readable description of the impact.
 *
 * Used by the UI to show "Warning only", "Allows draft work",
 * "Required before final submission", or "Final-submission check
 * satisfied by authorized human confirmation".
 */
export function authorityImpactDescription(classification: AuthorityClassification): string {
  if (classification.blocksDraft) {
    return "Blocks draft work";
  }
  if (classification.blocksFinalExport) {
    return "Required before final submission";
  }
  if (classification.authority === "HUMAN_CONFIRMED_OPERATIONAL" && classification.auditSufficientForFinal) {
    return "Final-submission check satisfied by authorized human confirmation";
  }
  if (classification.authority === "SOURCE_GROUNDED") {
    return "Allows draft and final work";
  }
  if (classification.authority === "UNKNOWN" || classification.authority === "NOT_STATED_IN_SOURCE") {
    return "Warning only";
  }
  return "Allows draft work";
}

/**
 * Check if a confirmation basis is valid.
 */
export function isValidConfirmationBasis(basis: string): basis is ConfirmationBasis {
  return (CONFIRMATION_BASES as readonly string[]).includes(basis);
}

/**
 * Check if a reason is meaningful (not a boilerplate string).
 *
 * The reason must be:
 *   - At least MIN_CRITICAL_REASON_LENGTH characters (for critical fields)
 *   - Not one of the known boilerplate strings the UI used to hardcode
 */
const BOILERPLATE_REASONS = new Set([
  "manual value entered by user.",
  "confirmed from client & submission details panel.",
  "marked not applicable by user.",
  "user confirmed this detail was not found in the tender.",
  "manual value entered",
  "confirmed by user",
  "user entered",
]);

export function isMeaningfulReason(reason: string | null | undefined, minLength: number = MIN_CRITICAL_REASON_LENGTH): boolean {
  if (!reason) return false;
  const trimmed = reason.trim();
  if (trimmed.length < minLength) return false;
  if (BOILERPLATE_REASONS.has(trimmed.toLowerCase())) return false;
  return true;
}
