import type { PrismaClient } from "@prisma/client";
import { assessTenderMetadataCompleteness } from "../tender-metadata-completeness";
import {
  containsMetadataPlaceholder,
  isValidClientName,
  isValidReferenceNumber,
  isGenericFieldLabel,
  isAmbiguousDateString,
} from "../metadata-validators";
import {
  ALWAYS_CRITICAL_FIELDS,
  NEVER_NOT_APPLICABLE,
  isCriticalField,
  fieldDisplayLabel,
} from "../tender-policy-registry";

export type MetadataFactStatus =
  | "EXTRACTED_AND_GROUNDED"   // Valid value + tender-source evidence (page + quote) present
  | "EXTRACTED_UNVERIFIED"     // Valid value present; no source evidence yet
  | "MANUAL_OVERRIDE"          // User entered a value (valid but ungrounded)
  | "MANUAL_CONFIRMED"         // User explicitly confirmed a value after review
  | "NOT_FOUND_CONFIRMED"      // User confirmed field is genuinely absent (audited absence)
  | "NOT_APPLICABLE"           // Field does not apply to this tender (audited absence)
  | "AMBIGUOUS_SOURCE_TEXT"    // Value exists but cannot be trusted (short, ambiguous, etc.)
  | "AMBIGUOUS_DATE"           // Date format is ambiguous — must be confirmed via date picker
  | "GENERIC_FIELD_LABEL"      // Extracted value is a field heading, not real data
  | "INTERNAL_PLACEHOLDER"     // Contains TBD / N/A / "Bid-Team to confirm" etc.
  | "PORTAL_CONTAMINATION"     // Client name is contaminated by portal/navigation text
  | "INVALID_FORMAT"           // Format validation failed (e.g., reference has no digit)
  | "INVALID";                 // Default / error state (no value, no override)

/**
 * User-facing display labels. Resolved through the canonical registry so the
 * truth panel never shows a raw DB column name and never disagrees with the
 * labels used by the other gates.
 */
export const FIELD_DISPLAY_LABELS: Record<string, string> = Object.fromEntries(
  ([
    "clientName", "title", "reference", "deadline", "country",
    "submissionMethod", "submissionAddress", "submissionEmails",
    "currency", "clientContactName",
  ] as const).map((k) => [k, fieldDisplayLabel(k)]),
);

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
 *   valid     — fields that pass field-specific format/content validation AND
 *               carry a real value (audited-absence states are excluded — see
 *               Manual Override & Evidence Policy point 5)
 *   grounded  — valid fields with tender-source evidence (page + quote)
 *   confirmed — fields manually confirmed by the user
 */
export type MetadataTruthCounts = {
  total: number;
  detected: number;
  valid: number;
  grounded: number;
  confirmed: number;
};

/**
 * Full manual-override audit record surfaced to the panels (Policy point 3).
 * A manual override may be valid but ungrounded — the UI must show who set it,
 * when, why, and what it replaced.
 */
export type OverrideAudit = {
  fieldState: string;
  actor: string | null;
  timestamp: string | null;
  reason: string | null;
  previousValue: string | null;
};

