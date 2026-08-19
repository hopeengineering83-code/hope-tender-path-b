// Canonical metadata validators.
//
// One source of truth for "is this a real client name / reference number /
// country / contact?" — used by extraction (post-filter), readiness gates,
// UI displays, and tests. Before this module existed, each consumer had
// its own ad-hoc check (or none at all) and corrupted OCR/TOC fragments
// were leaking into the Tender table:
//   - clientName  = "references (where available) Photos or drawings ..."
//   - referenceNumber = "only"
//   - country = "A ddis Ababa"
//   - clientContactName = "s Contact Person"
//
// These validators reject those fragments at every layer.

// ─── Constants ───────────────────────────────────────────────────────

/** Country whitelist — extend as new geographies are onboarded. Case-insensitive matching. */
export const KNOWN_COUNTRIES: readonly string[] = [
  "Ethiopia", "Kenya", "Nigeria", "South Sudan", "Uganda", "Tanzania",
  "Rwanda", "Somalia", "Djibouti", "Sudan", "Ghana", "Zambia",
  "Mozambique", "Senegal", "Mali", "Burkina Faso", "Niger", "Cameroon",
  "Congo", "DRC", "Democratic Republic of the Congo", "Angola",
  "Zimbabwe", "Malawi", "Madagascar", "Egypt", "Morocco", "Tunisia",
  "Algeria", "South Africa", "Botswana", "Namibia", "Lesotho", "Eswatini",
  "Sierra Leone", "Liberia", "Côte d'Ivoire", "Ivory Coast", "Togo",
  "Benin", "Gabon", "Eritrea", "Chad", "Central African Republic",
  "Mauritania", "Gambia", "Guinea", "Guinea-Bissau", "Cape Verde",
  // Major non-African geographies clients commonly bid into:
  "United States", "USA", "United Kingdom", "UK", "Germany", "France",
  "Italy", "Spain", "Netherlands", "Belgium", "Sweden", "Norway",
  "Denmark", "Finland", "Switzerland", "Australia", "Canada", "India",
  "Bangladesh", "Pakistan", "Sri Lanka", "Nepal", "Indonesia",
  "Philippines", "Vietnam", "Thailand", "Malaysia", "Singapore",
  "United Arab Emirates", "UAE", "Saudi Arabia", "Qatar", "Kuwait",
  "Oman", "Bahrain", "Jordan", "Lebanon", "Israel", "Türkiye", "Turkey",
];

/**
 * Tokens that, if present in a candidate "client name" value, prove the
 * regex captured a proposal section/TOC entry, not a real organisation
 * name. Expanded over time as bad extractions are observed.
 */
const PROPOSAL_SECTION_NOISE_PATTERN = /\b(references?\b|photos?\b|drawings?\b|technical\s+approach|methodology|compliance|appendix|annex|declaration|relevant\s+experience|section\s+[a-d]\b|cover\s+letter|executive\s+summary|company\s+profile|project\s+reference|financial\s+proposal|submission\s+rules|terms\s+of\s+reference|table\s+of\s+contents|understanding\s+of\s+the\s+assignment|proposed\s+design|where\s+available|completed\s+projects)\b/i;

/** Common placeholder strings that mean "no client set", not a real value.
 * "bid[-_\s]?team\s+to\s+confirm" was the most common production
 * regression (the screenshots showed it in 11/16 metadata fields and
 * leaking straight into generated proposals). */
const PLACEHOLDER_CLIENT_PATTERN = /^(the\s+client|client|unknown|n\/a|na|none|-+|tbd|tba|tbc|to\s+be\s+(determined|confirmed|advised|set)|bid[-_\s]?team\s+to\s+confirm|bid\s+team\s+to\s+confirm|not\s+specified|not\s+provided|not|only|n\/a|pending|blank|placeholder|fill[-_\s]?in)$/i;

/** Generic-anywhere placeholder pattern. Returns true if the value
 * contains a "Bid-Team to confirm" / "TBC" / "TBD" / "placeholder" string
 * anywhere — not just as the whole value. Used by sanitize-stored-metadata
 * so the engine never reads internal placeholder text from any column. */
export const ANYWHERE_PLACEHOLDER_PATTERN = /\b(bid[-_\s]?team\s+to\s+confirm|to\s+be\s+confirmed|to\s+be\s+determined|not\s+specified|not\s+provided|unknown|pending|placeholder)\b|^(tbc|tbd|tba|n\/a|na|none|nil|-+|blank)$/i;

