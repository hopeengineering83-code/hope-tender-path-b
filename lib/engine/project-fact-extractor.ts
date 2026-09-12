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
//   • country       ← one generic country reference, and only when the
//                     text names exactly one country (lib/engine/country-reference)
//   • contractValue ← "ETB 525,800,000", "USD 3.5M", "GBP 390,717"
//   • currency      ← currency token alongside the value
//   • startDate / endDate ← "2014-2015", "2023 to 2025", "Dec 2017 to Present"
//   • location      ← "Kombolcha, Kebele 03, Amhara Region, Ethiopia (1,400 m²)"
//
// Idempotent: only suggests fields that aren't already populated.
// Caller merges with `chooseIncomingOrExisting` semantics.

import { findCountriesInText } from "./country-reference";
import { CURRENCY_TOKEN_ALTERNATION, resolveCurrencyToken } from "./currency-reference";

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

  // Currency knowledge comes from the one generic reference rather than the
  // six-currency list this used to carry, which read an amount in NGN, RWF,
  // VND, PEN or JOD as no amount at all. The alternation is case-SENSITIVE by
  // construction (see currency-reference), so these patterns must not take the
  // `i` flag; the magnitude suffix carries its own casing instead.
  const NUMBER = "([\\d]{1,3}(?:[,.]?\\d{3})*(?:\\.\\d+)?)";
  const MAGNITUDE = "([MmBb]|[Mm]illion|[Bb]illion)?";
  const before = new RegExp(
    `(?<![A-Za-z0-9])(${CURRENCY_TOKEN_ALTERNATION})[^\\S\\n]{0,3}${NUMBER}\\s*${MAGNITUDE}`,
    "g",
  );
  const after = new RegExp(
    `(?<![A-Za-z0-9])${NUMBER}\\s*${MAGNITUDE}[^\\S\\n]{0,3}(${CURRENCY_TOKEN_ALTERNATION})(?![A-Za-z])`,
    "g",
  );

  const consider = (numRaw: string, suffixRaw: string | undefined, tokenRaw: string) => {
    let value = Number(numRaw.replace(/,/g, ""));
    if (!Number.isFinite(value)) return;
    const sfx = (suffixRaw ?? "").toLowerCase();
    if (sfx === "m" || sfx === "million") value *= 1_000_000;
    if (sfx === "b" || sfx === "billion") value *= 1_000_000_000;
    // Reject implausibly small values that aren't M/B-suffixed (likely
    // a stray enumerator or page number).
    if (!sfx && value < 1000) return;
    const code = resolveCurrencyToken(tokenRaw);
    if (!code) return;
    if (!best || value > best.value) best = { value, currency: code };
  };

  for (const m of text.matchAll(before)) consider(m[2], m[3], m[1]);
  for (const m of text.matchAll(after)) consider(m[1], m[2], m[3]);

  return best ?? {};
}

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
  { rx: /energy|power plant|\bsolar\b|wind farm|substation|hydropower|electrification|grid.*connect/i, sector: "Energy & Power" },
  { rx: /irrigation|\bWUA\b|command area|FAO.*Penman|crop water|agri/i, sector: "Agriculture & Irrigation" },
  { rx: /mining|\bJORC\b|tailings|ore body|mine plan|mineral resource/i, sector: "Mining & Extractive" },
  { rx: /\bport\b|berth|quay|maritime|dredging|harbour|nautical/i, sector: "Port & Maritime" },
  { rx: /\bHAZOP\b|\bP&ID\b|pipeline design|oil facilit|gas facilit|petrochemical|upstream petroleum/i, sector: "Oil & Gas" },
  { rx: /\bKYC\b|\bAML\b|core banking|microfinance|\bIFRS\b|\bBasel\b|fintech|payment system/i, sector: "Financial Services" },
  { rx: /spectrum|broadband|\bLTE\b|\b5G\b|base station|backhaul|mobile network/i, sector: "Telecoms & Broadband" },
  { rx: /interior design|fit[-\s]?out|space planning|joinery|ceiling.*design|flooring.*spec|finishes.*schedule|furniture.*layout|partition.*design/i, sector: "Architecture & Design" },
  { rx: /construction supervision|resident engineer|site supervision|quality.*inspector|hold[- ]?point|defect.*liability|site.*inspector/i, sector: "Supervision" },
  { rx: /contract administration|variation order|interim payment|payment certificate|\bFIDIC\b|claims management|cost control.*contract|quantity survey/i, sector: "Contract Administration" },
];



