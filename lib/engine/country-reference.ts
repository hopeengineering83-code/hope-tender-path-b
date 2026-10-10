/**
 * Generic country reference and country-field hygiene.
 *
 * WHY THIS EXISTS
 * ---------------
 * `Project.country` is a plain country column, but the ingestion paths wrote
 * whatever the source payload put in that slot. On the owner's own portfolio
 * that meant 0 of 114 records held a plain country: the column carried full
 * postal addresses, city/region composites, client names, scale figures
 * ("7,000 m2"), truncated fragments and placeholder words. Three separate
 * consumers read that column as if it were a country:
 *
 *   - portfolio-card-repair renders it as the project LOCATION, which is how
 *     "Abuja, Federal Capital Territory, Nigeria" reached the opening
 *     capability paragraph of an Ethiopian bid;
 *   - proposal-intelligence scores project/tender country agreement by
 *     substring, so a composite address never matches and silently loses the
 *     match points it was entitled to;
 *   - the writer context prints ", <country>" after each project name.
 *
 * The fix belongs here rather than in any one consumer: one predicate for
 * "is this actually a country", one extractor for "which countries does this
 * text name", and one conservative resolver that may only derive a country
 * from the SAME record's own source-backed evidence.
 *
 * DELIBERATELY NOT DONE
 * ---------------------
 * Nothing here consults the current tender's country, the company's
 * nationality, a sibling project, a default region, or any outside knowledge.
 * There are no country-specific or sector-specific special cases: Ethiopia is
 * an ordinary entry in the table below and gets no precedence. When the
 * evidence on a record is absent or points at more than one country, the
 * resolver refuses to decide and says so.
 */

/**
 * ISO 3166-1 short names, with the aliases that appear in real tender and
 * portfolio prose. Order carries no meaning - matching is longest-alias-first,
 * never table order, because table order is how a list quietly becomes
 * region-shaped.
 */
