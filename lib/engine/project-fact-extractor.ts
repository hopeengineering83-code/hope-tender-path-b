// Project fact extractor (closes Section B portfolio-card gaps)
//
// THE PROBLEM
// ───────────
// Project Prisma columns: clientName, country, sector, contractValue,
// currency, startDate, endDate. The May-7 benchmark diff showed that
// each Section B project card emitted empty cells:
//   • Location & Scale: "Scale on file"
//   • Duration:         "Dates on file"
//   • Contract Value:   "Value detail in Appendix B (project reference)"
// even though every value sat verbatim in project.summary
// ("Construction Cost: 35,000,000.00 ETB"; "1,000 m²"; "2014-2015 E.C.").
//
// THE FIX
// ───────
// Pure-regex extractor, same shape as company-fact-extractor. No AI
// call, no network. Detects:
//   • clientName    ← "client: …", "for …" entity-suffix line
//   • country       ← detected city/region keywords (Ethiopia common)
//   • contractValue ← "ETB 525,800,000", "USD 3.5M", "GBP 390,717"
//   • currency      ← currency token alongside the value
//   • startDate / endDate ← "2014-2015", "2023 to 2025", "Dec 2017 to Present"
//   • location      ← "Kombolcha, Kebele 03, Amhara Region, Ethiopia (1,400 m²)"
//
// Idempotent: only suggests fields that aren't already populated.
// Caller merges with `chooseIncomingOrExisting` semantics.

export interface ProjectFactExtraction {
  clientName?: string;
  country?: string;
  contractValue?: number;
  currency?: string;
  startDate?: Date;
  endDate?: Date;
  location?: string;
  sector?: string;
}

const CURRENCY_TOKENS: Array<{ token: string; code: string }> = [
  { token: "ETB", code: "ETB" },
  { token: "Birr", code: "ETB" },
  { token: "GBP", code: "GBP" },
  { token: "£", code: "GBP" },
  { token: "USD", code: "USD" },
  { token: "$", code: "USD" },
  { token: "EUR", code: "EUR" },
  { token: "€", code: "EUR" },
  { token: "KES", code: "KES" },
  { token: "ZAR", code: "ZAR" },
];

// Currency-then-number OR number-then-currency.
// Examples: "ETB 525,800,000" / "525,800,000 ETB" / "USD 3.5M" / "3.5M USD".
//
// Important: we require a NUMBER ≥ 1000 (or with M/B suffix) so cheap
// matches like "ETB / month" → "2" (next sentence's enumerator) don't
// win. We also use [^\S\n] (whitespace-but-not-newline) between the
// currency and the number to keep the pair on the same line.
function parseValueAndCurrency(text: string): { value?: number; currency?: string } {
  // Try every match across the whole string and keep the largest value.
  // This is more robust than picking the first match (which may be a
  // short trailing reference like "50,000 ETB/month").
  let best: { value: number; currency: string } | undefined;

  const before = /\b(ETB|Birr|GBP|USD|EUR|KES|ZAR|\$|£|€)[^\S\n]{0,3}([\d]{1,3}(?:[,.]?\d{3})*(?:\.\d+)?)\s*(M|B|million|billion)?\b/gi;
  const after = /\b([\d]{1,3}(?:[,.]?\d{3})*(?:\.\d+)?)\s*(M|B|million|billion)?[^\S\n]{0,3}(ETB|Birr|GBP|USD|EUR|KES|ZAR)\b/gi;

  const consider = (numRaw: string, suffixRaw: string | undefined, tokenRaw: string) => {
    let value = Number(numRaw.replace(/,/g, ""));
    if (!Number.isFinite(value)) return;
    const sfx = (suffixRaw ?? "").toLowerCase();
    if (sfx === "m" || sfx === "million") value *= 1_000_000;
    if (sfx === "b" || sfx === "billion") value *= 1_000_000_000;
    // Reject implausibly small values that aren't M/B-suffixed (likely
    // a stray enumerator or page number).
    if (!sfx && value < 1000) return;
    const code = CURRENCY_TOKENS.find((c) => c.token.toLowerCase() === tokenRaw.toLowerCase())?.code ?? tokenRaw.toUpperCase();
    if (!best || value > best.value) best = { value, currency: code };
  };

  for (const m of text.matchAll(before)) consider(m[2], m[3], m[1]);
  for (const m of text.matchAll(after)) consider(m[1], m[2], m[3]);

  return best ?? {};
}

// Country: list of common targets. Surfacing nothing is preferred to a
// bad guess.
const COUNTRY_TOKENS = [
  "Ethiopia", "Kenya", "Tanzania", "Uganda", "Rwanda", "Burundi",
  "South Sudan", "Sudan", "Djibouti", "Eritrea", "Somalia",
  "Nigeria", "Ghana", "South Africa", "Egypt", "Morocco", "Algeria",
  "Senegal", "Cameroon", "Zambia", "Zimbabwe", "Mozambique",
  "DRC", "Democratic Republic of Congo", "Congo",
  "United Kingdom", "USA", "United States",
];