/**
 * The professional services a project's own source text says were performed.
 *
 * The delivered portfolio card rendered "Services Provided —" because the
 * structured serviceAreas column is empty on all 114 records of the owner's
 * vault, and the fallback took the summary's FIRST SENTENCE — which for these
 * records is the project name and reference number, not a service list.
 *
 * The services are stated plainly in the same text:
 *
 *   "Feasibility study, Soil investigation, Laboratory testing, New
 *    Architectural design, New Structural design, Complete MEP Design
 *    (Electrical, Sanitary, Mechanical), Material specification, Bill of
 *    Quantity preparation, Tender document preparation, Construction
 *    supervision"
 *
 * Each term below is matched against the record's own words and returned only
 * when it is literally present, so nothing is inferred and nothing is invented.
 * The vocabulary spans every sector the app serves — a road record yields
 * pavement and drainage design, a water record yields hydraulic design and
 * yield testing — so no sector is privileged by it.
 */
const SERVICE_VOCABULARY: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bfeasibility\s+stud(?:y|ies)\b/i, "Feasibility study"],
  [/\bpre[-\s]?feasibility\b/i, "Pre-feasibility study"],
  [/\b(?:soil|geotechnical|subsoil|ground)\s+investigation\b/i, "Geotechnical investigation"],
  [/\blaboratory\s+testing\b/i, "Laboratory testing"],
  [/\btopographic(?:al)?\s+survey\b/i, "Topographic survey"],
  [/\bhydrolog(?:y|ical)\b/i, "Hydrological study"],
  [/\byield\s+test(?:ing)?\b/i, "Yield testing"],
  [/\barchitectural\s+design\b/i, "Architectural design"],
  [/\bstructural\s+design\b/i, "Structural design"],
  [/\bstructural\s+assessment\b/i, "Structural assessment"],
  [/\bmodification\s+design\b/i, "Modification design"],
  [/\brenovation\b/i, "Renovation design"],
  [/\bmep\s+design\b|\bmechanical[,\s]+electrical\b/i, "MEP design"],
  [/\belectrical\s+design\b/i, "Electrical design"],
  [/\bsanitary\s+design\b|\bplumbing\s+design\b/i, "Sanitary design"],
  [/\bhydraulic\s+design\b|\breticulation\b/i, "Hydraulic design"],
  [/\bpavement\s+design\b/i, "Pavement design"],
  [/\bdrainage\s+design\b/i, "Drainage design"],
  [/\bmaster\s*plan(?:ning)?\b/i, "Master planning"],
  [/\burban\s+design\b/i, "Urban design"],
  [/\benvironmental\s+(?:and\s+social\s+)?(?:impact\s+)?(?:assessment|stud(?:y|ies))\b/i, "Environmental and social assessment"],
  [/\bmaterial\s+specification\b/i, "Material specification"],
  [/\bquantity\s+(?:schedule|surveying)\b|\bbill\s+of\s+quantit(?:y|ies)\b|\bboq\b/i, "Quantity schedules"],
  [/\btender\s+document(?:ation|\s+preparation)?\b/i, "Tender documentation"],
  [/\bcontract\s+administration\b/i, "Contract administration"],
  [/\b(?:construction|site)\s+supervision\b/i, "Construction supervision"],
  [/\bresident\s+engineer(?:ing)?\b/i, "Resident engineering"],
  [/\bas[-\s]?built\b/i, "As-built documentation"],
  [/\bcommissioning\b/i, "Commissioning"],
  [/\bcondition\s+survey\b/i, "Condition survey"],
  [/\bcapacity\s+building\b|\btraining\b/i, "Capacity building"],
];

/** Services literally named in the record's own source text, in vocabulary order. */
export function extractServicesProvided(summary: string): string[] {
  const text = (summary || "").replace(/\s+/g, " ");
  if (!text.trim()) return [];
  const found: string[] = [];
  for (const [rx, label] of SERVICE_VOCABULARY) {
    if (rx.test(text) && !found.includes(label)) found.push(label);
  }
  return found;
}

