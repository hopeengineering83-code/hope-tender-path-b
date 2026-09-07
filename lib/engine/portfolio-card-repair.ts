/**
 * The client never receives an evidence card with an empty cell in it.
 *
 * WHAT WENT WRONG
 * ---------------
 * Section B's project card is the most checkable evidence in a technical
 * proposal — an evaluator can hold it against the client's own records. Three
 * consecutive delivered PDFs carried this one:
 *
 *   G+6 General Hospital - Dr Abdul Seid
 *   Client             Gimba City, South Wollo Zone, Amhara Region,
 *   Location & Scale   Ethiopia — —
 *   Duration           2015-2018
 *   Services Provided  —
 *
 * while that record's own verified source text names the location, states
 * "(7,000 m2)", and lists eleven services by name. Two earlier fixes made the
 * facts available — to the deterministic card builder, and then to the writer's
 * own evidence lines — and the delivered card did not move either time, because
 * on this tender neither of those produced it: the model wrote the card from a
 * template, and filled the cells it could not immediately see with an em dash.
 *
 * WHY THIS IS A REPAIR PASS AND NOT A THIRD ATTEMPT AT THE SOURCE
 * --------------------------------------------------------------
 * The document is written by whichever of ten providers answers, or by the
 * deterministic fallback. Prompt wording cannot be a guarantee across that set,
 * and each attempt to guarantee it upstream costs a full generation cycle to
 * disprove. This pass reads the rendered card and repairs it against the same
 * verified record the card is about, so the outcome holds whoever wrote it.
 *
 * It never invents. A cell is filled only from the record's own words, through
 * the same extractors the deterministic builder uses; a cell that cannot be
 * filled from the record has its ROW REMOVED, because a row asserting "—" tells
 * the evaluator less than no row at all and reads as an unfinished document.
 * No record is mutated and no provenance hash is disturbed.
 */

import {
  extractProjectAmounts,
  extractProjectFacts,
  extractServicesProvided,
} from "./project-fact-extractor";

export interface PortfolioCardProject {
  readonly name: string;
  readonly summary?: string | null;
  readonly clientName?: string | null;
  readonly country?: string | null;
  readonly sector?: string | null;
  readonly serviceAreas?: string | null;
  readonly contractValue?: number | string | null;
  readonly currency?: string | null;
}

/** A cell that asserts nothing: an em dash, "n/a", an unfilled template slot. */
const EMPTY_CELL =
  /^(?:[-–—\s.]*|n\/?a|none|tbd|tba|unknown|not\s+(?:stated|specified|available)|scale\s+on\s+file|dates\s+on\s+file|value\s+on\s+file|client\s+on\s+file|\[[^\]]*\])$/i;

/**
 * Measurable scale, in whatever unit the sector states it: floor area for
 * buildings, length for roads and pipelines, flow for water, area for planning,
 * capacity for facilities. Only units the source itself uses.
 */
// The trailing boundary is (?![a-z0-9]) rather than \b on purpose: a unit
// ending in a superscript ("7,000 m²") has no word character to bound, so \b
// never fires there and the scale silently went missing on every record that
// states its area that way — 108 of the owner's 114.
const SCALE_UNITS =
  /(\d[\d,.]*)\s*(m²|m2|sq\.?\s?m(?:etres?|eters?)?|km²|km2|km|ha|hectares?|l\/s|litres?\/s|liters?\/s|m³\/day|m3\/day|beds?|boreholes?|classrooms?|units?|households?)(?![a-z0-9])/i;

function tidy(value: string): string {
  return value.replace(/\s{2,}/g, " ").trim();
}

function isEmptyCell(value: string): boolean {
  return EMPTY_CELL.test(value.trim());
}

/**
 * A cell may be HALF empty. The delivered card read "Ethiopia — —": the
 * writer filled the template's [location] slot and left the [scale] slot as a
 * dash, so the cell as a whole is not empty and a whole-cell test walks past
 * the defect that is actually visible to the evaluator.
 *
 * Returns the parts that assert something, in order.
 */
function assertingParts(value: string): string[] {
  return value
    .split(/\s+[—–-]\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !isEmptyCell(part));
}

/** Everything the record itself says, ready to fill a cell with. */
interface RecordFacts {
  location?: string;
  scale?: string;
  duration?: string;
  services?: string;
  consultancyFee?: string;
  constructionValue?: string;
  contractValue?: string;
}

