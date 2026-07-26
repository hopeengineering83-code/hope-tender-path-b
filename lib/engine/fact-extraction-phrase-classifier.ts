/**
 * Tender Fact Extraction Phrase Classifier
 *
 * Classifies extracted tender-fact values that are NOT actual values but
 * indicate one of:
 *
 *   - NOT_STATED — the source explicitly says the value is not provided /
 *     not mentioned / not applicable / TBD / to be confirmed / if required.
 *   - CONDITIONAL — the source states the value conditionally or as
 *     not-yet-scheduled ("by arrangement", "to be confirmed", "if required").
 *   - CANDIDATE — the value looks like a real candidate but needs review
 *     (e.g. unusual format, partial match).
 *   - REJECTED — the value is a label/heading/footer, not a fact.
 *   - VALUE — the value is a genuine extracted fact.
 *
 * Critical rules:
 *   - Do NOT infer absence until complete source coverage is confirmed.
 *   - "Not provided" / "not mentioned" / "not applicable" → NOT_STATED.
 *   - "TBD" / "to be confirmed" / "by arrangement" / "if required" → CONDITIONAL.
 *   - "Type", "Number", "Reference", "Not provided" as a tender ID → REJECTED.
 *   - Optional facts (bid bond, pre-bid meeting, page limit, contact phone,
 *     proposal validity) must NOT block drafting when genuinely not stated.
 *   - Critical conditional submission facts may block final export but must
 *     NOT block extraction, analysis, or internal drafting.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type FactExtractionClassification =
  | "VALUE"
  | "NOT_STATED"
  | "CONDITIONAL"
  | "CANDIDATE"
  | "REJECTED";

export type FactExtractionResult = {
  classification: FactExtractionClassification;
  /** The cleaned value (stripped of labels/footers). Null if REJECTED. */
  cleanedValue: string | null;
  /** The reason for the classification. */
  reason: string;
  /** Whether this fact blocks drafting (always false except for requiredDocuments). */
  blocksDrafting: boolean;
  /** Whether this fact blocks final export. */
  blocksFinalExport: boolean;
};

// ─── Phrase sets ────────────────────────────────────────────────────────────

/**
 * Phrases that mean "the source explicitly says this is not stated."
 * These are NOT values — they are explicit absence confirmations.
 *
 * "Not provided", "not mentioned", "not applicable" → NOT_STATED.
 */
const NOT_STATED_PHRASES = new Set([
  "not provided",
  "not mentioned",
  "not applicable",
  "not stated",
  "not specified",
  "not set",
  "not available",
  "not determined",
  "not defined",
  "not indicated",
  "not included",
  "not relevant",
  "none",
  "n/a",
  "na",
  "nil",
]);

/**
 * Phrases that mean "the source states this conditionally or as
 * not-yet-scheduled." These are NOT firm values — they indicate a
 * conditional or future-determined fact.
 *
 * "TBD", "to be confirmed", "by arrangement", "if required" → CONDITIONAL.
 */
const CONDITIONAL_PHRASES = new Set([
  "tbd",
  "tba",
  "tbc",
  "to be confirmed",
  "to be determined",
  "to be advised",
  "to be announced",
  "to be decided",
  "to be specified",
  "by arrangement",
  "as required",
  "if required",
  "if applicable",
  "as needed",
  "upon request",
  "pending",
  "awaiting confirmation",
  "awaiting",
  "subject to confirmation",
  "subject to approval",
  "tentative",
  "provisional",
  "to be agreed",
]);

/**
 * Labels and headings that should NEVER be extracted as tender IDs.
 * These are field labels, not values.
 */
const LABEL_PATTERNS = [
  /^type\s*:/i,
  /^number\s*:/i,
  /^reference\s*:/i,
  /^reference\s+number\s*:/i,
  /^tender\s+reference\s*:/i,
  /^client\s+name\s*:/i,
  /^deadline\s*:/i,
  /^submission\s+method\s*:/i,
  /^submission\s+deadline\s*:/i,
  /^email\s*:/i,
  /^subject\s*:/i,
  /^address\s*:/i,
];

