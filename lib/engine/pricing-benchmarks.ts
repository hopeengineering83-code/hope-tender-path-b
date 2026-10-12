/**
 * The Pricing Benchmark Registry: market evidence for Pricing Intelligence.
 *
 * Every benchmark carries where it came from — source, reference, source type,
 * effective date, last verified date, confidence — and no rate enters an
 * estimate without that trail. Two origins:
 *
 *   • SEED — the few public, verifiable figures the app ships with. Each was
 *     checked against its published source on `lastVerified`. They are
 *     deliberately few: no Ethiopian consultancy day-rate scale is publicly
 *     available (a construction-consultancy fee guideline was submitted to the
 *     Construction Management Institute in December 2025 but not published),
 *     so the app ships the public salary scale, the public daily-allowance
 *     directive and the statutory pension rate, and derives a transparent,
 *     LOW-confidence cost model from them rather than inventing fee rates.
 *   • OWNER — the firm's own rate card and any published scale the owner
 *     imports once (PricingBenchmark rows). An owner fee rate for a role
 *     outranks the cost model on every later tender.
 *
 * Pure: no database. pricing-intelligence-loader.ts reads the owner rows.
 */

export type BenchmarkCategory =
  | "PERSONNEL_FEE"
  | "PERSONNEL_SALARY"
  | "PER_DIEM"
  | "TRANSPORT"
  | "WORKSHOP"
  | "ENUMERATOR"
  | "LABORATORY"
  | "DRILLING"
  | "SURVEY"
  | "EQUIPMENT"
  | "PRINTING"
  | "SUBCONSULTANT"
  | "PERCENT_OF_WORKS"
  | "STATUTORY_RATE";

export type BenchmarkSeniority = "JUNIOR" | "MID" | "SENIOR" | "EXPERT";
export type BenchmarkSourceType = "GOVERNMENT_PAY_SCALE" | "GOVERNMENT_DIRECTIVE" | "STATUTE" | "PUBLISHED_STUDY" | "PUBLISHED_FEE_SCALE" | "MARKET_SURVEY" | "OWNER_RATE_CARD";
export type BenchmarkConfidence = "HIGH" | "MEDIUM" | "LOW";

export type PricingBenchmark = {
  id: string;
  origin: "SEED" | "OWNER";
  market: string;
  category: BenchmarkCategory;
  /** Role or service the rate is for: a role key (see classifyRole) or a service key ("design", "supervision", "per_diem_zonal_capital"). */
  serviceKey: string;
  label: string;
  seniority?: BenchmarkSeniority | null;
  /** DAY | MONTH | EACH | LUMP_SUM | KM | PERCENT */
  unit: string;
  currency: string;
  low: number;
  median: number;
  high: number;
  /** COST: what the firm pays (a salary, an allowance); FEE: what a client is billed. */
  rateBasis: "COST" | "FEE";
  effectiveDate: string;
  source: string;
  sourceUrl?: string | null;
  sourceType: BenchmarkSourceType;
  confidence: BenchmarkConfidence;
  notes?: string | null;
  lastVerified: string;
};

const FCSC_SALARY = {
  source: "Federal Civil Service Commission revised civil-service salary scale, effective September 2025 (reported by the Ethiopian News Agency and Addis Standard)",
  sourceUrl: "https://addisstandard.com/ethiopia-raises-civil-servants-salaries-degree-holder-entry-pay-set-at-11500-birr-from-september/",
  sourceType: "GOVERNMENT_PAY_SCALE" as const,
  effectiveDate: "2025-09-01",
  lastVerified: "2026-10-07",
};

const FCSC_ALLOWANCE = {
  source: "Federal Civil Service Commission revised daily-allowance directive for government employees (reported by Addis Insight, 5 October 2025)",
  sourceUrl: "https://www.addisinsight.net/2025/10/05/ethiopia-introduces-new-daily-allowance-rates-for-government-employees/",
  sourceType: "GOVERNMENT_DIRECTIVE" as const,
  effectiveDate: "2025-10-05",
  lastVerified: "2026-10-07",
};