const COUNTRIES: ReadonlyArray<{ canonical: string; aliases?: readonly string[] }> = [
  { canonical: "Afghanistan" }, { canonical: "Albania" }, { canonical: "Algeria" },
  { canonical: "Andorra" }, { canonical: "Angola" }, { canonical: "Argentina" },
  { canonical: "Armenia" }, { canonical: "Australia" }, { canonical: "Austria" },
  { canonical: "Azerbaijan" }, { canonical: "Bahamas" }, { canonical: "Bahrain" },
  { canonical: "Bangladesh" }, { canonical: "Barbados" }, { canonical: "Belarus" },
  { canonical: "Belgium" }, { canonical: "Belize" }, { canonical: "Benin" },
  { canonical: "Bhutan" }, { canonical: "Bolivia" },
  { canonical: "Bosnia and Herzegovina", aliases: ["Bosnia", "Bosnia & Herzegovina"] },
  { canonical: "Botswana" }, { canonical: "Brazil" }, { canonical: "Brunei" },
  { canonical: "Bulgaria" }, { canonical: "Burkina Faso" }, { canonical: "Burundi" },
  { canonical: "Cabo Verde", aliases: ["Cape Verde"] }, { canonical: "Cambodia" },
  { canonical: "Cameroon" }, { canonical: "Canada" },
  { canonical: "Central African Republic" },
  { canonical: "Chad" }, { canonical: "Chile" }, { canonical: "China" },
  { canonical: "Colombia" }, { canonical: "Comoros" },
  { canonical: "Congo", aliases: ["Republic of Congo", "Republic of the Congo", "Congo-Brazzaville"] },
  { canonical: "Costa Rica" },
  { canonical: "Cote d'Ivoire", aliases: ["Côte d'Ivoire", "Ivory Coast"] },
  { canonical: "Croatia" }, { canonical: "Cuba" }, { canonical: "Cyprus" },
  { canonical: "Czechia", aliases: ["Czech Republic"] },
  { canonical: "DRC", aliases: ["Democratic Republic of Congo", "Democratic Republic of the Congo", "DR Congo", "Congo DRC", "Congo (DRC)", "Congo Kinshasa"] },
  { canonical: "Denmark" }, { canonical: "Djibouti" }, { canonical: "Dominica" },
  { canonical: "Dominican Republic" }, { canonical: "Ecuador" }, { canonical: "Egypt" },
  { canonical: "El Salvador" }, { canonical: "Equatorial Guinea" }, { canonical: "Eritrea" },
  { canonical: "Estonia" }, { canonical: "Eswatini", aliases: ["Swaziland"] },
  { canonical: "Ethiopia" }, { canonical: "Fiji" }, { canonical: "Finland" },
  { canonical: "France" }, { canonical: "Gabon" }, { canonical: "Gambia" },
  { canonical: "Georgia" }, { canonical: "Germany" }, { canonical: "Ghana" },
  { canonical: "Greece" }, { canonical: "Grenada" }, { canonical: "Guatemala" },
  { canonical: "Guinea" }, { canonical: "Guinea-Bissau" }, { canonical: "Guyana" },
  { canonical: "Haiti" }, { canonical: "Honduras" }, { canonical: "Hungary" },
  { canonical: "Iceland" }, { canonical: "India" }, { canonical: "Indonesia" },
  { canonical: "Iran" }, { canonical: "Iraq" }, { canonical: "Ireland" },
  { canonical: "Israel" }, { canonical: "Italy" }, { canonical: "Jamaica" },
  { canonical: "Japan" }, { canonical: "Jordan" }, { canonical: "Kazakhstan" },
  { canonical: "Kenya" }, { canonical: "Kiribati" }, { canonical: "Kosovo" },
  { canonical: "Kuwait" }, { canonical: "Kyrgyzstan" }, { canonical: "Laos" },
  { canonical: "Latvia" }, { canonical: "Lebanon" }, { canonical: "Lesotho" },
  { canonical: "Liberia" }, { canonical: "Libya" }, { canonical: "Liechtenstein" },
  { canonical: "Lithuania" }, { canonical: "Luxembourg" }, { canonical: "Madagascar" },
  { canonical: "Malawi" }, { canonical: "Malaysia" }, { canonical: "Maldives" },
  { canonical: "Mali" }, { canonical: "Malta" }, { canonical: "Mauritania" },
  { canonical: "Mauritius" }, { canonical: "Mexico" }, { canonical: "Moldova" },
  { canonical: "Monaco" }, { canonical: "Mongolia" }, { canonical: "Montenegro" },
  { canonical: "Morocco" }, { canonical: "Mozambique" },
  { canonical: "Myanmar", aliases: ["Burma"] }, { canonical: "Namibia" },
  { canonical: "Nepal" },
  { canonical: "Netherlands", aliases: ["Holland", "The Netherlands"] },
  { canonical: "New Zealand" }, { canonical: "Nicaragua" }, { canonical: "Niger" },
  { canonical: "Nigeria" }, { canonical: "North Macedonia", aliases: ["Macedonia"] },
  { canonical: "Norway" }, { canonical: "Oman" }, { canonical: "Pakistan" },
  { canonical: "Palestine", aliases: ["West Bank"] }, { canonical: "Panama" },
  { canonical: "Papua New Guinea" }, { canonical: "Paraguay" }, { canonical: "Peru" },
  { canonical: "Philippines" }, { canonical: "Poland" }, { canonical: "Portugal" },
  { canonical: "Qatar" }, { canonical: "Romania" }, { canonical: "Russia" },
  { canonical: "Rwanda" }, { canonical: "Samoa" }, { canonical: "Saudi Arabia" },
  { canonical: "Senegal" }, { canonical: "Serbia" }, { canonical: "Seychelles" },
  { canonical: "Sierra Leone" }, { canonical: "Singapore" }, { canonical: "Slovakia" },
  { canonical: "Slovenia" }, { canonical: "Solomon Islands" }, { canonical: "Somalia" },
  { canonical: "Somaliland" },
  { canonical: "South Africa" },
  { canonical: "South Korea", aliases: ["Korea, Republic of", "Republic of Korea"] },
  { canonical: "South Sudan" }, { canonical: "Spain" }, { canonical: "Sri Lanka" },
  { canonical: "Sudan" }, { canonical: "Suriname" }, { canonical: "Sweden" },
  { canonical: "Switzerland" }, { canonical: "Syria" }, { canonical: "Taiwan" },
  { canonical: "Tajikistan" },
  { canonical: "Tanzania", aliases: ["United Republic of Tanzania"] },
  { canonical: "Thailand" }, { canonical: "Timor-Leste", aliases: ["East Timor"] },
  { canonical: "Togo" }, { canonical: "Tonga" }, { canonical: "Trinidad and Tobago" },
  { canonical: "Tunisia" }, { canonical: "Turkey", aliases: ["Turkiye", "Türkiye"] },
  { canonical: "Turkmenistan" }, { canonical: "Uganda" }, { canonical: "Ukraine" },
  { canonical: "United Arab Emirates", aliases: ["UAE"] },
  { canonical: "United Kingdom", aliases: ["UK", "Great Britain", "Britain", "England", "Scotland", "Wales", "Northern Ireland"] },
  { canonical: "United States", aliases: ["USA", "U.S.A.", "United States of America", "US", "U.S."] },
  { canonical: "Uruguay" }, { canonical: "Uzbekistan" }, { canonical: "Vanuatu" },
  { canonical: "Venezuela" }, { canonical: "Vietnam" }, { canonical: "Yemen" },
  { canonical: "Zambia" }, { canonical: "Zimbabwe" },
];

