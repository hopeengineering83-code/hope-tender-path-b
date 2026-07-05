import type { PrismaClient } from "@prisma/client";
import { assessTenderMetadataCompleteness, looksLikeMetadataPlaceholder } from "../tender-metadata-completeness";
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
import { isGroundedEvidence as isGroundedSourceEvidence, isGroundedEvidenceWithFileCheck, isGroundedEvidenceInActiveFiles, type GroundingActiveFile } from "../evidence-grounding";
// MetadataFactStatus is now the canonical shared type. Both this panel and the
// Client & Submission Details panel use CanonicalFieldStatus, which is re-exported
// here under the legacy name for backward compatibility. No per-panel status
// enum divergence is permitted.
import type { MetadataFactStatus } from "../canonical-field-state";
export type { MetadataFactStatus };

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
  INVALID:               "No value detected. Record a candidate value or resolve from a tender source.",
  GENERIC_FIELD_LABEL:   "Extracted value is a field heading, not real data. Re-run AI Analyze or enter a value.",
  INTERNAL_PLACEHOLDER:  "Value contains a placeholder (TBD / N/A / Bid-Team to confirm). Replace with the actual value.",
  PORTAL_CONTAMINATION:  "Client name is contaminated by portal navigation text. Manually enter the correct procuring entity name.",
  AMBIGUOUS_DATE:        "Date format is ambiguous — day and month order cannot be determined. Use the date picker to set the confirmed date.",
  INVALID_FORMAT:        "Value does not pass format validation. Re-run AI Analyze or enter a value.",
  MANUAL_OVERRIDE_CONFIRMATION_REQUIRED: "Candidate value entered. Critical fields remain blocked until linked to an active tender source.",
  MANUAL_CONFIRMED:      "Manually confirmed but not source-grounded. Link to an active tender source to unblock generation.",
  SOURCE_CONFLICT:       "Multiple contradictory source values detected. Resolve the conflict before generating.",
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

/** Per-field tender-source evidence (Policy point 1).
 *  fileId is optional because the contactDetailsSourceJson shape
 *  historically stored only { page, quote }. The repair-metadata route
 *  now persists fileId for the procurementReferenceNumber entry so
 *  reference evidence can be GROUNDED when activeTenderFileIds is
 *  enforced by the caller. */
type FieldEvidence = { page: number | null; quote: string | null; fileId: string | null };

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
  // NOT_STATED (canonical) = IGNORED_WITH_REASON override = audited field absence.
  if (overrideFieldState === "IGNORED_WITH_REASON") return "NOT_STATED";

  // Contamination only applies to clientName
  if (isContaminated && key === "clientName") return "PORTAL_CONTAMINATION";

  // Normalise the raw value to a string for validators
  const strVal = dateObj ? dateObj.toISOString() : val;

  if (!strVal) return "INVALID";

  // Generic field-label check — catches "Number", "Title", "Client Name" etc.
  if (isGenericFieldLabel(strVal)) return "GENERIC_FIELD_LABEL";

  // Placeholder check — catches TBD, N/A, "Bid-Team to confirm" etc. Consults
  // BOTH the validators' set and the export/completeness gate's broader set
  // (e.g. "not available", "to be provided") so the Metadata Truth panel never
  // disagrees with the Client & Submission panel or the export gate.
  if (containsMetadataPlaceholder(strVal) || looksLikeMetadataPlaceholder(strVal)) return "INTERNAL_PLACEHOLDER";

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
    // A short/ambiguous client name maps to EXTRACTED_UNVERIFIED (valid but not
    // fully trusted) — AMBIGUOUS_SOURCE_TEXT is removed from the shared vocab.
    if (!isValidClientName(strVal)) return "EXTRACTED_UNVERIFIED";
  }

  // Length heuristic: very short values are suspicious for most fields.
  // Map to EXTRACTED_UNVERIFIED (valid but review recommended) to stay within
  // the shared canonical vocabulary.
  if (strVal.length < 3) return "EXTRACTED_UNVERIFIED";

  // Clean, valid value but no evidence yet. The caller upgrades this to
  // EXTRACTED_AND_GROUNDED only when tender-source evidence exists.
  return "EXTRACTED_UNVERIFIED";
}

/**
 * Returns true when the field has a VALID, real value (Policy point 5:
 * audited-absence states do NOT count as valid). Manual overrides and
 * confirmations count; NOT_APPLICABLE / NOT_STATED do not.
 */
function isValidValueStatus(status: MetadataFactStatus): boolean {
  return (
    status === "EXTRACTED_AND_GROUNDED" ||
    status === "EXTRACTED_UNVERIFIED" ||
    status === "MANUAL_OVERRIDE" ||
    status === "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED" ||
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
    status !== "NOT_STATED"
  );
}

/** Returns true when the status represents a user-confirmed field. */
function isConfirmedStatus(status: MetadataFactStatus): boolean {
  return status === "MANUAL_CONFIRMED" || status === "NOT_STATED";
}

/**
 * Grounding (Policy point 1): a value may be GROUNDED only when it has a
 * page number, a direct supporting source quote, AND (when activeTenderFileIds
 * is provided) a fileId that points to an active TenderFile. Manual overrides
 * and confirmations are valid-but-ungrounded (Policy point 2) and never qualify.
 *
 * When activeTenderFileIds is omitted (legacy callers), the check falls back
 * to page+quote only — same as the Client & Submission panel resolver.
 */
