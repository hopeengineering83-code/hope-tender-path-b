import type { PrismaClient } from "@prisma/client";
import { assessTenderMetadataCompleteness } from "../tender-metadata-completeness";
import {
  containsMetadataPlaceholder,
  isValidClientName,
  isValidReferenceNumber,
  isGenericFieldLabel,
  isAmbiguousDateString,
} from "../metadata-validators";

export type MetadataFactStatus =
  | "EXTRACTED_AND_GROUNDED"   // Valid value + source evidence present
  | "EXTRACTED_UNVERIFIED"     // Value present; no source evidence yet
  | "MANUAL_OVERRIDE"          // User entered a value (not yet confirmed)
  | "MANUAL_CONFIRMED"         // User explicitly confirmed a value after review
  | "NOT_FOUND_CONFIRMED"      // User confirmed field is genuinely absent
  | "NOT_APPLICABLE"           // Field does not apply to this tender
  | "AMBIGUOUS_SOURCE_TEXT"    // Value exists but cannot be trusted (short, ambiguous date, etc.)
  | "AMBIGUOUS_DATE"           // Date format is ambiguous — must be confirmed via date picker
  | "GENERIC_FIELD_LABEL"      // Extracted value is a field heading, not real data
  | "INTERNAL_PLACEHOLDER"     // Contains TBD / N/A / "Bid-Team to confirm" etc.
  | "PORTAL_CONTAMINATION"     // Client name is contaminated by portal/navigation text
  | "INVALID_FORMAT"           // Format validation failed (e.g., reference has no digit)
  | "INVALID";                 // Default / error state (no value, no override)

/** User-facing display labels for every DB field key shown in the truth panel. */
export const FIELD_DISPLAY_LABELS: Record<string, string> = {
  clientName:          "Client / procuring entity",
  title:               "Tender title",
  reference:           "Reference number",
  deadline:            "Submission deadline",
  country:             "Country",
  submissionMethod:    "Submission method",
  submissionAddress:   "Submission address",
  submissionEmails:    "Submission email(s)",
  currency:            "Currency",
  clientContactName:   "Contact person",
};

/** Blocker reasons shown to the user when a field prevents generation/export. */
const BLOCKER_REASONS: Partial<Record<MetadataFactStatus, string>> = {
  INVALID:               "No value detected. Manual input required.",
  GENERIC_FIELD_LABEL:   "Extracted value is a field heading, not real data. Re-run AI Analyze or enter manually.",
  INTERNAL_PLACEHOLDER:  "Value contains a placeholder (TBD / N/A / Bid-Team to confirm). Replace with the actual value.",
  PORTAL_CONTAMINATION:  "Client name is contaminated by portal navigation text. Manually enter the correct procuring entity name.",
  AMBIGUOUS_DATE:        "Date format is ambiguous — day and month order cannot be determined. Use the date picker to set the confirmed date.",
  INVALID_FORMAT:        "Value does not pass format validation. Re-run AI Analyze or enter manually.",
  AMBIGUOUS_SOURCE_TEXT: "Extracted value is too short or structurally suspicious. Confirm via manual review.",
};

/**
 * Counts used for X-of-Y metric display.
 *
 *   total     — number of fields evaluated
 *   detected  — fields where ANY value exists (extracted or overridden)
 *   valid     — fields that pass field-specific format/content validation
 *   grounded  — valid fields with source evidence (page and/or quote)
 *   confirmed — fields manually confirmed by the user
 */
export type MetadataTruthCounts = {
  total: number;
  detected: number;
  valid: number;
  grounded: number;
  confirmed: number;
};

export type MetadataTruthFieldEntry = {
  status: MetadataFactStatus;
  value: string | null;
  isCritical: boolean;
  label: string;
  blockerReason?: string;
};

export type MetadataTruthSummary = {
  counts: MetadataTruthCounts;
  // Legacy ratio fields kept for backward compatibility with existing consumers
  extractionCoverage: number;
  readinessScore: number;
  groundingCoverage: number;
  confirmationCoverage: number;
  fields: Record<string, MetadataTruthFieldEntry>;
};

// Fields that may never be marked Not Applicable
const NEVER_NOT_APPLICABLE = new Set(["deadline"]);

// Fields classed as critical for generation/export blocking
const CRITICAL_FIELD_KEYS = new Set([
  "clientName", "title", "deadline", "submissionMethod", "reference",
]);

