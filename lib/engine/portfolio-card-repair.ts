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

/**
 * The most specific place the record can support, composed rather than chosen.
 *
 * This used to read `project.country` first and print it as the LOCATION. While
 * that column held a composite, the card got city-level detail by accident and
 * an Ethiopian bid got "Abuja, Federal Capital Territory, Nigeria" by the same
 * accident. The column now holds a plain country, so printing it alone would
 * trade one wrong answer for a thin one: the detail belongs to the record's
 * source text, and the card's job is to put the two together.
 *
 * "Kigali" + "Rwanda" -> "Kigali, Rwanda". A detail that already names the
 * country is not made to name it twice. Either half alone is used alone.
 */
function composeLocation(detail?: string | null, country?: string | null): string | undefined {
  const place = tidy(detail ?? "");
  const nation = tidy(country ?? "");
  if (!place) return nation || undefined;
  if (!nation) return place;
  const alreadyNamed = new RegExp(`(?:^|[,\\s])${nation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[,\\s])`, "i").test(place);
  return alreadyNamed ? place : `${place}, ${nation}`;
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

  // The stored contractValue is an INDEX, not a claim about what this firm was
  // paid. The portfolio enrichment fills it from the record's own text, and on
  // this portfolio that text overwhelmingly states a CONSTRUCTION cost — so the
  // column holds the cost of the asset, not the consultancy contract.
  //
  // Printing it under "Contract Value" therefore overstates the firm's contract
  // by orders of magnitude, and the first run that carried these rows did
  // exactly that, in the delivered PDF, twice per card:
  //
  //   Contract Value               ETB 550.1M
  //   Construction Value of Works  ETB 550.1M
  //
  // Same amount, two labels, one of them false — in front of an evaluator who
  // can check it against the client's own records. When the stored value IS the
  // construction amount the source states, it is presented only under the role
  // the source gives it. Nothing is hidden: the figure still appears, labelled
  // truthfully.
  const storedIsTheConstructionAmount =
    works !== undefined
    && storedValue !== undefined
    && Number.isFinite(storedValue)
    && Math.abs(works.value - storedValue) < 0.01;

  const storedIsTheConsultancyFee =
    fee !== undefined
    && storedValue !== undefined
    && Number.isFinite(storedValue)
    && Math.abs(fee.value - storedValue) < 0.01;

  return {
    location: composeLocation(derived.location, project.country || derived.country),
    // tidy() collapses runs of whitespace but not the newlines the source text
    // wraps on: "5\nkm" reached an Executive Summary sentence as a line break
    // mid-phrase.
    scale: scaleMatch ? tidy(scaleMatch[0].replace(/\s+/g, " ")) : undefined,
    duration: formatYearRange(derived.startDate, derived.endDate),
    services: services.length > 0 ? services.join(", ") : undefined,
    // A PAST FEE IS STILL THIS FIRM'S PRICING.
    //
    // The comment here used to say the monthly supervision rate was withheld
    // because "it reads as a price signal in a technical-only envelope" while
    // the lump-sum fee was printed. Nothing but the per-month flag separated
    // them, and that distinction has no basis in the principle: both state
    // what this firm charges to do this work. The construction cost is
    // different in kind — it describes the ASSET, not anyone's price, which
    // is why it stays.
    //
    // Measured, not reasoned. The delivered PDF carried three of these rows,
    // and the application's own reader and detector named them as the reason
    // the document scored 75/QUALITY_FAILED with PRICING_LEAKAGE [HIGH]:
    //
    //   FRAGMENTS THE DETECTOR FLAGS ON THEIR OWN: 3 of 1100
    //     > Row 1: Consultancy Fee | ETB 1.1M
    //     > Row 1: Consultancy Fee | ETB 450K
    //     > Row 1: Consultancy Fee | USD 945K
    //
    // The fix is not to exempt the label. An evaluator reading "Consultancy
    // Fee ETB 1.1M" in a technical envelope can infer this bidder's fee
    // levels, and keeping that out is exactly what the two-envelope rule is
    // for — so the row is not written at all. `fee` is still resolved above
    // so the construction amount is not mistaken for it.
    consultancyFee: undefined,
    constructionValue: works ? formatMoney(works.value, works.currency ?? project.currency) : undefined,
    // The same reasoning applies to the stored column. If the index happens to
    // hold the FEE the source states, then "Contract Value ETB 1.1M" discloses
    // this firm's pricing just as plainly as the row above would have — the
    // label changes, the disclosure does not. Withholding one and printing the
    // other would be a gap, not a rule.
    contractValue: storedValue && Number.isFinite(storedValue) && storedValue > 0 && !storedIsTheConstructionAmount && !storedIsTheConsultancyFee
      ? formatMoney(storedValue, project.currency)
      : undefined,
  };
}