/**
 * Values that are always REJECTED — they are too short, or are known
 * non-values (null, undefined, etc.).
 */
const REJECTED_VALUES = new Set([
  "null",
  "undefined",
  "unknown",
  "refer",
  "see above",
  "see below",
  "see attached",
  "see annex",
  "see appendix",
  "see document",
  "see tender",
]);

// ─── Optional vs critical fields ────────────────────────────────────────────

/**
 * Optional operational fields. These must NOT block drafting when genuinely
 * not stated. They may show a warning but never block extraction, analysis,
 * or internal drafting.
 *
 * Critical conditional submission facts may block final export but must NOT
 * block extraction, analysis, or internal drafting.
 */
export const OPTIONAL_FACT_FIELDS = new Set([
  "bidBond",
  "preBidMeeting",
  "pageLimit",
  "contactPhone",
  "proposalValidity",
  "evaluationWeights",
]);

/**
 * Submission-critical fields. These can block final export (but never
 * drafting) when their value is UNKNOWN or CONDITIONAL.
 */
export const SUBMISSION_CRITICAL_FACT_FIELDS = new Set([
  "clientName",
  "title",
  "deadline",
  "submissionMethod",
  "submissionEmails",
  "submissionAddress",
  "emailSubject",
]);

// ─── Classifier ─────────────────────────────────────────────────────────────

/**
 * Classify an extracted tender-fact value.
 *
 * @param value - The raw extracted value.
 * @param field - The field name (e.g. "deadline", "bidBond", "reference").
 * @returns The classification result.
 */
