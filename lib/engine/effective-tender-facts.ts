/**
 * Effective Tender Facts Resolver
 *
 * The single server-side function that merges:
 * - source-grounded Tender scalar values;
 * - active metadata overrides (USER_EDITED, USER_CONFIRMED, NOT_APPLICABLE, IGNORED_WITH_REASON);
 * - human-confirmed operational values with audit context;
 * - derived submission-method context (normalized method);
 * - manual requirements where applicable.
 *
 * All downstream consumers MUST use this one effective fact view:
 * - canonical field resolver;
 * - BuildPlan hash;
 * - BuildPlan builder;
 * - readiness snapshot;
 * - proposal title;
 * - cover letter;
 * - company matching context;
 * - document headers;
 * - filenames;
 * - submission instructions;
 * - final ZIP manifest;
 * - export readiness;
 * - UI panels.
 *
 * This function does NOT write manual values into raw source-extracted columns.
 * It returns a merged view that consumers use read-only.
 */

import type { TenderMetadataOverride } from "@prisma/client";
import { normalizeSubmissionMethod, type NormalizedSubmissionMethod } from "./submission-method-policy";

// ─── Types ──────────────────────────────────────────────────────────────────

export type EffectiveTenderFact = {
  /** The field key (e.g., "clientName", "deadline", "submissionMethod"). */
  field: string;
  /** The effective value (override ?? raw). */
  effectiveValue: string | null;
  /** The raw tender scalar value (before override). */
  rawValue: string | null;
  /** The override row, if any. */
  override: TenderMetadataOverride | null;
  /** The authority class of this fact. */
  authorityClass: "SOURCE_GROUNDED" | "HUMAN_CONFIRMED_OPERATIONAL" | "NOT_STATED_IN_SOURCE" | "UNKNOWN" | "REJECTED_CANDIDATE";
  /** The normalized submission method (only for the "submissionMethod" field). */
  normalizedMethod?: NormalizedSubmissionMethod;
  /** The audit reason (only for HUMAN_CONFIRMED_OPERATIONAL). */
  reason?: string | null;
  /** The confirmation basis (only for HUMAN_CONFIRMED_OPERATIONAL). */
  confirmationBasis?: string | null;
  /** When the fact was confirmed. */
  confirmedAt?: Date | null;
};