/**
 * Does this card row's label name a price rather than a fact about the work?
 *
 * Used to refuse the row outright in a portfolio card. "Fee", "rate", "price",
 * "remuneration", "invoice" and "billing" can only describe what someone
 * charges. "Cost" and "value" are excluded on purpose: a past project's
 * construction cost is the scale of the asset, not anyone's price, and
 * refusing it would delete legitimate track record.
 */
function isPricingRowLabel(label: string): boolean {
  return /\b(fee|fees|rate|rates|price|pricing|remuneration|invoice|invoiced|billing|billed|quotation|quoted)\b/i.test(label);
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
  // Which value labels this card already carries, and where its table ends, so
  // a row the record supports can be ADDED when the writer never wrote one.
  let seenLabels = new Set<string>();
  let lastTableRowIndex = -1;

  /**
   * A project card's value is the most checkable fact on it, and it was
   * reaching the page only when the writer happened to ask for it.
   *
   * This pass could fill an empty cell or drop a row, but it had no way to add
   * one. In the delivered proposal the writer emitted Client, Location & Scale,
   * Duration and Services Provided and no value row at all, so three cards
   * backed by records stating a construction cost of 550,074,678.02 ETB showed
   * the evaluator no figure — and the document cited no money anywhere, which
   * no gate can see because an absent number breaks no rule.
   *
   * Rows are added only from what the record states, under the role the SOURCE
   * gives the amount. A construction cost is never printed as a contract value:
   * doing so would overstate this firm's consultancy contract by orders of
   * magnitude in a document an evaluator may check against the client's own
   * records. A monthly supervision rate is still never printed at all.
   */
  /** Push a line that belongs to the current card's table, remembering where it ended. */
  function pushTableRow(line: string): void {
    out.push(line);
    lastTableRowIndex = out.length - 1;
  }

  function appendMissingValueRows(): void {
    if (lastTableRowIndex < 0) return;
    const additions: string[] = [];
    const has = (key: string) => seenLabels.has(key);
    if (facts.contractValue && !has("contractvalue") && !has("value")) {
      additions.push(`| Contract Value | ${facts.contractValue} |`);
    } else if (facts.consultancyFee && !has("consultancyfee") && !has("contractvalue") && !has("value")) {
      additions.push(`| Consultancy Fee | ${facts.consultancyFee} |`);
    }
    if (facts.constructionValue && !has("constructionvalueofworks") && !has("constructionvalue")) {
      additions.push(`| Construction Value of Works | ${facts.constructionValue} |`);
    }
    if (additions.length === 0) return;
    out.splice(lastTableRowIndex + 1, 0, ...additions);
    for (const addition of additions) filled.push(addition.split("|")[1].trim());
    lastTableRowIndex += additions.length;
  }

  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      appendMissingValueRows();
      current = matchProject(line, projects);
      facts = current ? recordFactsFor(current) : {};
      seenLabels = new Set<string>();
      lastTableRowIndex = -1;
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
      pushTableRow(line);
      continue;
    }
    const labelKey = label.toLowerCase().replace(/[^a-z]/g, "");
    seenLabels.add(labelKey);
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

    // A PRICING ROW THE WRITER WROTE IS STILL A PRICING ROW.
    //
    // Not adding one is only half the rule. This pass fills empty cells and
    // drops unsupported ones, but a cell that is COMPLETE AS WRITTEN is
    // explicitly never overwritten — so "| Consultancy Fee | ETB 1.1M |"
    // authored upstream reached the delivered PDF untouched, which is where
    // the detector found it. The row is refused on its LABEL, before the
    // completeness check, because the defect is the disclosure and not the
    // cell's quality.
    //
    // Deliberately narrow. It names fee/rate/price vocabulary — words that can
    // only describe what someone charges — and leaves "cost" and "value"
    // alone: "Construction Cost" and "Construction Value of Works" state the
    // scale of the asset, which is track record an evaluator is entitled to.
    if (isPricingRowLabel(label)) {
      removed.push(label.trim());
      continue;
    }

    const kept = assertingParts(value);
    const replacement = fillFor(label, facts);

    if (kept.length > 0) {
      const tidied = kept.join(" — ");
      if (tidied === value.trim()) {
        // The cell is complete as written. Never overwrite it.
        pushTableRow(line);
        continue;
      }
      // Half empty. If the record can complete it WITHOUT contradicting what
      // the writer already put there, complete it; otherwise just drop the
      // part that says nothing.
      const completes = replacement !== undefined
        && kept.every((part) => replacement.toLowerCase().includes(part.toLowerCase()));
      filled.push(label.trim());
      pushTableRow(`| ${label} | ${completes ? replacement : tidied} |`);
      continue;
    }

    if (replacement) {
      filled.push(label.trim());
      pushTableRow(`| ${label} | ${replacement} |`);
      continue;
    }

    // A bare "Contract Value" the record cannot answer becomes the amount the
    // record DOES state, under the role the source gives it. This used to
    // relabel the row to "Consultancy Fee"; a past fee is no longer printed at
    // all (see recordFactsFor), so the only substitution left is the
    // construction value, which describes the asset rather than any price.
    const valueKey = label.toLowerCase().replace(/[^a-z]/g, "");
    if ((valueKey === "contractvalue" || valueKey === "value") && facts.constructionValue) {
      filled.push("Construction Value of Works");
      pushTableRow(`| Construction Value of Works | ${facts.constructionValue} |`);
      continue;
    }

    // Drop the row entirely. A cell that asserts nothing is worse than
    // absent: it reads as a fact the bidder could not produce.
    removed.push(label.trim());
  }

  appendMissingValueRows();

  return { markdown: out.join("\n"), filled, removed };
}