export function containsMetadataPlaceholder(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  // Normalize whitespace: replace NBSP (\u00A0) and other Unicode spaces with
  // regular space, then trim. This handles "Not\u00A0" and "Not\n" variants
  // that would otherwise bypass the placeholder patterns.
  const text = value.replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, " ").trim();
  if (text.length === 0) return false;
  // Check comprehensive placeholder patterns
  if (ANYWHERE_PLACEHOLDER_PATTERN.test(text) || PLACEHOLDER_CLIENT_PATTERN.test(text)) return true;
  // Additional explicit placeholder strings (case-insensitive)
  const lower = text.toLowerCase();
  const EXPLICIT_PLACEHOLDERS = new Set([
    "not", "not extracted", "not mentioned", "not stated", "not provided",
    "not specified", "not applicable", "n/a", "na", "tbd", "tbc", "tba",
    "unknown", "none", "null", "nil", "blank", "pending", "placeholder",
    "to be determined", "to be confirmed", "to be advised",
  ]);
  if (EXPLICIT_PLACEHOLDERS.has(lower)) return true;
  return false;
}

// ─── Generic field-label / heading detection ─────────────────────────────────

/**
 * Values that are just field headings, column labels, or boilerplate printed on
 * tender forms — not real data. If the OCR or AI captures a row label as the
 * value, any downstream consumer would display misleading "extracted" UI.
 *
 * Examples seen in production:
 *   reference field → "Number", "Reference Number", "Tender No."
 *   title field     → "Title", "Subject"
 *   deadline field  → "Date", "Submission Date", "Deadline"
 *   client field    → "Client Name", "Procuring Entity", "Client"
 */
const GENERIC_FIELD_LABEL_PATTERN = /^(number|ref(?:erence)?\.?\s*(?:no\.?|num(?:ber)?)?|tender\s+(?:no\.?|number|ref(?:erence)?)|client\s+(?:name|details?)?|procuring\s+entity|title|subject|description|date|deadline|submission\s+(?:date|deadline)|name|address|phone|contact(?:\s+(?:person|name|details?))?|method|currency|website|location|city|country|type|status|value|amount|budget|remarks?|comments?|notes?|details?)$/i;

/**
 * Returns true when a field value is just a generic heading or column label,
 * not real extracted data. Used to block EXTRACTED_AND_GROUNDED status.
 */
export function isGenericFieldLabel(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (text.length === 0) return false;
  return GENERIC_FIELD_LABEL_PATTERN.test(text);
}

/**
 * Returns true when a date string is ambiguous — i.e., when day and month
 * cannot be determined unambiguously from the format.
 *
 * "12/12/2026" — ambiguous (day and month both ≤ 12).
 * "15/12/2026" — unambiguous (15 can only be a day).
 * "2026-12-15" — unambiguous ISO format.
 */
export function isAmbiguousDateString(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (!text) return false;
  // ISO format is always unambiguous
  if (/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(text)) return false;
  // Slash/dot/dash separated dates where both first and second tokens ≤ 12
  const slashMatch = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.]\d{2,4}$/);
  if (slashMatch) {
    const a = parseInt(slashMatch[1], 10);
    const b = parseInt(slashMatch[2], 10);
    return a <= 12 && b <= 12;
  }
  return false;
}

/**
 * Format a date value into an unambiguous human-readable form: "12 Dec 2026".
 * Returns null when the value is not a parseable date.
 * Accepts ISO strings, Date objects, and unambiguous date strings.
 */
export function formatDateUnambiguous(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return null;
  }
}

/** Words that are NOT valid reference numbers when captured alone. */
const NON_REFERENCE_WORDS = /^(only|n\/a|tbd|none|ref|refer|number|see|above|below|this|that|the|a|an|where|available|attached|enclosed|here|there|see\s+above|see\s+below|reference\s+number|reference\s+no\.?|tender\s+reference|tender\s+no\.?|no\.?|not|not\s+available|not\s+provided|not\s+specified|not\s+stated|not\s+mentioned|not\s+applicable|nil|blank|na|unknown|pending|placeholder)$/i;

/** Single-word tokens that are not real first-name + last-name combinations. */
const CONTACT_NOISE_FRAGMENT = /^(s\s+|the\s+|a\s+|an\s+|contact|person|name|email|tel|phone|address|attn|attention|focal|point|of)/i;

// ─── Client name validation ──────────────────────────────────────────

export type ClientNameStatus =
  | "VALID"
  | "EMPTY"
  | "PLACEHOLDER"  // "The Client", "Unknown", etc.
  | "GARBAGE";     // OCR/TOC fragment

/**
 * Get a structured status for a client name candidate. Returns the most
 * informative reason so callers can render different messages for
 * "not set yet" vs "extracted but broken".
 */
