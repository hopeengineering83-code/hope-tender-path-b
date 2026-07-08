// Shared metadata display sanitizer.
//
// Determines whether a stored tender metadata value is display-valid —
// i.e., a clean, source-grounded, semantically valid tender fact that
// should be shown to users as extracted metadata and counted toward
// auto-fill coverage.
//
// Invalid values (placeholders, negative statements, explanatory notes,
// contaminated text, generic labels) are treated as missing:
//   • not displayed as valid extracted metadata
//   • not counted in auto-fill coverage
//   • omitted from generated draft output
//   • shown as "Not extracted" or hidden
//
// This does NOT block draft generation — metadata is optional for draft
// work. Strict validation belongs to Final Submission Check only.

import { containsMetadataPlaceholder } from "./metadata-validators";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MetadataFieldKey =
  | "reference" | "clientName" | "deadline" | "submissionMethod"
  | "submissionEmails" | "submissionAddress" | "country" | "budget"
  | "bidBondAmount" | "pageLimit" | "validityDays" | "numberOfCopiesRequired"
  | "mandatorySiteVisit" | "technicalWeight" | "financialWeight"
  | "preBidMeetingDate" | "preBidMeetingLocation" | "clientContactName"
  | "clientContactEmail" | "clientContactPhone" | "clientAddress"
  | "evaluationMethodology" | "category" | "description";

export type SanitizeOptions = {
  /** When true, manual/confirmed values count toward coverage (final-check context). */
  countManual?: boolean;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const NOT_EXTRACTED = "Not extracted";

// Generic words that are never valid metadata values
const GENERIC_WORDS = new Set([
  "not", "no", "na", "n/a", "tbd", "tbc", "tba", "unknown", "none", "null",
  "not extracted", "not mentioned", "not applicable", "not stated",
  "not provided", "not specified", "pending", "placeholder", "nil", "blank",
  "email", "portal", "address", "client", "submit", "reference", "number",
  "deadline", "date", "title", "method", "currency", "website", "location",
  "city", "country", "type", "status", "value", "amount", "budget",
]);

// Negative/explanatory patterns — these are notes, not metadata values
const NEGATIVE_PATTERNS = [
  /^no\s+(physical\s+)?address/i,
  /^no\s+portal/i,
  /^no\s+email/i,
  /^use\s+email\s+submission/i,
  /^mark\s+as\s+not\s+applicable/i,
  /^not\s+mentioned/i,
  /^not\s+applicable/i,
  /^\/\s*portal:/i,
  /^portal:\s*no/i,
  /^not\s+stated/i,
  /^not\s+provided/i,
  /^not\s+specified/i,
];

// Valid submission method labels
const VALID_SUBMISSION_METHODS = new Set([
  "email", "portal", "physical", "physical delivery", "courier",
  "online submission", "sealed envelope", "hybrid", "hand delivery",
  "e-procurement", "upload through e-procurement portal",
]);

// ─── Core helpers ─────────────────────────────────────────────────────────────

function isBlank(value: unknown): value is null | undefined {
  if (value === null || value === undefined) return true;
  if (typeof value === "string" && value.trim().length === 0) return true;
  if (typeof value === "number" && (isNaN(value) || value === 0)) return true;
  if (typeof value === "boolean") return false; // booleans are never blank
  return false;
}

function isNegativeOrPlaceholder(value: string): boolean {
  const trimmed = value.trim().toLowerCase();

  // Check generic words
  if (GENERIC_WORDS.has(trimmed)) return true;

  // Check placeholder patterns
  if (containsMetadataPlaceholder(value)) return true;

  // Check negative/explanatory patterns
  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(value)) return true;
  }

  // Check if it starts with a negative prefix
  if (/^(not\s|no\s|n\/a\s|n\/a$)/i.test(trimmed)) return true;

  return false;
}

// ─── Field-specific validators ────────────────────────────────────────────────