/** Aliases this short are matched case-sensitively so ordinary prose ("us", "uk") is not a country. */
const ABBREVIATION_MAX_LENGTH = 5;

/** Words that occupy the column but assert nothing. They are malformed, not valid, and never a country. */
const PLACEHOLDER_VALUES = new Set([
  "none", "n a", "na", "nil", "null", "undefined", "unknown", "unspecified",
  "not specified", "not stated", "not applicable", "not available", "tbd", "tba",
  "to be confirmed", "to be advised", "bid team to confirm", "bid-team to confirm",
  "pending", "various", "multiple", "other", "-", "0",
]);

export type CountryMalformedReason =
  /** Names exactly one country but carries extra text - an address, "City, Region, Country". */
  | "COMPOSITE_LOCATION"
  /** Names more than one country in a single field. */
  | "MULTIPLE_COUNTRIES"
  /** A word that stands in for a value without being one. */
  | "PLACEHOLDER"
  /** No country anywhere in the value - a client name, a city, an area figure, a fragment. */
  | "NOT_A_COUNTRY";

export type CountryClassification =
  | { kind: "EMPTY" }
  | { kind: "VALID"; canonical: string }
  | { kind: "MALFORMED"; reason: CountryMalformedReason; embedded: readonly string[] };

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Lowercase, de-accent, unify dashes/quotes, drop punctuation, collapse whitespace. */
export function normaliseCountryToken(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9'&\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every alias, longest first, so "Democratic Republic of Congo" is consumed before "Congo". */
const ALIAS_INDEX: ReadonlyArray<{ alias: string; canonical: string; normalised: string }> = (() => {
  const rows: Array<{ alias: string; canonical: string; normalised: string }> = [];
  for (const entry of COUNTRIES) {
    for (const alias of [entry.canonical, ...(entry.aliases ?? [])]) {
      rows.push({ alias, canonical: entry.canonical, normalised: normaliseCountryToken(alias) });
    }
  }
  rows.sort((a, b) => b.alias.length - a.alias.length);
  return rows;
})();

const EXACT_LOOKUP: ReadonlyMap<string, string> = new Map(
  ALIAS_INDEX.map((row) => [row.normalised, row.canonical] as const),
);

/** The canonical spelling of a value that is exactly a country, else null. */
export function canonicaliseCountry(value: string | null | undefined): string | null {
  if (!value) return null;
  let token = normaliseCountryToken(value);
  if (!token) return null;
  token = token.replace(/^the /, "");
  return EXACT_LOOKUP.get(token) ?? null;
}

export function isValidCountryValue(value: string | null | undefined): boolean {
  return canonicaliseCountry(value) !== null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Geographic features that borrow a country's name while lying somewhere else.
 * "Niger Delta" is in Nigeria, the "Congo Basin" spans six countries and the
 * "Jordan River" is a border. Reading the country name out of one of these puts
 * a wrong country in a bid, which is the harm this whole module exists to
 * prevent. The rule is a shape, not a list of places: a country token directly
 * followed by one of these capitalised feature words, or directly preceded by
 * "Gulf/Sea/Bay/Strait of", is part of a different toponym.
 */
const FEATURE_SUFFIX = /^\s+(?:Delta|River|Basin|Valley|Gulf|Sea|Strait|Desert|Bay|Escarpment|Highlands|Lowlands|Plateau|Rift)\b/;
const FEATURE_PREFIX = /(?:Gulf|Sea|Bay|Strait)\s+of\s+$/i;

/**
 * Distinct canonical countries named in free text, in order of first
 * appearance. Longest aliases match first and their spans are masked, so a
 * single mention of "Democratic Republic of Congo" yields DRC once rather
 * than DRC plus Congo. Short all-caps aliases ("US", "UK", "UAE") are matched
 * case-sensitively; everything else case-insensitively.
 */
export function findCountriesInText(text: string | null | undefined): string[] {
  if (!text) return [];
  let haystack = stripDiacritics(text).replace(/[‘’]/g, "'");
  const found: Array<{ canonical: string; at: number }> = [];

  for (const row of ALIAS_INDEX) {
    const abbreviation = row.alias.length <= ABBREVIATION_MAX_LENGTH && row.alias === row.alias.toUpperCase();
    const body = escapeRegExp(stripDiacritics(row.alias)).replace(/\s+/g, "\\s+");
    const pattern = new RegExp(`(?<![A-Za-z])${body}(?![A-Za-z])`, abbreviation ? "g" : "gi");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(haystack)) !== null) {
      const after = haystack.slice(match.index + match[0].length, match.index + match[0].length + 24);
      const before = haystack.slice(Math.max(0, match.index - 12), match.index);
      const isFeatureName = FEATURE_SUFFIX.test(after) || FEATURE_PREFIX.test(before);
      if (!isFeatureName) found.push({ canonical: row.canonical, at: match.index });
      // Mask the span either way: a shorter alias must not claim the same
      // characters, and "Congo" must not be read out of "Congo Basin" after
      // the longer form was ruled out.
      haystack =
        haystack.slice(0, match.index) +
        " ".repeat(match[0].length) +
        haystack.slice(match.index + match[0].length);
      pattern.lastIndex = match.index + match[0].length;
    }
  }

  found.sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const hit of found) {
    if (seen.has(hit.canonical)) continue;
    seen.add(hit.canonical);
    ordered.push(hit.canonical);
  }
  return ordered;
}