export function getClientNameStatus(value: string | null | undefined): ClientNameStatus {
  const text = (value ?? "").trim();
  if (text.length < 2) return "EMPTY";
  if (PLACEHOLDER_CLIENT_PATTERN.test(text)) return "PLACEHOLDER";
  // TOC/section noise — these are extractions of headings or table-of-contents
  // entries, not real organisation names.
  if (PROPOSAL_SECTION_NOISE_PATTERN.test(text)) return "GARBAGE";
  // Suspiciously long values containing many lower-case sentence words also
  // signal noise — a real entity name is usually <= 90 chars unless it's a
  // ministry/agency with formal structure. We allow long names IF they
  // contain at least one capitalised institution keyword.
  if (text.length > 90 && !/(ministry|authority|agency|commission|corporation|organi[sz]ation|foundation|university|institute|department|company|limited|ltd|inc|plc|pllc|group|consortium|union|federation|bank|trust|fund|ventures?)/i.test(text)) {
    return "GARBAGE";
  }
  // Must contain at least one proper word (≥3 chars).
  const words = text.split(/\s+/).filter((w) => w.length >= 3);
  if (words.length === 0) return "GARBAGE";
  return "VALID";
}

export function isValidClientName(value: string | null | undefined): boolean {
  return getClientNameStatus(value) === "VALID";
}

export function isPlaceholderClientName(value: string | null | undefined): boolean {
  return getClientNameStatus(value) === "PLACEHOLDER";
}

export function isGarbageClientName(value: string | null | undefined): boolean {
  return getClientNameStatus(value) === "GARBAGE";
}

/**
 * UI-friendly message for the client-name display. Returns the trimmed
 * value when valid, an explicit "requires review" message when garbage,
 * and an empty/placeholder message otherwise.
 */
export function clientNameDisplayMessage(value: string | null | undefined): { text: string; status: ClientNameStatus } {
  const status = getClientNameStatus(value);
  if (status === "VALID") return { text: (value ?? "").trim(), status };
  if (status === "GARBAGE") return { text: "Invalid client name extracted — review required", status };
  return { text: "Client name not set", status };
}

// ─── Reference number validation ─────────────────────────────────────

/**
 * Valid reference numbers must:
 *   1. NOT be a common stop-word ("only", "see above", etc.)
 *   2. Be at least 3 chars
 *   3. Contain at least one alphanumeric run of ≥2 chars
 *
 * NOTE: A digit is NOT required. Real tender references like "RFP/CONSULTANCY",
 * "PHARO-RFP", "AA/PROC/ARCH", "PR-FRD", "Tender-A", "ABC/PROC/QC" are valid
 * even without digits. Only actual garbage, labels, placeholders, isolated stop
 * words, and broken OCR fragments should be rejected.
 */
export function isValidReferenceNumber(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (text.length < 3) return false;
  if (NON_REFERENCE_WORDS.test(text)) return false;
  // Metadata placeholders ("unknown", "TBD", "N/A", "Bid-Team to confirm", …)
  // are never a real reference number, even when letter-only refs are allowed.
  if (containsMetadataPlaceholder(text)) return false;
  // Reject if it's mostly noise (no alphanumeric run of ≥2 chars).
  if (!/[A-Z0-9]{2,}/i.test(text)) return false;
  return true;
}

// ─── Country validation ──────────────────────────────────────────────

/**
 * A country value is valid only if its string contains a known country
 * name (case-insensitive, word-boundary). Rejects OCR fragments like
 * "A ddis Ababa" (which is a city anyway).
 */
export function isValidCountry(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (text.length < 2) return false;
  return KNOWN_COUNTRIES.some((name) => {
    // Escape regex meta-chars defensively (some country names contain "-" or ".").
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  });
}

/**
 * Pick the canonical country name for a string that contains a known
 * country (e.g. "Addis Ababa, Ethiopia" → "Ethiopia"). Returns null when
 * no known country is present.
 */
export function canonicalizeCountry(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (text.length < 2) return null;
  for (const name of KNOWN_COUNTRIES) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) return name;
  }
  return null;
}

// ─── Client contact validation ───────────────────────────────────────

/**
 * A valid contact name needs at least two name tokens (first + last) or
 * a clean title phrase. Rejects fragments like "s Contact Person",
 * "Contact Person", "the procurement officer".
 */
export function isValidClientContact(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (text.length < 3) return false;
  // Reject if it starts with a noise fragment ("s Contact Person", etc.).
  if (CONTACT_NOISE_FRAGMENT.test(text)) return false;
  // Reject bare role labels.
  if (/^(contact|focal|person|attention|procurement\s+(officer|manager)|project\s+manager)\.?$/i.test(text)) return false;
  // Require either two capitalised name tokens, OR a title phrase
  // ("Dr. Jane Doe", "Eng. Hassan", "Mr. Otieno").
  const titlePrefix = /^(Mr|Mrs|Ms|Dr|Prof|Eng|Hon)\.?\s+/i;
  if (titlePrefix.test(text)) return true;
  const properTokens = text.split(/\s+/).filter((w) => /^[A-Z][a-z]+$/.test(w));
  return properTokens.length >= 2;
}

