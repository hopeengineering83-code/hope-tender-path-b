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
import { isGroundedEvidence as isGroundedSourceEvidence, isGroundedEvidenceWithFileCheck } from "../evidence-grounding";
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
  NOT_FOUND_CONFIRMED:   "Manually confirmed but has no active tender-source evidence. Link to an active tender source to unblock generation.",
  SOURCE_CONFLICT:       "Multiple contradictory source values detected. Resolve the conflict before generating.",
};

/**
 * Metadata fields visible in the dashboard's Metadata Truth panel.
 */
const ALL_FIELD_KEYS = [
  "clientName", "title", "reference", "deadline", "country",
  "submissionMethod", "submissionAddress", "submissionEmails",
  "currency", "clientContactName",
] as const;

export type FieldKey = (typeof ALL_FIELD_KEYS)[number];

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
 * when, and why.
 */
export type OverrideAudit = {
  fieldState: string;
  actor: string | null;
  timestamp: string | null;
  reason: string | null;
  previousValue: string | null;
};

export type MetadataFact = {
  status: MetadataFactStatus;
  value: string | null;
  isCritical: boolean;
  label: string;
  blockerReason?: string;
  grounded: boolean;
  override?: OverrideAudit;
};

export type MetadataTruthSummary = {
  counts: MetadataTruthCounts;
  extractionCoverage: number; // Ratio of detected fields
  readinessScore: number;     // Aggregate completeness (0.0 to 1.0)
  groundingCoverage: number;  // Ratio of valid fields that are grounded
  confirmationCoverage: number; // Ratio of confirmed fields
  fields: Record<string, MetadataFact>;
};

type FieldEvidence = { page: number | null; quote: string | null; fileId: string | null };

// ─── Resolver logic ────────────────────────────────────────────────────────────

function hasAnyValue(status: MetadataFactStatus): boolean {
  return status !== "INVALID";
}

function isValidValueStatus(status: MetadataFactStatus): boolean {
  return (
    status === "EXTRACTED_AND_GROUNDED" ||
    status === "EXTRACTED_UNVERIFIED" ||
    status === "MANUAL_OVERRIDE" ||
    status === "MANUAL_CONFIRMED" ||
    status === "NOT_FOUND_CONFIRMED"
  );
}

function isConfirmedStatus(status: MetadataFactStatus): boolean {
  return status === "MANUAL_CONFIRMED" || status === "NOT_FOUND_CONFIRMED";
}

function hasGroundingEvidence(ev: FieldEvidence | undefined, activeTenderFileIds: Set<string>): boolean {
  if (!ev) return false;
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
    const parsed = JSON.parse(json) as Record<string, any>;
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
      files: { where: { deletionStatus: "ACTIVE" }, select: { id: true } },
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

  // Per-field tender-source evidence map.
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
    submissionEmails: { page: tender.submissionEmailSourcePage ?? null, quote: tender.submissionEmailSourceQuote ?? (contactEvidence.submissionEmails?.quote ?? null), fileId: tender.submissionEmailSourceFileId ?? null },
    clientContactName: contactEvidence.clientContactName
      ? { page: contactEvidence.clientContactName.page, quote: contactEvidence.clientContactName.quote, fileId: contactEvidence.clientContactName.fileId }
      : undefined,
  };

  const activeTenderFileIds = new Set((tender.files ?? []).map((f) => f.id));

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

    // Grounding upgrade
    const evidence = evidenceByField[key];
    const isGroundedSource = hasGroundingEvidence(evidence, activeTenderFileIds);

    if (status === "EXTRACTED_UNVERIFIED" && isGroundedSource) {
      status = "EXTRACTED_AND_GROUNDED";
    } else if (overrideFieldState === "USER_CONFIRMED") {
      // Align with canonical-field-state.ts: USER_CONFIRMED without source is NOT_FOUND_CONFIRMED
      status = isGroundedSource ? "MANUAL_CONFIRMED" : "NOT_FOUND_CONFIRMED";
    }

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
    extractionCoverage: detected / total,
    readinessScore: metaReport.overallRatio,
    groundingCoverage: grounded / Math.max(1, valid),
    confirmationCoverage: confirmed / total,
    fields,
  };
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * Decides a field's status from its value and override state. This is a PURE
 * value/format classifier — it never asserts EXTRACTED_AND_GROUNDED, because
 * grounding requires tender-source evidence the caller supplies separately.
 */
function resolveFieldStatus(
  key: FieldKey,
  rawValue: unknown,
  overrideFieldState: string | undefined,
  isContaminated: boolean,
): MetadataFactStatus {
  const val = typeof rawValue === "string" ? rawValue.trim() : null;
  const dateObj = rawValue instanceof Date ? rawValue : null;

  if (overrideFieldState === "NOT_APPLICABLE") {
    if (NEVER_NOT_APPLICABLE.has(key)) return "INVALID";
    return "NOT_APPLICABLE";
  }

  if (overrideFieldState === "USER_EDITED") {
    if (!val) return "INVALID";
    if (key === "deadline" && isAmbiguousDateString(val)) return "AMBIGUOUS_DATE";
    return "MANUAL_OVERRIDE";
  }

  if (overrideFieldState === "IGNORED_WITH_REASON") return "NOT_STATED";

  if (isContaminated && key === "clientName") return "PORTAL_CONTAMINATION";

  const strVal = dateObj ? dateObj.toISOString() : val;
  if (!strVal) return "INVALID";

  if (isGenericFieldLabel(strVal)) return "GENERIC_FIELD_LABEL";
  if (containsMetadataPlaceholder(strVal) || looksLikeMetadataPlaceholder(strVal)) return "INTERNAL_PLACEHOLDER";
  if (key === "clientName" && !isValidClientName(strVal)) return "INVALID_FORMAT";
  if (key === "reference" && !isValidReferenceNumber(strVal)) return "INVALID_FORMAT";
  if (key === "deadline" && isAmbiguousDateString(strVal)) return "AMBIGUOUS_DATE";

  return "EXTRACTED_UNVERIFIED";
}