export type MetadataTruthFieldEntry = {
  status: MetadataFactStatus;
  value: string | null;
  isCritical: boolean;
  label: string;
  blockerReason?: string;
  /** True when the value carries tender-source evidence (page + quote). */
  grounded: boolean;
  /** Present only when a user override exists for this field. */
  override?: OverrideAudit;
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

// All field keys in evaluation order
const ALL_FIELD_KEYS = [
  "clientName", "title", "reference", "deadline", "country",
  "submissionMethod", "submissionAddress", "submissionEmails",
  "currency", "clientContactName",
] as const;

type FieldKey = typeof ALL_FIELD_KEYS[number];

/** Per-field tender-source evidence (Policy point 1). */
type FieldEvidence = { page: number | null; quote: string | null };

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * Decides a field's status from its value and override state. This is a PURE
 * value/format classifier — it never asserts EXTRACTED_AND_GROUNDED, because
 * grounding requires tender-source evidence the caller supplies separately.
 * A clean, valid, non-overridden value resolves to EXTRACTED_UNVERIFIED; the
 * caller upgrades it to EXTRACTED_AND_GROUNDED only when evidence is present.
 */
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
    // Critical / never-N/A fields (e.g. deadline) cannot be dismissed as N/A
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
  const strVal = dateObj ? dateObj.toISOString() : val;

  if (!strVal) return "INVALID";

  // Generic field-label check — catches "Number", "Title", "Client Name" etc.
  if (isGenericFieldLabel(strVal)) return "GENERIC_FIELD_LABEL";

  // Placeholder check — catches TBD, N/A, "Bid-Team to confirm" etc.
  if (containsMetadataPlaceholder(strVal)) return "INTERNAL_PLACEHOLDER";

  // Field-specific format validation
  if (key === "deadline") {
    if (dateObj) {
      // A real Date is unambiguous and well-formed, but it is still UNVERIFIED
      // until tender-source evidence is supplied by the caller.
      return "EXTRACTED_UNVERIFIED";
    }
    if (isAmbiguousDateString(strVal)) return "AMBIGUOUS_DATE";
    const parsed = new Date(strVal);
    if (isNaN(parsed.getTime())) return "INVALID_FORMAT";
    return "EXTRACTED_UNVERIFIED";
  }

  if (key === "reference") {
    if (!isValidReferenceNumber(strVal)) return "INVALID_FORMAT";
  }

  if (key === "clientName") {
    if (!isValidClientName(strVal)) return "AMBIGUOUS_SOURCE_TEXT";
  }

  // Length heuristic: very short values are suspicious for most fields
  if (strVal.length < 3) return "AMBIGUOUS_SOURCE_TEXT";

  // Clean, valid value but no evidence yet. The caller upgrades this to
  // EXTRACTED_AND_GROUNDED only when tender-source evidence exists.
  return "EXTRACTED_UNVERIFIED";
}

/**
 * Returns true when the field has a VALID, real value (Policy point 5:
 * audited-absence states do NOT count as valid). Manual overrides and
 * confirmations count; NOT_APPLICABLE / NOT_FOUND_CONFIRMED do not.
 */
function isValidValueStatus(status: MetadataFactStatus): boolean {
  return (
    status === "EXTRACTED_AND_GROUNDED" ||
    status === "EXTRACTED_UNVERIFIED" ||
    status === "MANUAL_OVERRIDE" ||
    status === "MANUAL_CONFIRMED"
  );
}

/**
 * Returns true when the status indicates a value is present (extracted or
 * overridden), regardless of validity. Absence states have no value.
 */
function hasAnyValue(status: MetadataFactStatus): boolean {
  return (
    status !== "INVALID" &&
    status !== "INVALID_FORMAT" &&
    status !== "NOT_APPLICABLE" &&
    status !== "NOT_FOUND_CONFIRMED"
  );
}

/** Returns true when the status represents a user-confirmed field. */
function isConfirmedStatus(status: MetadataFactStatus): boolean {
  return status === "MANUAL_CONFIRMED" || status === "NOT_FOUND_CONFIRMED";
}

/**
 * Grounding (Policy point 1): a value may be GROUNDED only when it has both a
 * page number AND a direct supporting source quote. Manual overrides and
 * confirmations are valid-but-ungrounded (Policy point 2) and never qualify.
 */
function hasGroundingEvidence(ev: FieldEvidence | undefined): boolean {
  if (!ev) return false;
  const hasPage = typeof ev.page === "number" && Number.isFinite(ev.page);
  const hasQuote = typeof ev.quote === "string" && ev.quote.trim().length > 0;
  return hasPage && hasQuote;
}