/** The public figures the app ships with. Nothing here is an invented market rate. */
export const SEED_BENCHMARKS: readonly PricingBenchmark[] = [
  {
    id: "seed-et-salary-junior", origin: "SEED", market: "ET", category: "PERSONNEL_SALARY", serviceKey: "professional", seniority: "JUNIOR",
    label: "Professional monthly basic salary — entry, bachelor's degree", unit: "MONTH", currency: "ETB", low: 11_500, median: 11_500, high: 11_500, rateBasis: "COST",
    ...FCSC_SALARY, confidence: "LOW",
    notes: "Public civil-service entry pay for degree holders. A floor for private consultancy salaries, not a market median.",
  },
  {
    id: "seed-et-salary-mid", origin: "SEED", market: "ET", category: "PERSONNEL_SALARY", serviceKey: "professional", seniority: "MID",
    label: "Professional monthly basic salary — mid-career", unit: "MONTH", currency: "ETB", low: 11_500, median: 25_250, high: 39_000, rateBasis: "COST",
    ...FCSC_SALARY, confidence: "LOW",
    notes: "Range from entry degree pay (11,500) to the highest professional grade (39,000); the median is their midpoint — an interpolation, not a published figure.",
  },
  {
    id: "seed-et-salary-senior", origin: "SEED", market: "ET", category: "PERSONNEL_SALARY", serviceKey: "professional", seniority: "SENIOR",
    label: "Professional monthly basic salary — highest professional grade", unit: "MONTH", currency: "ETB", low: 39_000, median: 39_000, high: 39_000, rateBasis: "COST",
    ...FCSC_SALARY, confidence: "LOW",
    notes: "Public civil-service maximum for the professional grades (raised from 21,492 to 39,000).",
  },
  {
    id: "seed-et-salary-expert", origin: "SEED", market: "ET", category: "PERSONNEL_SALARY", serviceKey: "professional", seniority: "EXPERT",
    label: "Professional monthly basic salary — senior government expert", unit: "MONTH", currency: "ETB", low: 39_000, median: 50_521, high: 50_521, rateBasis: "COST",
    ...FCSC_SALARY, confidence: "LOW",
    notes: "Top of the public scale for senior experts and executives (up to 50,521).",
  },
  {
    id: "seed-et-pension-employer", origin: "SEED", market: "ET", category: "STATUTORY_RATE", serviceKey: "employer_pension", label: "Employer pension contribution",
    unit: "PERCENT", currency: "ETB", low: 11, median: 11, high: 11, rateBasis: "COST",
    effectiveDate: "2011-01-01", source: "Private Organization Employees' Pension Proclamation No. 715/2011 (employer contribution 11% of basic salary)",
    sourceUrl: null, sourceType: "STATUTE", confidence: "HIGH", lastVerified: "2026-10-07",
  },
  {
    id: "seed-et-perdiem-addis", origin: "SEED", market: "ET", category: "PER_DIEM", serviceKey: "per_diem_addis_ababa", label: "Daily allowance — Addis Ababa (highest salary level)",
    unit: "DAY", currency: "ETB", low: 2_534, median: 2_534, high: 2_534, rateBasis: "COST", ...FCSC_ALLOWANCE, confidence: "MEDIUM",
    notes: "Government daily allowance; a consultant's field subsistence is at least this.",
  },
  {
    id: "seed-et-perdiem-regional", origin: "SEED", market: "ET", category: "PER_DIEM", serviceKey: "per_diem_regional_capital", label: "Daily allowance — regional capitals (highest salary level)",
    unit: "DAY", currency: "ETB", low: 1_145, median: 1_840, high: 2_534, rateBasis: "COST", ...FCSC_ALLOWANCE, confidence: "MEDIUM",
    notes: "Published range 1,145 (Gambella) to 2,534 (Addis Ababa); the median is the midpoint.",
  },
  {
    id: "seed-et-perdiem-zonal", origin: "SEED", market: "ET", category: "PER_DIEM", serviceKey: "per_diem_zonal_capital", label: "Daily allowance — zonal capitals (highest salary level)",
    unit: "DAY", currency: "ETB", low: 945, median: 1_203, high: 1_460, rateBasis: "COST", ...FCSC_ALLOWANCE, confidence: "MEDIUM",
    notes: "Published range 945 to 1,460; the median is the midpoint.",
  },
  {
    id: "seed-et-perdiem-woreda", origin: "SEED", market: "ET", category: "PER_DIEM", serviceKey: "per_diem_woreda", label: "Daily allowance — woreda and urban municipalities",
    unit: "DAY", currency: "ETB", low: 788, median: 1_030, high: 1_271, rateBasis: "COST", ...FCSC_ALLOWANCE, confidence: "MEDIUM",
    notes: "Published range 788 to 1,271; the median is the midpoint.",
  },
  {
    id: "seed-et-pow-design", origin: "SEED", market: "ET", category: "PERCENT_OF_WORKS", serviceKey: "design", label: "Design consultancy fee as a share of construction cost",
    unit: "PERCENT", currency: "ETB", low: 1.23, median: 1.23, high: 1.23, rateBasis: "FEE", effectiveDate: "2013-12-01",
    source: "CoST Ethiopia Aggregation Study (industry average design-contract share of construction cost)", sourceUrl: "https://infrastructuretransparency.org/wp-content/uploads/2013/12/CoST-Ethiopia-Aggregation-Study.pdf",
    sourceType: "PUBLISHED_STUDY", confidence: "LOW", lastVerified: "2026-10-07",
    notes: "An industry average from 2013, before the 2024 currency float; a cross-check, not a price.",
  },
  {
    id: "seed-et-pow-supervision", origin: "SEED", market: "ET", category: "PERCENT_OF_WORKS", serviceKey: "supervision", label: "Supervision consultancy fee as a share of construction cost",
    unit: "PERCENT", currency: "ETB", low: 3.01, median: 3.01, high: 3.01, rateBasis: "FEE", effectiveDate: "2013-12-01",
    source: "CoST Ethiopia Aggregation Study (industry average supervision-contract share of construction cost)", sourceUrl: "https://infrastructuretransparency.org/wp-content/uploads/2013/12/CoST-Ethiopia-Aggregation-Study.pdf",
    sourceType: "PUBLISHED_STUDY", confidence: "LOW", lastVerified: "2026-10-07",
    notes: "An industry average from 2013, before the 2024 currency float; a cross-check, not a price.",
  },
];