// All field keys in evaluation order
const ALL_FIELD_KEYS = [
  "clientName", "title", "reference", "deadline", "country",
  "submissionMethod", "submissionAddress", "submissionEmails",
  "currency", "clientContactName",
] as const;

type FieldKey = typeof ALL_FIELD_KEYS[number];

// ─── Internal helpers ──────────────────────────────────────────────────────

function resolveFieldStatus(
  key: FieldKey,
  rawValue: unknown,
  overrideFieldState: string | undefined,
  isContaminated: boolean,
): MetadataFactStatus {
  const val = typeof rawValue === "string" ? rawValue.trim() : null;
  const dateObj = rawValue instanceof Date ? rawValue : null;

  // Override states take priority over everything except contamination
  if (overrideFieldState === "NOT_APPLICABLE") {
    // Deadline cannot be N/A
    return NEVER_NOT_APPLICABLE.has(key) ? "INVALID" : "NOT_APPLICABLE";
  }
  if (overrideFieldState === "USER_CONFIRMED") return "MANUAL_CONFIRMED";
  if (overrideFieldState === "USER_EDITED") {
    // User-edited value still needs format validation
    if (!val) return "INVALID";
    if (key === "deadline" && isAmbiguousDateString(val)) return "AMBIGUOUS_DATE";
    return "MANUAL_OVERRIDE";
  }
  if (overrideFieldState === "IGNORED_WITH_REASON") return "NOT_FOUND_CONFIRMED";

  // Contamination only applies to clientName
  if (isContaminated && key === "clientName") return "PORTAL_CONTAMINATION";

  // Normalise the raw value to a string for validators
  const strVal = dateObj
    ? dateObj.toISOString()
    : val;

  if (!strVal) return "INVALID";

  // Generic field-label check — catches "Number", "Title", "Client Name" etc.
  if (isGenericFieldLabel(strVal)) return "GENERIC_FIELD_LABEL";

  // Placeholder check — catches TBD, N/A, "Bid-Team to confirm" etc.
  if (containsMetadataPlaceholder(strVal)) return "INTERNAL_PLACEHOLDER";

  // Field-specific format validation
  if (key === "deadline") {
    // Date objects from Prisma are always unambiguous
    if (dateObj) return "EXTRACTED_AND_GROUNDED";
    // String deadlines must be checked for ambiguity
    if (isAmbiguousDateString(strVal)) return "AMBIGUOUS_DATE";
    // Try to parse — if the result is a real date it's unambiguous
    const parsed = new Date(strVal);
    if (isNaN(parsed.getTime())) return "INVALID_FORMAT";
    return "EXTRACTED_AND_GROUNDED";
  }

  if (key === "reference") {
    if (!isValidReferenceNumber(strVal)) return "INVALID_FORMAT";
  }

  if (key === "clientName") {
    if (!isValidClientName(strVal)) return "AMBIGUOUS_SOURCE_TEXT";
  }

  // Length heuristic: very short values are suspicious for most fields
  if (strVal.length < 3) return "AMBIGUOUS_SOURCE_TEXT";

  // Without source evidence we can only say EXTRACTED_UNVERIFIED.
  // The caller upgrades this to EXTRACTED_AND_GROUNDED when evidence exists.
  return "EXTRACTED_UNVERIFIED";
}

/**
 * Returns true when the field's status counts as having a valid value —
 * i.e., passes format + content validation.
 */
function isValidStatus(status: MetadataFactStatus): boolean {
  return (
    status === "EXTRACTED_AND_GROUNDED" ||
    status === "EXTRACTED_UNVERIFIED" ||
    status === "MANUAL_OVERRIDE" ||
    status === "MANUAL_CONFIRMED" ||
    status === "NOT_FOUND_CONFIRMED" ||
    status === "NOT_APPLICABLE"
  );
}

/**
 * Returns true when the status indicates a value is present (extracted or overridden),
 * regardless of validity.
 */
function hasAnyValue(status: MetadataFactStatus): boolean {
  return status !== "INVALID" && status !== "INVALID_FORMAT";
}

/**
 * Returns true when the status represents a grounded field (has source evidence).
 * Only explicitly grounded statuses qualify — extracted-unverified does NOT.
 */
function isGroundedStatus(status: MetadataFactStatus): boolean {
  return status === "EXTRACTED_AND_GROUNDED";
}