// ─── Client name contamination detection ────────────────────────────

/**
 * Detect if a client name is contaminated by tender portal navigation,
 * old tender alerts, or unrelated tender text. Pattern: if the name contains
 * pipes (|) or suspicious phrase combinations suggesting mixed content.
 * Examples: "ABC Ministry | Tender Portal | Old Tender: XYZ"
 */
// Extraction-label echo: a real organization name never contains field
// labels like "Client Name:" or "Project Name:" inside it. Values such as
// "X Procuring Entity / Client Name: X Legal Client Name: X Project Name: Y"
// are several extracted fields concatenated with their labels (observed live
// on the dashboard pipeline) and must be treated as contaminated.
const EMBEDDED_FIELD_LABEL = /\b(?:client|legal\s+client|project|entity|contact(?:\s+person)?|procuring\s+entity|reference)\s*(?:name)?\s*:/i;

export function isClientNameContaminated(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (text.length === 0) return false;
  // Pipe characters almost always indicate merged portal/navigation text
  if (text.includes("|")) return true;
  if (EMBEDDED_FIELD_LABEL.test(text)) return true;
  // Detect phrases that suggest portal/navigation contamination
  if (/(tender\s+portal|old\s+tender|alert|notification|browse|tenders?|portal|dashboard|published|deadline.*passed|archived|closed)/i.test(text)) {
    // But allow legitimate phrases like "Ministry of Health & Tender Division"
    if (!/&|and|division|department|ministry/i.test(text)) return true;
  }
  return false;
}

/**
 * Get a detailed contamination reason for a client name. Returns null if
 * no contamination detected, or a user-friendly message describing the issue.
 */
export function clientNameContaminationReason(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (text.length === 0) return null;
  if (text.includes("|")) {
    return "Client name contains pipe separators (|), indicating mixed portal/navigation text. Manually separate the legitimate client name from portal artifacts.";
  }
  if (EMBEDDED_FIELD_LABEL.test(text)) {
    return "Client name contains embedded field labels (e.g. \"Client Name:\", \"Project Name:\") — several extracted fields were concatenated into one value. Manually enter only the procuring entity's name.";
  }
  if (/(tender\s+portal|old\s+tender|alert|notification|dashboard|published|deadline.*passed|archived|closed)/i.test(text)) {
    if (!/&|and|division|department/i.test(text)) {
      return "Client name appears contaminated by tender portal text or old alerts. Manually extract the real procuring entity name.";
    }
  }
  return null;
}

// ─── Non-client entity label detection ──────────────────────────────

/**
 * Canonical list of labels that indicate a non-client entity (beneficiary,
 * donor, implementing partner, etc.) and should NOT be extracted as the
 * procuring entity or client name. Used across extraction, validation,
 * and repair workflows to ensure consistent safety rules.
 */
const NON_CLIENT_ENTITY_LABELS = [
  "beneficiary",
  "employer",
  "owner",
  "donor",
  "donor agency",
  "financing agency",
  "funded by",
  "financed by",
  "funder",
  "funding agency",
  "grant from",
  "loan from",
  "implementing agency",
  "implementing partner",
  "executing agency",
  "project management unit",
  "project management",
  "pmu",
];

/**
 * Check if a string is a non-client entity label (beneficiary, donor,
 * implementing agency, etc.). These labels should never produce a client
 * or procuring entity name on their own.
 *
 * @param str The label to test (will be lowercased)
 * @returns true if this is a non-client entity label
 */
export function isNonClientEntityLabel(str: string | undefined): boolean {
  if (!str) return false;
  const normalized = str.trim().toLowerCase();
  return NON_CLIENT_ENTITY_LABELS.some((label) =>
    normalized === label || normalized.startsWith(label + " ") || normalized.endsWith(" " + label)
  );
}

/**
 * Generate a regex pattern that matches non-client entity labels as the start
 * of a string (with optional colon/dash suffix). Used in header-fallback guards
 * and extraction filters.
 *
 * @returns A RegExp that matches non-client entity labels at the line start
 */
export function nonClientEntityLabelPattern(): RegExp {
  const escaped = NON_CLIENT_ENTITY_LABELS.map((l) => l.replace(/\s+/g, "\\s+")).join("|");
  return new RegExp(`^(?:${escaped})\\s*[:\\-]?`, "i");
}