/** A benchmark older than this is reported as stale. */
export const BENCHMARK_STALE_AFTER_MONTHS = 24;

export function benchmarkAgeMonths(b: Pick<PricingBenchmark, "effectiveDate" | "lastVerified">, now: Date): number {
  const effective = new Date(b.effectiveDate);
  if (Number.isNaN(effective.getTime())) return Infinity;
  return (now.getTime() - effective.getTime()) / (1000 * 60 * 60 * 24 * 30.4);
}

const ROLE_KEYS: Array<{ key: string; test: RegExp }> = [
  { key: "quantity_surveyor", test: /quantity\s+survey|\bqs\b|cost\s+(?:engineer|estimator)|\bboq\b/i },
  { key: "geotechnical_engineer", test: /geotech|soil|hydrogeolog|geolog/i },
  { key: "structural_engineer", test: /structur/i },
  { key: "highway_engineer", test: /highway|road|pavement|transport|traffic|bridge/i },
  { key: "water_engineer", test: /water|wash\b|sanitation|hydraul|irrigation|hydrolog/i },
  { key: "electrical_engineer", test: /electric/i },
  { key: "mechanical_engineer", test: /mechanic|hvac|plumbing|\bmep\b/i },
  { key: "urban_planner", test: /urban|planner|planning|land\s+use|master\s+plan/i },
  { key: "environmental_specialist", test: /environment|esia|esmp|climate/i },
  { key: "social_specialist", test: /social|gender|community|resettlement|safeguard/i },
  { key: "interior_designer", test: /interior/i },
  { key: "architect", test: /architect/i },
  { key: "surveyor", test: /surveyor|topograph|gis\b/i },
  { key: "economist", test: /econom|financ|tariff/i },
  { key: "data_specialist", test: /\bmeal\b|m\s*&\s*e|monitoring|data|statistic|evaluation/i },
  { key: "civil_engineer", test: /civil/i },
];