/**
 * Returns true when the status represents a user-confirmed field.
 */
function isConfirmedStatus(status: MetadataFactStatus): boolean {
  return status === "MANUAL_CONFIRMED" || status === "NOT_FOUND_CONFIRMED";
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function resolveMetadataTruth(
  prisma: PrismaClient,
  tenderId: string,
  userId?: string,
): Promise<MetadataTruthSummary> {
  type Override = { field: string; fieldState: string; overrideValue: string | null };

  const tender = await prisma.tender.findFirst({
    where: { id: tenderId, ...(userId ? { userId } : {}) },
    select: {
      clientName: true,
      procuringEntityName: true,
      title: true,
      reference: true,
      deadline: true,
      currency: true,
      country: true,
      submissionMethod: true,
      submissionAddress: true,
      submissionEmails: true,
      clientContactName: true,
      metadataContaminated: true,
      metadataOverrides: {
        select: { field: true, fieldState: true, overrideValue: true },
      },
      requirements: { select: { sourcePageNumber: true, sourceTenderFileId: true } },
    },
  });

  if (!tender) throw new Error("Tender not found");

  const overrides: Override[] = tender.metadataOverrides;

  const metaReport = assessTenderMetadataCompleteness(
    {
      clientName: (tender.clientName || tender.procuringEntityName) ?? null,
      country: tender.country ?? null,
      clientContactName: tender.clientContactName ?? null,
      clientContactEmail: null,
      submissionAddress: tender.submissionAddress ?? null,
      submissionEmails: tender.submissionEmails ?? null,
      submissionMethod: tender.submissionMethod ?? null,
      deadline: tender.deadline ?? null,
      currency: tender.currency ?? null,
      hasSubmissionRules: Boolean(
        tender.submissionMethod || tender.submissionEmails || tender.submissionAddress,
      ),
      requirementCount: tender.requirements.length,
    },
    overrides,
  );

  const overrideByField = new Map(overrides.map((o) => [o.field, o]));

  const fields: MetadataTruthSummary["fields"] = {};
  let detected = 0;
  let valid = 0;
  let grounded = 0;
  let confirmed = 0;

  // Build a flat lookup of tender field values
  const tenderValues: Record<string, unknown> = {
    clientName: tender.clientName ?? tender.procuringEntityName ?? null,
    title: tender.title ?? null,
    reference: tender.reference ?? null,
    deadline: tender.deadline ?? null,
    country: tender.country ?? null,
    submissionMethod: tender.submissionMethod ?? null,
    submissionAddress: tender.submissionAddress ?? null,
    submissionEmails: tender.submissionEmails ?? null,
    currency: tender.currency ?? null,
    clientContactName: tender.clientContactName ?? null,
  };

  for (const key of ALL_FIELD_KEYS) {
    const rawValue = tenderValues[key];
    const override = overrideByField.get(key);
    const overrideFieldState = override?.fieldState;

    // When a USER_EDITED override exists, use the override value for validation
    const effectiveValue =
      overrideFieldState === "USER_EDITED" && override?.overrideValue
        ? override.overrideValue
        : rawValue;

    const status = resolveFieldStatus(
      key,
      effectiveValue,
      overrideFieldState,
      Boolean(tender.metadataContaminated),
    );

    if (hasAnyValue(status)) detected++;
    if (isValidStatus(status)) valid++;
    if (isGroundedStatus(status)) grounded++;
    if (isConfirmedStatus(status)) confirmed++;

    const label = FIELD_DISPLAY_LABELS[key] ?? key;
    const displayValue = (() => {
      if (override?.overrideValue) return override.overrideValue;
      if (rawValue instanceof Date) return rawValue.toISOString();
      return typeof rawValue === "string" ? rawValue : null;
    })();

    fields[key] = {
      status,
      value: displayValue,
      isCritical: CRITICAL_FIELD_KEYS.has(key),
      label,
      blockerReason: BLOCKER_REASONS[status],
    };
  }

  const total = ALL_FIELD_KEYS.length;
  const counts: MetadataTruthCounts = { total, detected, valid, grounded, confirmed };

  return {
    counts,
    // Legacy ratios (kept for backward-compat)
    extractionCoverage: detected / total,
    readinessScore: metaReport.overallRatio,
    groundingCoverage: grounded / Math.max(1, valid),
    confirmationCoverage: confirmed / total,
    fields,
  };
}
