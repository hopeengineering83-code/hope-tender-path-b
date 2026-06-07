// Metadata override engine.
//
// Allows users to mark tender metadata fields as:
//   - USER_CONFIRMED: the current value is correct (even if low-confidence)
//   - USER_EDITED: the user has manually provided a value
//   - NOT_APPLICABLE: the field does not apply to this tender
//   - IGNORED_WITH_REASON: the field is absent and the user acknowledges it
//
// These overrides are stored in TenderMetadataOverride and consumed by:
//   - assessTenderMetadataCompleteness() (generation gate)
//   - generate route (pass overrides to completeness check)
//   - MetadataCompletionPanel (UI)

export type MetadataFieldState =
  | "AI_EXTRACTED"
  | "USER_CONFIRMED"
  | "USER_EDITED"
  | "MISSING"
  | "NOT_APPLICABLE"
  | "IGNORED_WITH_REASON";

export type MetadataOverride = {
  id: string;
  tenderId: string;
  field: string;
  fieldState: MetadataFieldState;
  overrideValue: string | null;
  reason: string | null;
  previousValue: string | null;
  overriddenBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export const VALID_FIELD_STATES: readonly MetadataFieldState[] = [
  "AI_EXTRACTED",
  "USER_CONFIRMED",
  "USER_EDITED",
  "MISSING",
  "NOT_APPLICABLE",
  "IGNORED_WITH_REASON",
];

// Fields where NOT_APPLICABLE is allowed without hard-blocking.
export const OPTIONAL_METADATA_FIELDS = new Set([
  "clientContactName",
  "clientContactEmail",
  "clientContactPhone",
  "reference",
  "country",
  "clientCity",
  "clientWebsite",
  "submissionEmailSubject",
  "preBidChannel",
  "clientRepresentative",
  "pageLimit",
  "bidBond",
  "siteVisit",
  "proposalValidity",
  "preBidMeetingDate",
  "preBidMeetingLocation",
  "numberOfCopiesRequired",
  "budget",
  "currency",
]);

// submissionEmails is optional if submissionMethod is not EMAIL
// submissionAddress is optional if submissionMethod is PORTAL or EMAIL
export const CONDITIONALLY_OPTIONAL_FIELDS = new Set([
  "submissionEmails",
  "submissionAddress",
]);

export const CRITICAL_METADATA_FIELDS = new Set([
  "clientName",
  "title",
  "submissionMethod",
  "submissionEndpoint",
  "deadline",
  "requiredDocuments",
  "evaluationCriteria",
]);

// Known metadata field names accepted by the override endpoint.
export const KNOWN_METADATA_FIELDS = new Set([
  ...CRITICAL_METADATA_FIELDS,
  ...OPTIONAL_METADATA_FIELDS,
  ...CONDITIONALLY_OPTIONAL_FIELDS,
]);

/**
 * Given a set of overrides, return a Set of field names that are "resolved"
 * (NOT_APPLICABLE, USER_CONFIRMED, or USER_EDITED).
 * These should not block generation.
 */
export function resolvedOverrideFields(
  overrides: Array<{ field: string; fieldState: string }>,
): Set<string> {
  const resolved = new Set<string>();
  for (const o of overrides) {
    if (
      ["NOT_APPLICABLE", "USER_CONFIRMED", "USER_EDITED", "IGNORED_WITH_REASON"].includes(
        o.fieldState,
      )
    ) {
      resolved.add(o.field);
    }
  }
  return resolved;
}

/**
 * For a given field and override, return whether the field blocks generation.
 * NOT_APPLICABLE on optional fields = no block.
 * NOT_APPLICABLE on critical fields = warning but not hard block (user confirmed intentional).
 * IGNORED_WITH_REASON = warning only.
 * USER_CONFIRMED / USER_EDITED = not blocking (treat as valid).
 */
export function isFieldBlockingWithOverride(
  field: string,
  currentlyBlocking: boolean,
  override: { fieldState: string } | undefined,
): boolean {
  if (!currentlyBlocking) return false;
  if (!override) return true;
  const state = override.fieldState;
  if (state === "USER_CONFIRMED" || state === "USER_EDITED") return false;
  if (state === "NOT_APPLICABLE") return false; // user explicitly marked NA
  if (state === "IGNORED_WITH_REASON") return false; // user acknowledged and chose to proceed
  return true;
}