/** The role key a job title names, for matching fee benchmarks; "professional" when none. */
export function classifyRole(title: string): string {
  const hit = ROLE_KEYS.find((r) => r.test.test(title));
  return hit ? hit.key : "professional";
}

const LEADER = /\b(?:team\s+leader|project\s+manager|project\s+director|principal|chief|general\s+manager)\b/i;

/** Seniority from the title and stated years; a team lead is EXPERT. */
export function seniorityOf(title: string, years?: number | null): BenchmarkSeniority {
  if (LEADER.test(title)) return "EXPERT";
  if (/\bjunior|assistant|trainee|graduate\b/i.test(title)) return "JUNIOR";
  if (/\bsenior|lead\b/i.test(title)) return "SENIOR";
  const y = years ?? null;
  if (y === null) return "MID";
  if (y >= 15) return "EXPERT";
  if (y >= 8) return "SENIOR";
  if (y >= 3) return "MID";
  return "JUNIOR";
}

const SENIORITY_ORDER: BenchmarkSeniority[] = ["JUNIOR", "MID", "SENIOR", "EXPERT"];
const PERSONNEL_CATEGORIES: ReadonlySet<BenchmarkCategory> = new Set(["PERSONNEL_FEE", "PERSONNEL_SALARY"]);

// Country names are matched against every region the runtime knows (ISO 3166
// alpha-2, named by Intl.DisplayNames), not a hand-written regional list: a
// ten-country list read "Nigeria", "Ghana" or "India" as no market at all, and
// a rate approved there then priced a tender anywhere in the same currency.
// The aliases cover common spellings the ISO English names do not use.
const MARKET_ALIASES: ReadonlyArray<[string, string]> = [
  ["ivory coast", "CI"], ["cote d ivoire", "CI"],
  ["democratic republic of the congo", "CD"], ["democratic republic of congo", "CD"], ["dr congo", "CD"], ["drc", "CD"],
  ["republic of the congo", "CG"], ["congo brazzaville", "CG"],
  ["united states of america", "US"], ["usa", "US"], ["united kingdom of great britain", "GB"], ["great britain", "GB"], ["uk", "GB"],
  ["burma", "MM"], ["swaziland", "SZ"], ["cape verde", "CV"], ["the gambia", "GM"], ["east timor", "TL"],
  ["palestine", "PS"], ["vatican", "VA"], ["turkiye", "TR"], ["czechia", "CZ"], ["north macedonia", "MK"],
];

const normalizePlace = (value: string) => value
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z]+/g, " ").trim();

// Withdrawn, transitional and non-country codes the runtime still names
// ("BU" = Myanmar, "YU" = Serbia, "EU", "UN", "ZZ" …). A country resolves to
// its current code only.
const NOT_A_CURRENT_COUNTRY = new Set(["AN", "BU", "CS", "DD", "DY", "FX", "HV", "NH", "RH", "SU", "TP", "UK", "VD", "YD", "YU", "ZR", "EU", "EZ", "UN", "QO", "XA", "XB", "ZZ"]);