export type EffectiveTenderFacts = {
  /** Per-field effective facts. */
  facts: Map<string, EffectiveTenderFact>;
  /** The normalized submission method derived from the effective submission method. */
  normalizedSubmissionMethod: NormalizedSubmissionMethod;
  /** The effective submission method value. */
  effectiveSubmissionMethod: string | null;
  /** The effective deadline (as a Date if parseable). */
  effectiveDeadline: Date | null;
  /** The effective client name. */
  effectiveClientName: string | null;
  /** The effective title. */
  effectiveTitle: string | null;
  /** The effective reference number. */
  effectiveReference: string | null;
  /** The effective submission emails (as an array, split on pipe). */
  effectiveSubmissionEmails: string[];
  /** The effective submission address. */
  effectiveSubmissionAddress: string | null;
  /** The effective submission email subject. */
  effectiveSubmissionEmailSubject: string | null;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve the effective value for a field: override value when a
 * USER_EDITED/USER_CONFIRMED override exists, else the raw tender column.
 */
function resolveEffectiveValue(
  field: string,
  rawValue: string | null | undefined,
  overrides: Map<string, TenderMetadataOverride>,
): string | null {
  const ov = overrides.get(field);
  if (ov && (ov.fieldState === "USER_EDITED" || ov.fieldState === "USER_CONFIRMED")) {
    return ov.overrideValue ?? null;
  }
  return rawValue ?? null;
}

/**
 * Determine the authority class for a field based on its override state
 * and whether it has a value.
 */
function determineAuthorityClass(
  field: string,
  effectiveValue: string | null,
  override: TenderMetadataOverride | null,
): EffectiveTenderFact["authorityClass"] {
  if (!effectiveValue || !effectiveValue.trim()) {
    if (override?.fieldState === "NOT_APPLICABLE" || override?.fieldState === "IGNORED_WITH_REASON") {
      return "NOT_STATED_IN_SOURCE";
    }
    return "UNKNOWN";
  }
  if (override && (override.fieldState === "USER_EDITED" || override.fieldState === "USER_CONFIRMED")) {
    return "HUMAN_CONFIRMED_OPERATIONAL";
  }
  if (override?.fieldState === "NOT_APPLICABLE" || override?.fieldState === "IGNORED_WITH_REASON") {
    return "NOT_STATED_IN_SOURCE";
  }
  // No override — check if the value is garbage
  // (delegated to the canonical resolver's validation)
  return "SOURCE_GROUNDED";
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve the effective tender facts from raw tender values + overrides.
 *
 * This is the SINGLE function all downstream consumers should use to get
 * the effective view of tender metadata. It merges source-grounded values
 * with human-confirmed overrides and provides a normalized submission method.
 *
 * @param tender - The raw tender object with scalar columns.
 * @param overrides - The active TenderMetadataOverride rows for this tender.
 * @returns The effective tender facts view.
 */
export function resolveEffectiveTenderFacts(
  tender: Record<string, unknown>,
  overrides: TenderMetadataOverride[],
): EffectiveTenderFacts {
  const overrideMap = new Map(overrides.map((o) => [o.field, o]));
  const facts = new Map<string, EffectiveTenderFact>();

  // Resolve all known metadata fields
  const knownFields = [
    "title", "reference", "clientName", "deadline", "submissionMethod",
    "submissionAddress", "submissionEmails", "submissionEmailSubject",
    "country", "currency", "donorAgency", "implementingAgency", "legalClientName",
    "clientContactName", "clientContactTitle", "clientContactEmail", "clientContactPhone",
    "clientAddress", "clientCity", "clientWebsite", "clientRepresentative",
    "preBidChannel", "preBidMeetingDate", "preBidMeetingLocation",
    "evaluationCriteria", "evaluationMethodology",
    "pageLimit", "validityDays", "bidBondAmount", "bidBondCurrency",
    "numberOfCopiesRequired", "mandatorySiteVisit", "budget", "category",
  ];

  for (const field of knownFields) {
    const rawValue = tender[field] != null ? String(tender[field]) : null;
    const override = overrideMap.get(field) ?? null;
    const effectiveValue = resolveEffectiveValue(field, rawValue, overrideMap);
    const authorityClass = determineAuthorityClass(field, effectiveValue, override);

    const fact: EffectiveTenderFact = {
      field,
      effectiveValue,
      rawValue,
      override,
      authorityClass,
    };

    // Add audit context for HUMAN_CONFIRMED_OPERATIONAL
    if (authorityClass === "HUMAN_CONFIRMED_OPERATIONAL" && override) {
      fact.reason = override.reason;
      fact.confirmationBasis = override.confirmationBasis;
      fact.confirmedAt = override.confirmedAt;
    }

    // Add normalized method for the submissionMethod field
    if (field === "submissionMethod") {
      fact.normalizedMethod = normalizeSubmissionMethod(effectiveValue);
    }

    facts.set(field, fact);
  }

  // Extract key effective values for convenience
  const effectiveSubmissionMethod = resolveEffectiveValue("submissionMethod", tender.submissionMethod as string | null, overrideMap);
  const effectiveDeadlineStr = resolveEffectiveValue("deadline", tender.deadline ? new Date(tender.deadline as string).toISOString() : null, overrideMap);
  const effectiveSubmissionEmailsStr = resolveEffectiveValue("submissionEmails", tender.submissionEmails as string | null, overrideMap);

  // Parse deadline
  let effectiveDeadline: Date | null = null;
  if (effectiveDeadlineStr) {
    const parsed = new Date(effectiveDeadlineStr);
    if (!isNaN(parsed.getTime())) effectiveDeadline = parsed;
  }

  // Split submission emails on pipe separator
  const effectiveSubmissionEmails = effectiveSubmissionEmailsStr
    ? effectiveSubmissionEmailsStr.split("|").map((e) => e.trim()).filter(Boolean)
    : [];

  return {
    facts,
    normalizedSubmissionMethod: normalizeSubmissionMethod(effectiveSubmissionMethod),
    effectiveSubmissionMethod,
    effectiveDeadline,
    effectiveClientName: resolveEffectiveValue("clientName", tender.clientName as string | null, overrideMap),
    effectiveTitle: resolveEffectiveValue("title", tender.title as string | null, overrideMap),
    effectiveReference: resolveEffectiveValue("reference", tender.reference as string | null, overrideMap),
    effectiveSubmissionEmails,
    effectiveSubmissionAddress: resolveEffectiveValue("submissionAddress", tender.submissionAddress as string | null, overrideMap),
    effectiveSubmissionEmailSubject: resolveEffectiveValue("submissionEmailSubject", tender.submissionEmailSubject as string | null, overrideMap),
  };
}