export function classifyExtractedFact(
  value: string | null | undefined,
  field: string,
): FactExtractionResult {
  // Empty/null → not a value, but not explicitly NOT_STATED either.
  // This is UNKNOWN — do NOT infer absence until complete source coverage
  // is confirmed.
  if (!value || !value.trim()) {
    return {
      classification: "VALUE",
      cleanedValue: null,
      reason: "Empty value — no extraction performed. Do not infer absence until complete source coverage is confirmed.",
      blocksDrafting: false,
      blocksFinalExport: SUBMISSION_CRITICAL_FACT_FIELDS.has(field),
    };
  }

  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  // Check for label patterns: "Type:", "Reference:", "Not provided:" etc.
  // These are labels, not values → REJECTED.
  for (const pattern of LABEL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        classification: "REJECTED",
        cleanedValue: null,
        reason: `Value "${trimmed.slice(0, 60)}" is a field label, not a fact.`,
        blocksDrafting: false,
        blocksFinalExport: false,
      };
    }
  }

  // Check for rejected values
  if (REJECTED_VALUES.has(lower)) {
    return {
      classification: "REJECTED",
      cleanedValue: null,
      reason: `Value "${trimmed}" is a non-value reference ("see above", "null", etc.).`,
      blocksDrafting: false,
      blocksFinalExport: false,
    };
  }

  // Check for NOT_STATED phrases — explicit absence confirmation
  if (NOT_STATED_PHRASES.has(lower)) {
    const isOptional = OPTIONAL_FACT_FIELDS.has(field);
    const isCritical = SUBMISSION_CRITICAL_FACT_FIELDS.has(field);
    return {
      classification: "NOT_STATED",
      cleanedValue: null,
      reason: `Source explicitly states "${trimmed}" for field "${field}". This is an explicit absence confirmation, not an extracted value.`,
      blocksDrafting: false, // Never blocks drafting
      blocksFinalExport: isCritical && !isOptional, // Blocks final only for critical, non-optional fields
    };
  }

  // Check for CONDITIONAL phrases — conditional or not-yet-scheduled
  if (CONDITIONAL_PHRASES.has(lower)) {
    const isOptional = OPTIONAL_FACT_FIELDS.has(field);
    const isCritical = SUBMISSION_CRITICAL_FACT_FIELDS.has(field);
    return {
      classification: "CONDITIONAL",
      cleanedValue: trimmed, // Keep the conditional phrase — the UI shows it
      reason: `Source states "${trimmed}" for field "${field}" — this is conditional or not-yet-scheduled, not a firm value.`,
      blocksDrafting: false, // Never blocks drafting
      blocksFinalExport: isCritical && !isOptional, // Blocks final only for critical, non-optional fields
    };
  }

  // Check for "Not provided" / "Not mentioned" / "Not applicable" embedded
  // in a longer string (e.g. "Reference: Not provided")
  if (/not\s+provided|not\s+mentioned|not\s+applicable|not\s+stated|not\s+specified/i.test(lower)) {
    // If the ENTIRE value is one of these phrases, it's NOT_STATED (already
    // caught above). If it's embedded in a longer string, it might be a
    // label + "not provided" — treat as NOT_STATED.
    const isOptional = OPTIONAL_FACT_FIELDS.has(field);
    const isCritical = SUBMISSION_CRITICAL_FACT_FIELDS.has(field);
    return {
      classification: "NOT_STATED",
      cleanedValue: null,
      reason: `Value contains explicit absence phrase ("not provided/mentioned/applicable/stated/specif‌ied") for field "${field}".`,
      blocksDrafting: false,
      blocksFinalExport: isCritical && !isOptional,
    };
  }

  // Check for partial email (has @ but no valid structure) → CANDIDATE
  if (lower.includes("@") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return {
      classification: "CANDIDATE",
      cleanedValue: trimmed,
      reason: `Value "${trimmed}" looks like a partial email — needs review.`,
      blocksDrafting: false,
      blocksFinalExport: false,
    };
  }

  // Check for footer fragments (page numbers, etc.)
  if (/^page\s+\d+\s+of\s+\d+$/i.test(trimmed)) {
    return {
      classification: "REJECTED",
      cleanedValue: null,
      reason: `Value "${trimmed}" is a footer page-number fragment.`,
      blocksDrafting: false,
      blocksFinalExport: false,
    };
  }

  // Check for very short values (likely noise)
  if (trimmed.length < 2) {
    return {
      classification: "REJECTED",
      cleanedValue: null,
      reason: `Value "${trimmed}" is too short (< 2 chars) — likely noise.`,
      blocksDrafting: false,
      blocksFinalExport: false,
    };
  }

  // The value is a genuine extracted fact
  return {
    classification: "VALUE",
    cleanedValue: trimmed,
    reason: `Value "${trimmed.slice(0, 80)}" extracted as a genuine fact for field "${field}".`,
    blocksDrafting: false,
    blocksFinalExport: false,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Check if a field is optional (must not block drafting when not stated).
 */
export function isOptionalFactField(field: string): boolean {
  return OPTIONAL_FACT_FIELDS.has(field);
}

/**
 * Check if a field is submission-critical (can block final export).
 */
export function isSubmissionCriticalFactField(field: string): boolean {
  return SUBMISSION_CRITICAL_FACT_FIELDS.has(field);
}

/**
 * Check if a value is an explicit NOT_STATED phrase.
 */
export function isNotStatedPhrase(value: string | null | undefined): boolean {
  if (!value) return false;
  return NOT_STATED_PHRASES.has(value.trim().toLowerCase());
}

/**
 * Check if a value is a CONDITIONAL phrase.
 */
export function isConditionalPhrase(value: string | null | undefined): boolean {
  if (!value) return false;
  return CONDITIONAL_PHRASES.has(value.trim().toLowerCase());
}

/**
 * Check if a value is a label/heading (not a fact).
 */
export function isLabelValue(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return LABEL_PATTERNS.some((p) => p.test(trimmed));
}