/**
 * The reading guide must not promise what the cards do not carry.
 *
 * B.2.0 ends with "Each card includes a **Relevance to This Assignment**
 * statement mapping the specific competency to a tender requirement." The
 * delivered cards carried no such row, so the document told the evaluator to
 * look for something that is not there — which reads either as a missing
 * section or as a claim the bidder did not honour.
 *
 * The guide is built before the cards exist, so it cannot check them itself.
 * This runs after the cards are final and removes the sentence when no card
 * carries the row. The promise is dropped rather than satisfied on purpose:
 * the only material available to synthesise a relevance statement here is the
 * record's raw source text, and pasting three hundred characters of that under
 * "Relevance to This Assignment" would be worse than saying nothing.
 */
const RELEVANCE_PROMISE =
  /^Each card includes an?\s+\*{0,2}Relevance to This Assignment\*{0,2}\s+statement[^\n]*\n?/gim;

export function reconcilePortfolioReadingGuide(markdown: string): { markdown: string; promiseRemoved: boolean } {
  const cardsCarryRelevance = /^\|\s*Relevance to This Assignment\s*\|\s*\S/im.test(markdown);
  if (cardsCarryRelevance) return { markdown, promiseRemoved: false };

  const next = markdown.replace(RELEVANCE_PROMISE, "");
  return { markdown: next, promiseRemoved: next !== markdown };
}
