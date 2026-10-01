// ─── Canonical tender-policy registry ────────────────────────────────────────
//
// SINGLE SOURCE OF TRUTH for which tender-metadata fields are critical, how
// override states behave, which fields may never be marked Not Applicable, and
// what consequences a field state has for the final generation / export / ZIP
// gates.
//
// Why this file exists (Manual Override & Evidence Policy, points 6–8):
//
//   Before this registry, THREE modules each hard-coded their own — and
//   conflicting — critical-field list:
//     • the old analysis/metadata-truth.ts (deleted) treated `reference` as critical
//     • lib/engine/tender-metadata-completeness.ts (treated `reference` as non-critical)
//     • lib/engine/metadata-override.ts          (omitted `reference`, added `evaluationCriteria`)
//   plus an inline hard-coded gate in app/api/tenders/[id]/generate/route.ts.
//
//   A field that is "critical" in one gate and "non-critical" in another lets
//   poor metadata slip through one path while being blocked on another. Policy
//   point 7 forbids that. Every gate must now consume THIS registry.
//
// Policy point 6 — one registry containing:
//   • always-critical fields
//   • conditionally-critical fields (predicate over submission method / tender)
//   • tender-specific fields derived from extracted requirements
//   • permitted override states
//   • final-generation and final-export consequences
//
// SCHEMA SAFETY: this module introduces no schema change. It only classifies
// fields the schema already stores.

import { isPhysicalSubmissionMethod, isEmailSubmissionMethod } from "./submission-method-policy";

// ─── Override-state vocabulary (mirrors metadata-override.ts) ─────────────────

export type MetadataFieldState =
  | "AI_EXTRACTED"
  | "USER_CONFIRMED"
  | "USER_EDITED"
  | "MISSING"
  | "NOT_APPLICABLE"
  | "IGNORED_WITH_REASON";

/** Override states that RESOLVE a field (stop it blocking) when applied. */
export const RESOLVING_OVERRIDE_STATES: ReadonlySet<MetadataFieldState> = new Set([
  "USER_CONFIRMED",
  "USER_EDITED",
  "NOT_APPLICABLE",
  "IGNORED_WITH_REASON",
]);

/**
 * A manual override is a VALID-but-UNGROUNDED state (Policy point 3). It never
 * carries tender-source evidence by itself, so it must never be labelled
 * "grounded" (Policy point 2) and must surface its full audit record.
 */
export const MANUAL_OVERRIDE_STATES: ReadonlySet<MetadataFieldState> = new Set([
  "USER_CONFIRMED",
  "USER_EDITED",
]);

/**
 * Audited ABSENCE states (Policy point 5). "Not stated in tender" is not a
 * value, not evidence, and not confirmation — it must not improve valid /
 * grounded / readiness metrics. It only stops a field from hard-blocking.
 */
export const ABSENCE_OVERRIDE_STATES: ReadonlySet<MetadataFieldState> = new Set([
  "NOT_APPLICABLE",
  "IGNORED_WITH_REASON",
]);

// ─── Field criticality ───────────────────────────────────────────────────────

/**
 * ALWAYS-critical fields. Missing/invalid → block final generation, export, ZIP
 * and submission packaging. This is the canonical reconciliation of the three
 * previously-divergent lists: it matches what the generation gate actually
 * enforces at runtime.
 *
 *   submissionEndpoint = a usable submission email list OR submission address
 *   requiredDocuments  = at least one extracted requirement / required document
 */
/**
 * Fields historically treated as "always critical." Under the source-driven
 * model, these are NOT universally critical for draft work — they are only
 * critical for Final Submission Check when the tender explicitly requires
 * them. The set is kept for backward compatibility with final-submission
 * gates but is no longer used to block draft generation.
 */
export const ALWAYS_CRITICAL_FIELDS: ReadonlySet<string> = new Set([
  "clientName",
  "title",
  "submissionMethod",
  "submissionEndpoint",
  "deadline",
  "requiredDocuments",
]);

/**
 * Fields that may NEVER be dismissed with Not Applicable / Ignored. The
 * submission deadline governs scheduling and final-approval rules; a tender
 * without a deadline cannot be safely packaged, so "N/A" is never a valid
 * resolution for it.
 */
export const NEVER_NOT_APPLICABLE: ReadonlySet<string> = new Set([
  "deadline",
]);

/**
 * Non-critical fields — surfaced as warnings, never block generation/export.
 * `reference` and `evaluationCriteria` live here: this is the canonical
 * resolution of the prior conflict (the generation gate already treated both
 * as non-blocking at runtime).
 */
export const NON_CRITICAL_FIELDS: ReadonlySet<string> = new Set([
  "reference",
  "country",
  "currency",
  "clientContactName",
  "clientContactEmail",
  "clientContactPhone",
  "evaluationCriteria",
  "pageLimit",
  "bidBond",
  "siteVisit",
  "proposalValidity",
  "budget",
  "numberOfCopiesRequired",
  "preBidMeetingDate",
  "preBidMeetingLocation",
  "clientCity",
  "clientAddress",
  "clientWebsite",
  "submissionEmailSubject",
  "preBidChannel",
  "clientRepresentative",
  "legalClientName",
  "donorAgency",
  "implementingAgency",
]);