const CLIENT_LINE_PATTERNS = [
  /\bclient\s*[:\-]?\s*([A-Z][A-Za-z0-9.,'’()\-/& ]{2,90})/i,
  /\bfor\s+([A-Z][A-Za-z0-9.,'’()\-/& ]{4,90}?(?:\s+(?:Foundation|Ventures|Trust|Authority|Bureau|Ministry|Agency|Council|PLC|Ltd|Limited|Hospital|Bank|University|Institute|Trade|Enterprise|City|Region|Government)))/,
];

// Date-range patterns. Output Date objects clamped to mid-year if only
// a year was given.
function parseDateRange(text: string): { startDate?: Date; endDate?: Date } {
  // "2014 to 2015", "2023 - 2025", "2014-2015 E.C.", "2017–2020"
  const yrRange = text.match(/\b(\d{4})\s*[-–to]+\s*(?:Present|now|(\d{4}))\b/i);
  if (yrRange) {
    const startYear = Number(yrRange[1]);
    const endYearRaw = yrRange[2];
    if (Number.isFinite(startYear) && startYear >= 1900 && startYear <= 2100) {
      const start = new Date(startYear, 5, 30); // mid-year placeholder
      let end: Date | undefined = undefined;
      if (endYearRaw) {
        const endYear = Number(endYearRaw);
        if (Number.isFinite(endYear) && endYear >= startYear && endYear <= 2100) {
          end = new Date(endYear, 5, 30);
        }
      }
      return { startDate: start, endDate: end };
    }
  }
  // "Dec 2017 to Present" / "Sept 2018 to July 2019" — too lossy for
  // a Date, skip and let the user fill in.
  return {};
}

const SECTOR_KEYWORDS: Array<{ rx: RegExp; sector: string }> = [
  { rx: /hospital|medical center|clinic|healthcare/i, sector: "Healthcare" },
  // Word boundary on WASH — bare /WASH/i matched "Washington",
  // misclassifying projects in Washington DC / Washington state as
  // Water & Sanitation.
  { rx: /water supply|borehole|\bWASH\b|sanitation|hydraulic/i, sector: "Water & Sanitation" },
  { rx: /road|bridge|highway|pavement/i, sector: "Roads & Bridges" },
  { rx: /school|university|campus|education/i, sector: "Education" },
  { rx: /housing|residential|apartment/i, sector: "Residential" },
  { rx: /commercial|office|tower|trade center/i, sector: "Commercial" },
  { rx: /hotel|hospitality|resort/i, sector: "Hospitality" },
  { rx: /factory|industrial|manufacturing|warehouse/i, sector: "Industrial" },
  { rx: /master plan|urban|city planning/i, sector: "Urban Planning" },
];

export function extractProjectFacts(summary: string, name?: string): ProjectFactExtraction {
  const text = `${name ?? ""}\n${summary || ""}`;
  if (!text.trim()) return {};

  const out: ProjectFactExtraction = {};

  // Contract value + currency
  const cv = parseValueAndCurrency(text);
  if (cv.value) out.contractValue = cv.value;
  if (cv.currency) out.currency = cv.currency;

  // Country
  for (const token of COUNTRY_TOKENS) {
    if (new RegExp(`\\b${token.replace(/ /g, "\\s+")}\\b`, "i").test(text)) {
      out.country = token === "DRC" || token === "Democratic Republic of Congo" ? "DRC" : token;
      break;
    }
  }

  // Client name (entity-suffix bias)
  for (const p of CLIENT_LINE_PATTERNS) {
    const m = text.match(p);
    if (m) {
      const cand = m[1].replace(/\s+/g, " ").trim();
      if (cand.length >= 4 && cand.length <= 90) {
        out.clientName = cand.replace(/[.,;:\-–—\s]+$/, "");
        break;
      }
    }
  }

  // Date range
  const { startDate, endDate } = parseDateRange(text);
  if (startDate) out.startDate = startDate;
  if (endDate) out.endDate = endDate;

  // Sector
  for (const { rx, sector } of SECTOR_KEYWORDS) {
    if (rx.test(text)) { out.sector = sector; break; }
  }

  // Location: short freeform string captured from "in <Place>", "at <Place>", or
  // a bracketed location with parentheses around an area number.
  const locM = text.match(/\b(?:in|at|located\s+in|location\s*[:\-]?)\s+([A-Z][A-Za-z0-9,'\-/() ]{6,140})/);
  if (locM) {
    let loc = locM[1].replace(/\s+/g, " ").trim();
    // Strip trailing common boilerplate.
    loc = loc.replace(/\b(?:Ref(?:erence)?\s+(?:No\.?|#).*)$/i, "").trim();
    if (loc.length >= 6 && loc.length <= 200) out.location = loc;
  }

  return out;
}

/**
 * Merge extracted project facts with the existing Project row. Fills empty
 * columns only — never overwrites a value the user entered manually.
 *
 * NOTE: `location` is NOT in this output because the Project schema has
 * no `location` column (it only has `country`). The extractor still
 * returns location for in-memory use (UI evidence snippet rendering)
 * but the merge function deliberately excludes it from the DB payload.
 */
export function mergeProjectFacts(
  existing: Partial<Record<keyof ProjectFactExtraction, unknown>>,
  extracted: ProjectFactExtraction,
): Partial<Pick<ProjectFactExtraction, "clientName" | "country" | "contractValue" | "currency" | "startDate" | "endDate" | "sector">> {
  const out: Partial<ProjectFactExtraction> = {};
  const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

  for (const k of ["clientName", "country", "contractValue", "currency", "startDate", "endDate", "sector"] as const) {
    if (isEmpty(existing[k]) && extracted[k] !== undefined) {
      // @ts-expect-error generic narrowing
      out[k] = extracted[k];
    }
  }
  return out;
}