/** Is this stored value a country, a composite, a placeholder, or not a country at all? */
export function classifyCountryValue(value: string | null | undefined): CountryClassification {
  const raw = (value ?? "").trim();
  if (!raw) return { kind: "EMPTY" };

  const exact = canonicaliseCountry(raw);
  if (exact) return { kind: "VALID", canonical: exact };

  const normalised = normaliseCountryToken(raw);
  if (PLACEHOLDER_VALUES.has(normalised)) {
    return { kind: "MALFORMED", reason: "PLACEHOLDER", embedded: [] };
  }

  const embedded = findCountriesInText(raw);
  if (embedded.length > 1) return { kind: "MALFORMED", reason: "MULTIPLE_COUNTRIES", embedded };
  if (embedded.length === 1) return { kind: "MALFORMED", reason: "COMPOSITE_LOCATION", embedded };
  return { kind: "MALFORMED", reason: "NOT_A_COUNTRY", embedded: [] };
}

export type CountryResolutionOutcome =
  /** Already a country. Nothing is written. */
  | "PRESERVED_VALID"
  /** The stored composite named exactly one country; the plain country is written. */
  | "RESOLVED_FROM_STORED_VALUE"
  /** The record's own source text named exactly one country; that is written. */
  | "RESOLVED_FROM_SOURCE_TEXT"
  /** Evidence on this record points at more than one country. Nothing is written. */
  | "UNRESOLVED_AMBIGUOUS"
  /** No country appears anywhere on this record. Nothing is written. */
  | "UNRESOLVED_NO_EVIDENCE";