function formatMoney(value: number, currency?: string | null): string {
  const code = (currency ?? "").trim();
  const abs = Math.abs(value);
  const scaled = abs >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M` : abs >= 1_000 ? `${(value / 1_000).toFixed(0)}K` : `${value}`;
  return tidy(`${code} ${scaled}`);
}

function formatYearRange(start?: Date, end?: Date): string | undefined {
  if (!start && !end) return undefined;
  const a = start ? String(start.getUTCFullYear()) : undefined;
  const b = end ? String(end.getUTCFullYear()) : undefined;
  if (a && b) return a === b ? a : `${a}–${b}`;
  return a ?? b;
}

function parseJsonList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function recordFactsFor(project: PortfolioCardProject): RecordFacts {
  const summary = project.summary ?? "";
  const derived = extractProjectFacts(summary, project.name);
  const amounts = extractProjectAmounts(summary);

  const scaleMatch = SCALE_UNITS.exec(summary);
  const stored = parseJsonList(project.serviceAreas);
  const services = stored.length > 0 ? stored : extractServicesProvided(summary);

  const fee = amounts.find((amount) => amount.role === "CONSULTANCY_FEE" && !amount.perMonth);
  const works = amounts.find((amount) => amount.role === "CONSTRUCTION" && !amount.perMonth);
  const storedValue = typeof project.contractValue === "number"
    ? project.contractValue
    : project.contractValue != null && String(project.contractValue).trim().length > 0
      ? Number(project.contractValue)
      : undefined;

  return {
    location: tidy(project.country || derived.country || derived.location || "") || undefined,
    scale: scaleMatch ? tidy(scaleMatch[0]) : undefined,
    duration: formatYearRange(derived.startDate, derived.endDate),
    services: services.length > 0 ? services.join(", ") : undefined,
    // The three amounts are never merged. The consultancy fee is this firm's
    // contract; the construction cost is the scale of the asset it worked on
    // and says so; a monthly supervision rate is a price signal, not a
    // track-record fact, and is not printed at all.
    consultancyFee: fee ? formatMoney(fee.value, fee.currency ?? project.currency) : undefined,
    constructionValue: works ? formatMoney(works.value, works.currency ?? project.currency) : undefined,
    contractValue: storedValue && Number.isFinite(storedValue) && storedValue > 0
      ? formatMoney(storedValue, project.currency)
      : undefined,
  };
}

/** What each recognised card label may be filled from. */
function fillFor(label: string, facts: RecordFacts): string | undefined {
  const key = label.toLowerCase().replace(/[^a-z]/g, "");
  if (key === "locationscale" || key === "locationandscale") {
    const parts = [facts.location, facts.scale].filter(Boolean);
    return parts.length > 0 ? parts.join(" — ") : undefined;
  }
  if (key === "location" || key === "locationcountry" || key === "country") return facts.location;
  if (key === "scale" || key === "size") return facts.scale;
  if (key === "duration" || key === "period" || key === "timeline") return facts.duration;
  if (key === "servicesprovided" || key === "services" || key === "scope") return facts.services;
  if (key === "contractvalue" || key === "value") return facts.contractValue;
  if (key === "consultancyfee" || key === "fee") return facts.consultancyFee;
  if (key === "constructionvalueofworks" || key === "constructionvalue") return facts.constructionValue;
  return undefined;
}

/**
 * A place is not a client.
 *
 * The delivered card asserted "Client: Gimba City, South Wollo Zone, Amhara
 * Region," — the record's clientName column holds a bare address, because that
 * is what the import placed there. Stating a location as the client is a
 * factual error in a document an evaluator may check against the client's own
 * records, and the card has a Location row for exactly this content.
 *
 * The test is deliberately narrow: EVERY comma-separated segment must be a
 * bare geographic qualifier and NONE may carry an organisational or personal
 * noun. "Gimba City Administration", "Haik town administration", "Tenta City
 * Admin" and "Dr Abdul Seid" are all real clients and all pass through
 * untouched; only a pure address chain is rejected.
 */
const GEOGRAPHIC_QUALIFIER = /\b(?:city|town|zone|region|woreda|kebele|sub[-\s]?city|state|province|district|county|municipality|village|area)\b/i;
const ORGANISATION_OR_PERSON = /\b(?:admin(?:istration)?|authority|ministry|bureau|agency|office|trust|council|commission|department|university|college|school|hospital|clinic|bank|company|corporation|enterprise|institute|association|foundation|group|plc|ltd|limited|inc|llc|s\.?c\.?|share|project|programme|program|dr|mr|mrs|ms|eng|prof|engineer|architect)\b/i;

export function isLocationNotAClient(value: string): boolean {
  const trimmed = value.replace(/[,\s]+$/, "").trim();
  if (trimmed.length === 0) return false;
  if (ORGANISATION_OR_PERSON.test(trimmed)) return false;
  const segments = trimmed.split(",").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length < 2) return false;
  return segments.every((segment) => GEOGRAPHIC_QUALIFIER.test(segment));
}

const TABLE_ROW = /^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/;

function matchProject(heading: string, projects: readonly PortfolioCardProject[]): PortfolioCardProject | undefined {
  const cleaned = heading.replace(/^#{1,6}\s*/, "").replace(/[*_]/g, "").trim().toLowerCase();
  if (cleaned.length === 0) return undefined;
  let best: PortfolioCardProject | undefined;
  let bestLength = 0;
  for (const project of projects) {
    const name = project.name.trim().toLowerCase();
    if (name.length < 6) continue;
    if (cleaned.includes(name) || name.includes(cleaned)) {
      if (name.length > bestLength) {
        best = project;
        bestLength = name.length;
      }
    }
  }
  return best;
}

export interface PortfolioCardRepairResult {
  readonly markdown: string;
  /** "Location & Scale" style labels whose cell was filled from the record. */
  readonly filled: readonly string[];
  /** Labels whose row was removed because the record does not state them. */
  readonly removed: readonly string[];
}

/**
 * Repair every project card in the proposal markdown against the record it is
 * about. Cards are found by their nearest preceding heading; a heading that
 * matches no supplied record is left completely untouched, so this pass can
 * never rewrite a table it has not identified.
 */
export function repairPortfolioCards(
  markdown: string,
  projects: readonly PortfolioCardProject[],
): PortfolioCardRepairResult {
  if (projects.length === 0) return { markdown, filled: [], removed: [] };

  const lines = markdown.split("\n");
  const out: string[] = [];
  const filled: string[] = [];
  const removed: string[] = [];

  let current: PortfolioCardProject | undefined;
  let facts: RecordFacts = {};

  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      current = matchProject(line, projects);
      facts = current ? recordFactsFor(current) : {};
      out.push(line);
      continue;
    }

    const row = TABLE_ROW.exec(line);
    if (!current || !row) {
      out.push(line);
      continue;
    }

    const label = row[1];
    const value = row[2];
    // Never touch the header or the separator: they carry no assertion.
    if (/^-{2,}$/.test(label.replace(/[:\s]/g, "")) || /^\s*Field\s*$/i.test(label)) {
      out.push(line);
      continue;
    }
    const labelKey = label.toLowerCase().replace(/[^a-z]/g, "");
    if (labelKey === "client" && isLocationNotAClient(value)) {
      // The row is removed rather than rewritten: the record does not state a
      // client, and the place it does state belongs in the location row.
      removed.push(label.trim());
      // The place itself is not discarded — it is the most specific location
      // the record states, and the card has a row for it.
      const place = value.replace(/[,\s]+$/, "").trim();
      const known = facts.location ?? "";
      if (!known.toLowerCase().includes(place.toLowerCase())) {
        facts = { ...facts, location: known.length > 0 ? `${place}, ${known}` : place };
      }
      continue;
    }

    const kept = assertingParts(value);
    const replacement = fillFor(label, facts);

    if (kept.length > 0) {
      const tidied = kept.join(" — ");
      if (tidied === value.trim()) {
        // The cell is complete as written. Never overwrite it.
        out.push(line);
        continue;
      }
      // Half empty. If the record can complete it WITHOUT contradicting what
      // the writer already put there, complete it; otherwise just drop the
      // part that says nothing.
      const completes = replacement !== undefined
        && kept.every((part) => replacement.toLowerCase().includes(part.toLowerCase()));
      filled.push(label.trim());
      out.push(`| ${label} | ${completes ? replacement : tidied} |`);
      continue;
    }

    if (replacement) {
      filled.push(label.trim());
      out.push(`| ${label} | ${replacement} |`);
      continue;
    }

    // A consultancy fee is not a "Contract Value" without saying so. The
    // records behind these cards state up to three amounts — a construction
    // cost, a design fee and a monthly supervision rate — and printing the
    // wrong one under a bare value label misstates the firm's contract. When
    // the only amount available is the fee, the ROW IS RELABELLED rather than
    // silently filled.
    const valueKey = label.toLowerCase().replace(/[^a-z]/g, "");
    if ((valueKey === "contractvalue" || valueKey === "value") && facts.consultancyFee) {
      filled.push("Consultancy Fee");
      out.push(`| Consultancy Fee | ${facts.consultancyFee} |`);
      if (facts.constructionValue) {
        filled.push("Construction Value of Works");
        out.push(`| Construction Value of Works | ${facts.constructionValue} |`);
      }
      continue;
    }

    // Drop the row entirely. A cell that asserts nothing is worse than
    // absent: it reads as a fact the bidder could not produce.
    removed.push(label.trim());
  }

  return { markdown: out.join("\n"), filled, removed };
}