/**
 * Amounts a project's source text states, each kept with the ROLE its own
 * label gives it.
 *
 * WHY THE ROLE MATTERS MORE THAN THE NUMBER
 * -----------------------------------------
 * A real record reads:
 *
 *   1. Construction Cost: 550,074,678.02 ETB
 *   2. Feasibility Study, Geotechnical & New Design Cost: 1,100,000 ETB
 *   3. Contract Administration & Construction Supervision Cost: 110,000 ETB/month
 *
 * Three amounts, three different things. The first is what the BUILDING cost;
 * the second is what the CONSULTANCY was paid; the third is a monthly rate.
 * parseValueAndCurrency keeps the largest, which is the construction cost —
 * so presenting it under "Contract Value" on a consultancy proposal would
 * overstate the firm's contract by roughly five hundred times, in a document an
 * evaluator may check against the client's own records.
 *
 * Each amount is therefore returned with its role, and the caller decides what
 * a given row is entitled to say.
 */
export type ProjectAmountRole = "CONSTRUCTION" | "CONSULTANCY_FEE" | "SUPERVISION_RATE" | "UNLABELLED";

export interface ProjectAmount {
  readonly role: ProjectAmountRole;
  readonly value: number;
  readonly currency?: string;
  /** True when the source states the amount per month rather than in total. */
  readonly perMonth: boolean;
  /** The source's own label, trimmed — so a card can quote it rather than invent one. */
  readonly label: string;
}

const AMOUNT_LABEL_ROLES: ReadonlyArray<{ readonly rx: RegExp; readonly role: ProjectAmountRole }> = [
  { rx: /\bsupervision\b|\bcontract\s+administration\b|\bresident\s+engineer\b/i, role: "SUPERVISION_RATE" },
  { rx: /\bdesign\b|\bfeasibility\b|\bconsultanc(?:y|ies)\b|\bstudy\b|\bgeotechnical\b|\bmodification\b/i, role: "CONSULTANCY_FEE" },
  { rx: /\bconstruction\b|\bworks?\b|\bproject\s+cost\b|\bcontract\s+(?:sum|amount)\b/i, role: "CONSTRUCTION" },
];

/**
 * Scan for "<label> Cost: <amount> <CUR>" shapes and classify each by its own
 * label. Deliberately conservative: an amount whose label says nothing useful
 * is UNLABELLED, and an UNLABELLED amount is never promoted to a fee.
 */
export function extractProjectAmounts(summary: string): ProjectAmount[] {
  const text = (summary || "").replace(/\s+/g, " ");
  if (!text.trim()) return [];
  const out: ProjectAmount[] = [];

  // "<label words> Cost: 550,074,678.02 ETB" or "... 110,000 ETB/month"
  const rx = new RegExp(
    `([A-Za-z&,'()\\/ .-]{0,90}?)\\b(?:[Cc]ost|[Ff]ee|[Vv]alue|[Pp]rice|[Ss]um)\\b\\s*[:\\-]?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(${CURRENCY_TOKEN_ALTERNATION})?\\s*(\\/\\s*month|per\\s+month)?`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    const raw = Number((m[2] || "").replace(/,/g, ""));
    if (!Number.isFinite(raw) || raw < 1000) continue;
    const label = (m[1] || "").replace(/^[\s.,;:\-\d]+/, "").replace(/\s+/g, " ").trim();
    const perMonth = Boolean(m[4]);
    let role: ProjectAmountRole = "UNLABELLED";
    for (const entry of AMOUNT_LABEL_ROLES) {
      if (entry.rx.test(label)) { role = entry.role; break; }
    }
    // A per-month amount is a rate however it is labelled.
    if (perMonth) role = "SUPERVISION_RATE";
    const currencyToken = (m[3] || "").trim();
    const currency = resolveCurrencyToken(currencyToken) ?? undefined;
    out.push({ role, value: raw, currency, perMonth, label: label || "Stated amount" });
  }
  return out;
}

export function extractProjectFacts(summary: string, name?: string): ProjectFactExtraction {
  const text = `${name ?? ""}\n${summary || ""}`;
  if (!text.trim()) return {};

  const out: ProjectFactExtraction = {};

  // Contract value + currency
  const cv = parseValueAndCurrency(text);
  if (cv.value) out.contractValue = cv.value;
  if (cv.currency) out.currency = cv.currency;

  // Country. This used to walk a hand-written list of two dozen mostly East
  // African names and take the FIRST one the list happened to contain, so
  // list order decided the answer and a project in Nigeria whose text also
  // mentioned an Ethiopian head office came out as Ethiopia. Country
  // knowledge now lives in one generic reference module, and a text naming
  // more than one country yields no country at all rather than the
  // alphabetically luckiest one.
  const countriesInText = findCountriesInText(text);
  if (countriesInText.length === 1) out.country = countriesInText[0];

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