/** Safely parse a JSON object of per-field { page, quote } evidence. */
function parseContactEvidence(json: string | null | undefined): Record<string, FieldEvidence> {
  if (!json || typeof json !== "string") return {};
  try {
    const parsed = JSON.parse(json) as Record<string, { page?: unknown; quote?: unknown }>;
    const out: Record<string, FieldEvidence> = {};
    for (const [k, v] of Object.entries(parsed ?? {})) {
      if (v && typeof v === "object") {
        out[k] = {
          page: typeof v.page === "number" ? v.page : null,
          quote: typeof v.quote === "string" ? v.quote : null,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function resolveMetadataTruth(
  prisma: PrismaClient,
  tenderId: string,
  userId?: string,
): Promise<MetadataTruthSummary> {
  type Override = {
    field: string;
    fieldState: string;
    overrideValue: string | null;
    reason: string | null;
    previousValue: string | null;
    overriddenBy: string | null;
    createdAt: Date | null;
  };

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
      // Per-field source-evidence columns (Policy point 1)
      clientNameSourcePage: true,
      clientNameSourceQuote: true,
      submissionMethodSourcePage: true,
      submissionMethodSourceQuote: true,
      submissionAddressSourcePage: true,
      submissionAddressSourceQuote: true,
      submissionEmailSourcePage: true,
      contactDetailsSourceJson: true,
      metadataOverrides: {
        select: {
          field: true,
          fieldState: true,
          overrideValue: true,
          reason: true,
          previousValue: true,
          overriddenBy: true,
          createdAt: true,
        },
      },
      requirements: { select: { sourcePageNumber: true, sourceTenderFileId: true } },
    },
  });

  if (!tender) throw new Error("Tender not found");

  const overrides: Override[] = tender.metadataOverrides as Override[];

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
  const contactEvidence = parseContactEvidence(tender.contactDetailsSourceJson);

  // Per-field tender-source evidence map. Fields without a source column
  // (title, reference, deadline, country, currency) have NO evidence and can
  // therefore never be GROUNDED — only EXTRACTED_UNVERIFIED. This is the
  // honest Policy-point-1 behaviour: we do not claim grounding we cannot prove.
  const evidenceByField: Partial<Record<FieldKey, FieldEvidence>> = {
    clientName: { page: tender.clientNameSourcePage ?? null, quote: tender.clientNameSourceQuote ?? null },
    submissionMethod: { page: tender.submissionMethodSourcePage ?? null, quote: tender.submissionMethodSourceQuote ?? null },
    submissionAddress: { page: tender.submissionAddressSourcePage ?? null, quote: tender.submissionAddressSourceQuote ?? null },
    submissionEmails: { page: tender.submissionEmailSourcePage ?? null, quote: contactEvidence.submissionEmails?.quote ?? null },
    clientContactName: contactEvidence.clientContactName,
  };

  const policyCtx = { submissionMethod: tender.submissionMethod ?? null };

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

    let status = resolveFieldStatus(
      key,
      effectiveValue,
      overrideFieldState,
      Boolean(tender.metadataContaminated),
    );

    // Grounding upgrade (Policy points 1 & 2): only EXTRACTED_UNVERIFIED values
    // are eligible, and only when real tender-source evidence exists. Manual
    // overrides/confirmations are valid-but-ungrounded and never upgraded.
    const fieldIsGrounded =
      status === "EXTRACTED_UNVERIFIED" && hasGroundingEvidence(evidenceByField[key]);
    if (fieldIsGrounded) status = "EXTRACTED_AND_GROUNDED";

    if (hasAnyValue(status)) detected++;
    if (isValidValueStatus(status)) valid++;
    if (status === "EXTRACTED_AND_GROUNDED") grounded++;
    if (isConfirmedStatus(status)) confirmed++;

    const label = fieldDisplayLabel(key);
    const displayValue = (() => {
      if (override?.overrideValue) return override.overrideValue;
      if (rawValue instanceof Date) return rawValue.toISOString();
      return typeof rawValue === "string" ? rawValue : null;
    })();

    const overrideAudit: OverrideAudit | undefined = override
      ? {
          fieldState: override.fieldState,
          actor: override.overriddenBy ?? null,
          timestamp: override.createdAt ? new Date(override.createdAt).toISOString() : null,
          reason: override.reason ?? null,
          previousValue: override.previousValue ?? null,
        }
      : undefined;

    fields[key] = {
      status,
      value: displayValue,
      isCritical: isCriticalField(key, policyCtx) || ALWAYS_CRITICAL_FIELDS.has(key),
      label,
      blockerReason: BLOCKER_REASONS[status],
      grounded: status === "EXTRACTED_AND_GROUNDED",
      override: overrideAudit,
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