function hasGroundingEvidence(
  ev: FieldEvidence | undefined,
  activeTenderFileIds?: Set<string>,
  activeFiles?: ReadonlyArray<GroundingActiveFile>,
): boolean {
  if (!ev) return false;
  // When ACTIVE file rows (with extracted text / totalPages) are available,
  // apply the STRONGEST shared check — quote containment + page bound — the
  // same evidence rules the BuildPlan validator and release gates enforce.
  if (activeFiles && activeFiles.length > 0) {
    return isGroundedEvidenceInActiveFiles(ev.page, ev.quote, ev.fileId, activeFiles);
  }
  if (activeTenderFileIds) {
    return isGroundedEvidenceWithFileCheck(ev.page, ev.quote, ev.fileId, activeTenderFileIds);
  }
  // Use the shared grounding predicate so the Metadata Truth panel and the
  // Client & Submission panel / gates apply IDENTICAL grounding (page > 0 AND a
  // non-trivial quote) and can never contradict each other.
  return isGroundedSourceEvidence(ev.page, ev.quote);
}

/** Safely parse a JSON object of per-field { page, quote, fileId? } evidence. */
function parseContactEvidence(json: string | null | undefined): Record<string, FieldEvidence> {
  if (!json || typeof json !== "string") return {};
  try {
    const parsed = JSON.parse(json) as Record<string, { page?: unknown; quote?: unknown; fileId?: unknown }>;
    const out: Record<string, FieldEvidence> = {};
    for (const [k, v] of Object.entries(parsed ?? {})) {
      if (v && typeof v === "object") {
        out[k] = {
          page: typeof v.page === "number" ? v.page : null,
          quote: typeof v.quote === "string" ? v.quote : null,
          fileId: typeof v.fileId === "string" && v.fileId.length > 0 ? v.fileId : null,
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
      clientNameSourceFileId: true,
      titleSourcePage: true,
      titleSourceQuote: true,
      titleSourceFileId: true,
      deadlineSourcePage: true,
      deadlineSourceQuote: true,
      deadlineSourceFileId: true,
      submissionMethodSourcePage: true,
      submissionMethodSourceQuote: true,
      submissionMethodSourceFileId: true,
      submissionAddressSourcePage: true,
      submissionAddressSourceQuote: true,
      submissionAddressSourceFileId: true,
      submissionEmailSourcePage: true,
      submissionEmailSourceQuote: true,
      submissionEmailSourceFileId: true,
      contactDetailsSourceJson: true,
      // extractedText + totalPages let the panel apply the FULL grounding
      // rule (quote containment + page bounds) — same as the gates.
      files: { where: { deletionStatus: "ACTIVE" }, select: { id: true, extractedText: true, totalPages: true } },
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

  // Per-field tender-source evidence map. Every critical field now has
  // dedicated source-evidence columns OR a contactDetailsSource entry — so
  // title, deadline, and reference can be GROUNDED in the Metadata Truth
  // panel when their evidence points to an active TenderFile.
  //
  // The fileId for clientName/title/deadline/submissionMethod/submissionAddress/
  // submissionEmails comes from their dedicated *SourceFileId columns. The
  // fileId for reference (and other contactDetailsSource entries) comes from
  // the JSON entry itself — written by the repair-metadata route.
  const refEvidence = contactEvidence["procurementReferenceNumber"];
  const evidenceByField: Partial<Record<FieldKey, FieldEvidence>> = {
    clientName: { page: tender.clientNameSourcePage ?? null, quote: tender.clientNameSourceQuote ?? null, fileId: tender.clientNameSourceFileId ?? null },
    title: { page: tender.titleSourcePage ?? null, quote: tender.titleSourceQuote ?? null, fileId: tender.titleSourceFileId ?? null },
    deadline: { page: tender.deadlineSourcePage ?? null, quote: tender.deadlineSourceQuote ?? null, fileId: tender.deadlineSourceFileId ?? null },
    reference: refEvidence
      ? { page: refEvidence.page, quote: refEvidence.quote, fileId: refEvidence.fileId }
      : undefined,
    submissionMethod: { page: tender.submissionMethodSourcePage ?? null, quote: tender.submissionMethodSourceQuote ?? null, fileId: tender.submissionMethodSourceFileId ?? null },
    submissionAddress: { page: tender.submissionAddressSourcePage ?? null, quote: tender.submissionAddressSourceQuote ?? null, fileId: tender.submissionAddressSourceFileId ?? null },
    submissionEmails: { page: tender.submissionEmailSourcePage ?? null, quote: tender.submissionEmailSourceQuote ?? contactEvidence.submissionEmails?.quote ?? null, fileId: tender.submissionEmailSourceFileId ?? null },
    clientContactName: contactEvidence.clientContactName
      ? { page: contactEvidence.clientContactName.page, quote: contactEvidence.clientContactName.quote, fileId: contactEvidence.clientContactName.fileId }
      : undefined,
  };

  // Active tender file IDs — when present, grounding requires fileId ∈ this set.
  const activeTenderFileIds = new Set((tender.files ?? []).map((f) => f.id));
  // Full active-file rows — enable quote-containment + page-bound grounding
  // (the same rules the BuildPlan validator and release gates apply).
  const activeFileRows: GroundingActiveFile[] = (tender.files ?? []).map((f) => ({
    id: f.id,
    extractedText: (f as any).extractedText ?? null,
    totalPages: (f as any).totalPages ?? null,
  }));

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
      status === "EXTRACTED_UNVERIFIED" && hasGroundingEvidence(evidenceByField[key], activeTenderFileIds, activeFileRows);
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
