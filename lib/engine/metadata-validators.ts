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

/** Common placeholder strings that mean "no client set", not a real value. */
const PLACEHOLDER_CLIENT_PATTERN = /^(the\s+client|client|unknown|n\/a|na|none|-+|tbd|tba|to\s+be\s+(determined|confirmed|advised))$/i;

/** Words that are NOT valid reference numbers when captured alone. */
const NON_REFERENCE_WORDS = /^(only|n\/a|tbd|none|refer|see|above|below|this|that|the|a|an|where|available|attached|enclosed|here|there)$/i;

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
 *   1. Contain at least one digit (e.g. RFP-2026-001, 2026-024, AAWSA/CONS/03)
 *   2. NOT be a common stop-word ("only", "see above", etc.)
 *   3. Be at least 3 chars
 */
export function isValidReferenceNumber(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (text.length < 3) return false;
  if (NON_REFERENCE_WORDS.test(text)) return false;
  if (!/\d/.test(text)) return false;
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