/**
 * Context used to decide CONDITIONALLY-critical fields. These depend on the
 * submission method and on what the tender itself requires (Policy point 6,
 * "conditionally critical fields based on submission method and tender
 * requirements").
 */
export type TenderPolicyContext = {
  /** True only when the tender explicitly requires an email subject line (evidence-backed, not inferred from "email" in method). */
  requiresEmailSubjectExplicitlyStated?: boolean;
  submissionMethod?: string | null;
};

/**
 * Returns true when a field is CONDITIONALLY critical for this tender.
 *
 *   submissionAddress     — critical when the method is physical / sealed
 *                           envelope (the bidder cannot deliver without it).
 *   submissionEmails      — critical when the method is email-based (the
 *                           BuildPlan validator hard-requires a grounded
 *                           email endpoint for email submission; the panel
 *                           must block on the same rule).
 *   submissionEmailSubject — critical when the method is email-based AND the
 *                           tender specifies a required subject line.
 */
export function isConditionallyCriticalField(
  field: string,
  ctx: TenderPolicyContext,
): boolean {
  if (field === "submissionAddress") {
    return isPhysicalSubmissionMethod(ctx.submissionMethod);
  }
  if (field === "submissionEmails") {
    return isEmailSubmissionMethod(ctx.submissionMethod);
  }
  if (field === "submissionEmailSubject") {
    // Email subject is critical ONLY when the tender explicitly requires it.
    // Do NOT infer it from the word "email" alone in the submission method.
    return Boolean(ctx.requiresEmailSubjectExplicitlyStated) && isEmailSubmissionMethod(ctx.submissionMethod);
  }
  return false;
}

/**
 * Canonical criticality decision. Used by Final Submission Check gates.
 * For DRAFT work, no field is critical — metadata is optional.
 * Every gate must call this rather than consulting its own list.
 */
export function isCriticalField(field: string, ctx: TenderPolicyContext = {}): boolean {
  if (ALWAYS_CRITICAL_FIELDS.has(field)) return true;
  return isConditionallyCriticalField(field, ctx);
}

/** True when a field may be marked Not Applicable / Ignored at all. */
export function canBeNotApplicable(field: string): boolean {
  return !NEVER_NOT_APPLICABLE.has(field);
}

// ─── User-facing field labels ────────────────────────────────────────────────
//
// Policy / safety rule: never expose raw DB column names to users. Every gate
// and panel resolves display text through this map.

export const FIELD_DISPLAY_LABELS: Record<string, string> = {
  clientName:           "Client / procuring entity",
  procuringEntityName:  "Procuring entity",
  title:                "Tender title",
  reference:            "Reference number",
  deadline:             "Submission deadline",
  country:              "Country",
  currency:             "Currency",
  submissionMethod:     "Submission method",
  submissionEndpoint:   "Submission endpoint",
  submissionAddress:    "Submission address",
  submissionEmails:     "Submission email(s)",
  submissionEmailSubject: "Required email subject line",
  requiredDocuments:    "Required documents",
  evaluationCriteria:   "Evaluation criteria",
  clientContactName:    "Contact person",
  clientContactEmail:   "Contact email",
  clientContactPhone:   "Contact phone",
  clientCity:           "Client city / location",
  clientAddress:        "Client address",
  clientWebsite:        "Client website / portal",
  clientRepresentative: "Client representative",
  legalClientName:      "Full legal client name",
  donorAgency:          "Donor / funding agency",
  implementingAgency:   "Implementing agency",
  preBidChannel:        "Pre-bid clarification channel",
  preBidMeetingDate:    "Pre-bid meeting date",
  preBidMeetingLocation:"Pre-bid meeting location",
  pageLimit:            "Page limit",
  bidBond:              "Bid bond / security",
  siteVisit:            "Mandatory site visit",
  proposalValidity:     "Proposal validity period",
  budget:               "Budget",
  numberOfCopiesRequired:"Number of copies required",
};

/** Resolve a user-facing label for a field key, never the raw column name. */
export function fieldDisplayLabel(field: string): string {
  return FIELD_DISPLAY_LABELS[field] ?? field;
}

// ─── Final-gate consequences ─────────────────────────────────────────────────
//
// Centralises the rule that critical fields block, and that absence / manual
// override does NOT silently unlock generation, export, or ZIP (Policy point 4).

export type GateConsequence = {
  /** Blocks document generation when this field is unusable. */
  blocksGeneration: boolean;
  /** Blocks Export / final ZIP when this field is unusable. */
  blocksExport: boolean;
};

export function gateConsequenceForField(field: string, ctx: TenderPolicyContext = {}): GateConsequence {
  const critical = isCriticalField(field, ctx);
  // Metadata never blocks draft work. Only export/final submission is blocked
  // by missing critical metadata.
  return { blocksGeneration: false, blocksExport: critical };
}