export type CountryResolution = {
  readonly outcome: CountryResolutionOutcome;
  /** True only when `country` should replace what is stored. */
  readonly shouldWrite: boolean;
  /** The value to store when `shouldWrite`; otherwise the stored value, unchanged. */
  readonly country: string | null;
  readonly previous: string | null;
  /**
   * The original composite, when a plain country replaced it. The Project model
   * has no location column, so this is returned for provenance rather than
   * written to a field of its own - the location detail itself is still in the
   * record's source text, which is the authority for it either way.
   */
  readonly displacedDetail: string | null;
  readonly candidates: readonly string[];
  readonly reason: string;
};

/**
 * Decide what `Project.country` should hold, using only this record's own
 * evidence.
 *
 * Precedence:
 *   1. A stored value that is already a country is preserved untouched.
 *   2. A stored composite that names exactly one country yields that country -
 *      the stored field is itself source-backed, and this only removes the
 *      non-country text around it.
 *   3. Otherwise the record's own source text, if it names exactly one country.
 *   4. Anything else stays as it is and is reported, because a wrong country in
 *      a bid is worse than an empty one.
 */
export function resolveProjectCountry(input: {
  storedCountry?: string | null;
  sourceText?: string | null;
}): CountryResolution {
  const previous = (input.storedCountry ?? "").trim() || null;
  const classification = classifyCountryValue(previous);

  if (classification.kind === "VALID") {
    return {
      outcome: "PRESERVED_VALID",
      shouldWrite: false,
      country: previous,
      previous,
      displacedDetail: null,
      candidates: [classification.canonical],
      reason: `"${previous}" is already a country; left untouched.`,
    };
  }

  if (classification.kind === "MALFORMED" && classification.reason === "MULTIPLE_COUNTRIES") {
    return {
      outcome: "UNRESOLVED_AMBIGUOUS",
      shouldWrite: false,
      country: previous,
      previous,
      displacedDetail: null,
      candidates: classification.embedded,
      reason: `"${previous}" names more than one country (${classification.embedded.join(", ")}); left unresolved for review.`,
    };
  }

  if (classification.kind === "MALFORMED" && classification.reason === "COMPOSITE_LOCATION") {
    const canonical = classification.embedded[0];
    return {
      outcome: "RESOLVED_FROM_STORED_VALUE",
      shouldWrite: canonical !== previous,
      country: canonical,
      previous,
      displacedDetail: previous,
      candidates: classification.embedded,
      reason: `"${previous}" is a location composite naming ${canonical}; the country field now holds "${canonical}" and the fuller location remains in the record's source text.`,
    };
  }

  // EMPTY, PLACEHOLDER, or NOT_A_COUNTRY - the stored value carries no country,
  // so the only admissible evidence left is this record's own source text.
  const fromSource = findCountriesInText(input.sourceText ?? null);
  if (fromSource.length === 1) {
    return {
      outcome: "RESOLVED_FROM_SOURCE_TEXT",
      shouldWrite: fromSource[0] !== previous,
      country: fromSource[0],
      previous,
      displacedDetail: classification.kind === "EMPTY" ? null : previous,
      candidates: fromSource,
      reason: `The record's own source text names ${fromSource[0]} and no other country.`,
    };
  }
  if (fromSource.length > 1) {
    return {
      outcome: "UNRESOLVED_AMBIGUOUS",
      shouldWrite: false,
      country: previous,
      previous,
      displacedDetail: null,
      candidates: fromSource,
      reason: `The record's source text names ${fromSource.length} countries (${fromSource.join(", ")}); no single country can be attributed to this project.`,
    };
  }
  return {
    outcome: "UNRESOLVED_NO_EVIDENCE",
    shouldWrite: false,
    country: previous,
    previous,
    displacedDetail: null,
    candidates: [],
    reason: previous
      ? `"${previous}" is not a country and the record's source text names none; left unresolved for review.`
      : "No country is stored and the record's source text names none; left unresolved for review.",
  };
}