function isValidReference(value: string): boolean {
  if (isNegativeOrPlaceholder(value)) return false;
  // Reference must have at least one alphanumeric character and be >= 3 chars
  if (value.trim().length < 3) return false;
  // Must not be just a generic label
  if (GENERIC_WORDS.has(value.trim().toLowerCase())) return false;
  return true;
}

function isValidClientName(value: string): boolean {
  if (isNegativeOrPlaceholder(value)) return false;
  if (value.trim().length < 3) return false;
  // Must look like an organization name (contains letters, not just labels)
  if (GENERIC_WORDS.has(value.trim().toLowerCase())) return false;
  return true;
}

function isValidSubmissionMethod(value: string): boolean {
  if (isNegativeOrPlaceholder(value)) return false;
  const lower = value.trim().toLowerCase();
  // Accept known method labels
  for (const method of VALID_SUBMISSION_METHODS) {
    if (lower.includes(method)) return true;
  }
  // Reject long explanatory text (> 80 chars = likely a sentence, not a method label)
  if (value.trim().length > 80) return false;
  return true;
}

function isValidEmailList(value: string): boolean {
  if (isNegativeOrPlaceholder(value)) return false;
  // Split on pipe, comma, semicolon, whitespace
  const emails = value.split(/[\|,;\s]+/).filter(Boolean);
  if (emails.length === 0) return false;
  // At least one must be a valid email
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emails.some((e) => emailRegex.test(e));
}

function isValidAddress(value: string): boolean {
  if (isNegativeOrPlaceholder(value)) return false;
  // Must not start with "/" or "Portal:" (explanatory portal text)
  if (/^\/|^\s*portal:/i.test(value)) return false;
  if (value.trim().length < 5) return false;
  return true;
}

function isValidDate(value: string): boolean {
  if (isNegativeOrPlaceholder(value)) return false;
  const date = new Date(value);
  return !isNaN(date.getTime());
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function isNegativeOrPlaceholderMetadata(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return isNegativeOrPlaceholder(value);
}

export function isDisplayValidMetadataValue(
  fieldKey: MetadataFieldKey | string,
  value: unknown,
  _options?: SanitizeOptions,
): boolean {
  if (isBlank(value)) return false;
  if (typeof value === "boolean") return true; // booleans are always valid
  if (typeof value === "number") return value > 0; // numbers must be positive

  const strValue = String(value);
  if (strValue.trim().length === 0) return false;

  // Field-specific validation
  switch (fieldKey) {
    case "reference":
      return isValidReference(strValue);
    case "clientName":
    case "clientContactName":
      return isValidClientName(strValue);
    case "submissionMethod":
      return isValidSubmissionMethod(strValue);
    case "submissionEmails":
      return isValidEmailList(strValue);
    case "submissionAddress":
    case "clientAddress":
    case "preBidMeetingLocation":
      return isValidAddress(strValue);
    case "deadline":
    case "preBidMeetingDate":
      return isValidDate(strValue);
    case "country":
      if (isNegativeOrPlaceholder(strValue)) return false;
      return strValue.trim().length >= 2;
    case "evaluationMethodology":
    case "description":
    case "category":
    case "intakeSummary":
    case "analysisSummary":
      // Long text fields — just check for negative/placeholder
      return !isNegativeOrPlaceholder(strValue);
    default:
      // For numeric fields that arrive as strings, check for negative/placeholder
      return !isNegativeOrPlaceholder(strValue);
  }
}

export function sanitizeMetadataDisplayValue(
  fieldKey: MetadataFieldKey | string,
  value: unknown,
  _options?: SanitizeOptions,
): string {
  if (!isDisplayValidMetadataValue(fieldKey, value, _options)) {
    return NOT_EXTRACTED;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).trim();
}

export function normalizeMetadataDisplayValue(
  fieldKey: MetadataFieldKey | string,
  value: unknown,
  options?: SanitizeOptions,
): string | null {
  if (!isDisplayValidMetadataValue(fieldKey, value, options)) {
    return null;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).trim();
}

export { NOT_EXTRACTED };
