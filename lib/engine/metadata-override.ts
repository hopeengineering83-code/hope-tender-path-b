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
  "procuringEntityName",
  "legalClientName",
  "donorAgency",
  "implementingAgency",
  "clientAddress",
  "clientContactTitle",
]);

export const CONDITIONALLY_OPTIONAL_FIELDS = new Set([
  "submissionEmails",
  "submissionAddress",
]);

// Canonical critical-field set comes from the single tender-policy registry so
// this module can never drift from the generation/export gates (Manual Override
// & Evidence Policy point 7 — no conflicting hard-coded critical-field lists).
export { ALWAYS_CRITICAL_FIELDS as CRITICAL_METADATA_FIELDS } from "./tender-policy-registry";

// Fields that are known/override-able but classified non-critical by the
// registry (evaluationCriteria) or are workflow-derived (requiredDocuments).
// Kept here only so KNOWN_METADATA_FIELDS stays complete for input validation.
const ADDITIONAL_KNOWN_FIELDS = new Set([
  "submissionEndpoint",
  "requiredDocuments",
  "evaluationCriteria",
]);

export const KNOWN_METADATA_FIELDS = new Set([
  "clientName",
  "title",
  "submissionMethod",
  "deadline",
  ...ADDITIONAL_KNOWN_FIELDS,
  ...OPTIONAL_METADATA_FIELDS,
  ...CONDITIONALLY_OPTIONAL_FIELDS,
]);

export function resolvedOverrideFields(
  overrides: Array<{ field: string; fieldState: string }>,
): Set<string> {
  const resolved = new Set<string>();
  for (const o of overrides) {
    if (["NOT_APPLICABLE", "USER_CONFIRMED", "USER_EDITED", "IGNORED_WITH_REASON"].includes(o.fieldState)) {
      resolved.add(o.field);
    }
  }
  return resolved;
}

export function isFieldBlockingWithOverride(
  field: string,
  currentlyBlocking: boolean,
  override: { fieldState: string } | undefined,
): boolean {
  if (!currentlyBlocking) return false;
  if (!override) return true;
  const state = override.fieldState;
  if (state === "USER_CONFIRMED" || state === "USER_EDITED") return false;
  if (state === "NOT_APPLICABLE") return false;
  if (state === "IGNORED_WITH_REASON") return false;
  return true;
}