let regionNames: Array<{ name: string; code: string }> | null = null;
function regionIndex(): Array<{ name: string; code: string }> {
  if (regionNames) return regionNames;
  const byName = new Map<string, Set<string>>();
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        if (NOT_A_CURRENT_COUNTRY.has(code)) continue;
        let name: string | undefined;
        try { name = names.of(code); } catch { name = undefined; }
        if (!name || name === code) continue;
        // "Congo - Kinshasa", "Myanmar (Burma)": the name before any qualifier is also a name.
        for (const variant of new Set([name, name.split(/\s+[-(]/)[0]!])) {
          const normalized = normalizePlace(variant);
          if (normalized.length >= 3) (byName.get(normalized) ?? byName.set(normalized, new Set()).get(normalized)!).add(code);
        }
      }
    }
  } catch {
    // No region data in this runtime: the aliases and two-letter codes still resolve.
  }
  // A name two countries share ("congo") names neither.
  const entries = [...byName].filter(([, codes]) => codes.size === 1).map(([name, codes]) => ({ name, code: [...codes][0]! }));
  entries.push(...MARKET_ALIASES.map(([name, code]) => ({ name, code })));
  // Longest first, so "south sudan" is read before "sudan" and "nigeria" before "niger".
  regionNames = entries.sort((x, y) => y.name.length - x.name.length);
  return regionNames;
}

/**
 * The market for a country as a tender records it ("Ethiopia", "ET",
 * "Federal Republic of Nigeria"). Any recognised country resolves to its ISO
 * code; a name the runtime does not know becomes a market of its own (its
 * normalised name), so it never matches another country. Null only when no
 * country is recorded.
 */
export function marketOf(country: string | null | undefined): string | null {
  const value = String(country ?? "").trim();
  if (!value) return null;
  if (/^[A-Za-z]{2}$/.test(value)) return value.toUpperCase();
  const place = ` ${normalizePlace(value)} `;
  if (!place.trim()) return null;
  const hit = regionIndex().find((entry) => place.includes(` ${entry.name} `));
  return hit ? hit.code : place.trim().toUpperCase();
}

/**
 * The best benchmark for a need: same market, currency, category and unit;
 * the role/service key exactly, else a generic "professional" entry; the same
 * seniority, else the nearest. Owner entries outrank seed entries; newer
 * outranks older.
 *
 * A personnel rate is for one seniority. An entry more than one step from the
 * role's seniority does not price it — a team leader's day rate is not a
 * junior's — and an entry with no seniority prices only its own named role,
 * never every role through the generic key.
 */
export function findBenchmark(
  list: readonly PricingBenchmark[],
  need: { category: BenchmarkCategory; serviceKey: string; currency: string; unit?: string; seniority?: BenchmarkSeniority | null; market?: string | null },
): PricingBenchmark | null {
  const want = need.seniority ? SENIORITY_ORDER.indexOf(need.seniority) : -1;
  const candidates = list.filter((b) => {
    if (b.category !== need.category || b.currency.toUpperCase() !== need.currency.toUpperCase()) return false;
    if (need.unit && b.unit !== need.unit) return false;
    if (need.market && b.market.toUpperCase() !== need.market.toUpperCase()) return false;
    const exact = b.serviceKey === need.serviceKey;
    if (!exact && b.serviceKey !== "professional") return false;
    if (PERSONNEL_CATEGORIES.has(need.category) && want >= 0) {
      if (!b.seniority) return exact && need.serviceKey !== "professional";
      if (Math.abs(SENIORITY_ORDER.indexOf(b.seniority) - want) > 1) return false;
    }
    return true;
  });
  if (candidates.length === 0) return null;
  const score = (b: PricingBenchmark) =>
    (b.origin === "OWNER" ? 1_000 : 0)
    + (b.serviceKey === need.serviceKey ? 100 : 0)
    + (want < 0 || !b.seniority ? 0 : 50 - 15 * Math.abs(SENIORITY_ORDER.indexOf(b.seniority) - want))
    + new Date(b.effectiveDate).getTime() / 1e13;
  return [...candidates].sort((a, b) => score(b) - score(a))[0]!;
}

export type BenchmarkValidation = { ok: true; value: Omit<PricingBenchmark, "id" | "origin"> } | { ok: false; error: string };

const CATEGORIES: BenchmarkCategory[] = ["PERSONNEL_FEE", "PERSONNEL_SALARY", "PER_DIEM", "TRANSPORT", "WORKSHOP", "ENUMERATOR", "LABORATORY", "DRILLING", "SURVEY", "EQUIPMENT", "PRINTING", "SUBCONSULTANT", "PERCENT_OF_WORKS", "STATUTORY_RATE"];
const SOURCE_TYPES: BenchmarkSourceType[] = ["GOVERNMENT_PAY_SCALE", "GOVERNMENT_DIRECTIVE", "STATUTE", "PUBLISHED_STUDY", "PUBLISHED_FEE_SCALE", "MARKET_SURVEY", "OWNER_RATE_CARD"];
const UNITS = ["DAY", "MONTH", "EACH", "LUMP_SUM", "KM", "PERCENT"];

/**
 * Validate one imported benchmark. A rate without a source and a date is
 * refused: an untraceable figure is exactly what the registry exists to keep
 * out of a bid.
 */
export function validateBenchmark(raw: Record<string, unknown>): BenchmarkValidation {
  const str = (k: string, max = 300) => (typeof raw[k] === "string" ? (raw[k] as string).trim().slice(0, max) : "");
  const num = (k: string) => (raw[k] === undefined || raw[k] === null || raw[k] === "" ? NaN : Number(raw[k]));
  const category = str("category").toUpperCase() as BenchmarkCategory;
  if (!CATEGORIES.includes(category)) return { ok: false, error: `category must be one of ${CATEGORIES.join(", ")}` };
  const unit = str("unit").toUpperCase();
  if (!UNITS.includes(unit)) return { ok: false, error: `unit must be one of ${UNITS.join(", ")}` };
  const currency = str("currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "currency must be a 3-letter code" };
  const median = num("median");
  if (!Number.isFinite(median) || median <= 0) return { ok: false, error: "median must be a positive number" };
  const low = Number.isFinite(num("low")) ? num("low") : median;
  const high = Number.isFinite(num("high")) ? num("high") : median;
  if (!(low <= median && median <= high)) return { ok: false, error: "low ≤ median ≤ high is required" };
  const source = str("source", 500);
  if (source.length < 5) return { ok: false, error: "source is required — say where the rate comes from" };
  const effectiveDate = str("effectiveDate", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || Number.isNaN(new Date(effectiveDate).getTime())) return { ok: false, error: "effectiveDate must be YYYY-MM-DD" };
  const sourceType = (str("sourceType").toUpperCase() || "OWNER_RATE_CARD") as BenchmarkSourceType;
  if (!SOURCE_TYPES.includes(sourceType)) return { ok: false, error: `sourceType must be one of ${SOURCE_TYPES.join(", ")}` };
  const seniority = str("seniority").toUpperCase();
  const confidence = (str("confidence").toUpperCase() || (sourceType === "OWNER_RATE_CARD" ? "HIGH" : "MEDIUM")) as BenchmarkConfidence;
  if (!["HIGH", "MEDIUM", "LOW"].includes(confidence)) return { ok: false, error: "confidence must be HIGH, MEDIUM or LOW" };
  const serviceKey = (str("serviceKey", 80) || classifyRole(str("label"))).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  const label = str("label", 200);
  if (!label) return { ok: false, error: "label is required" };
  const sourceUrl = str("sourceUrl", 500);
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) return { ok: false, error: "sourceUrl must be an http(s) URL" };
  return {
    ok: true,
    value: {
      // A market is an ISO code or, for a country the runtime does not name,
      // the normalised country name (marketOf); long enough for either.
      market: (str("market", 40) || "ET").toUpperCase(),
      category, serviceKey, label,
      seniority: SENIORITY_ORDER.includes(seniority as BenchmarkSeniority) ? (seniority as BenchmarkSeniority) : null,
      unit, currency, low, median, high,
      rateBasis: str("rateBasis").toUpperCase() === "COST" ? "COST" : "FEE",
      effectiveDate, source, sourceUrl: sourceUrl || null, sourceType, confidence,
      notes: str("notes", 1000) || null,
      lastVerified: (/^\d{4}-\d{2}-\d{2}$/.test(str("lastVerified", 10)) ? str("lastVerified", 10) : new Date().toISOString().slice(0, 10)),
    },
  };
}
