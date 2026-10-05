/**
 * Tender Facts Extractor (PR K).
 *
 * THE PROBLEM
 * The benchmark-gap analysis showed that proposals never echo the
 * tender's SPECIFIC NUMBERS / DATES / IDs / BRAND NAMES verbatim:
 *
 *   Claude AI proposal quotes verbatim:
 *     "3 private offices, cleaner's room, security room,
 *      25+ workstations each with integrated network connection,
 *      40-PAX meeting room, 10 to 15-PAX meeting room…"
 *     RFP No. 2026-024  |  Submission Date: 25 March 2026  |
 *     Eagle Plaza 7th Floor, Kirkos Sub City  |
 *     8 deliverables (D1–D8)  |  PATH Ethiopia
 *
 *   The app's proposal mentions NONE of these.
 *
 * The existing tender-language-echoes.ts extracts EVALUATOR phrases
 * ("methodology", "track record"). But it never extracts the tender's
 * concrete FACTS (the numbers, IDs, dates, brand names that prove the
 * bidder actually read the document). Without these, the proposal
 * reads like a brochure for any tender — exactly what the user flagged.
 *
 * THE FIX
 * Deterministic extractor that pulls EIGHT classes of tender fact:
 *
 *   1. Tender / RFP IDs ("RFP No. 2026-024", "Tender Ref XYZ/123")
 *   2. Submission deadline (date + time + timezone)
 *   3. Proposal validity period ("90 days")
 *   4. Site / location names (capitalised proper nouns + sub-city)
 *   5. Numeric quantities (room counts, sqm, person-counts, contract
 *      windows in days/weeks/months)
 *   6. Deliverable codes (D1, D2, D3 ... or numbered scope items)
 *   7. File format requirements ("DWG", "AutoCAD 2018", "PDF/A")
 *   8. Brand / website mentions (URLs, all-caps brand names)
 *
 * Result is consumed by:
 *
 *   - The AI prompt — appended as "TENDER FACTS — INCLUDE VERBATIM"
 *     block telling Claude to weave these into Section C.1 Understanding,
 *     the Cover Letter, and the Executive Summary.
 *
 *   - The deterministic Section C.0 "Tender Specifics Recognised by
 *     This Proposal" table that ALWAYS appears at the top of Section
 *     C, no matter what the AI did. This is the un-skippable proof
 *     that the bidder read the document.
 *
 * NEVER FABRICATES — every fact is a direct match against the tender
 * text. If a class returns no facts, it's omitted; the table never
 * fills with placeholder content.
 */

export interface TenderFacts {
  rfpIds: string[];
  deadlines: string[];
  validityPeriods: string[];
  locations: string[];
  quantities: { value: string; context: string }[];
  deliverableCodes: string[];
  fileFormats: string[];
  brandsOrWebsites: string[];
  rawCount: number;
}

// ─── Class extractors ────────────────────────────────────────────────────

const RFP_PATTERNS: RegExp[] = [
  /\b(?:RFP|Tender|Ref(?:erence)?|RFB|RFQ|ITB|EOI)\.?\s*(?:No\.?|Number|#)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9./\-]{2,30})/gi,
  /\b(?:RFP|Tender)\s*ID\s*[:\-]?\s*([A-Z0-9][A-Z0-9./\-]{2,30})/gi,
];

const DEADLINE_PATTERNS: RegExp[] = [
  // "Submission Date: 25 March 2026"
  /\b(?:Submission|Deadline|Due|Closing)\s*(?:Date|Time)?\s*[:\-]?\s*([0-9]{1,2}\s+[A-Za-z]+\s+20\d{2}(?:[^,\n]{0,40})?)/gi,
  // "Bid Due: 14:00 on 25/03/2026"
  /\b(?:Bid|Submission)\s+Due\s*[:\-]?\s*([^.\n]{6,80})/gi,
  // "by 4:00 PM on March 25, 2026"
  /\bby\s+(\d{1,2}[:.]?\d{0,2}\s*(?:AM|PM|am|pm)?\s+on\s+[A-Za-z]+\s+\d{1,2},?\s+20\d{2})/g,
];

const VALIDITY_PATTERNS: RegExp[] = [
  /\b(?:Proposal\s+)?Validity\s*[:\-]?\s*(\d{1,3}\s*(?:days|day|calendar\s*days|months|weeks))/gi,
  /\b(?:remain\s+valid\s+for|valid\s+for(?:\s+a\s+period\s+of)?)\s+(\d{1,3}\s*(?:days|day|calendar\s*days|months|weeks))/gi,
];

const QUANTITY_CONTEXT_PATTERNS: RegExp[] = [
  // "25 workstations", "40-PAX meeting room", "3 private offices"
  // The value is the number and its unit only; what it describes is read
  // from the surrounding words by quantityContext(). The trailing 60 chars
  // this pattern used to swallow became part of the "value" and, cut
  // mid-word, rendered as "454 sqm) in Addis Ababa (ce space (".
  /(?<![\d,.])\b(\d{1,3}(?:,\d{3})+|\d{1,4})[-\s]?(?:PAX|pax|workstations?|persons?|seats?|offices?|rooms?|m2|sqm|sq\.?\s*m|square\s+metres?|square\s+meters?|hectares?|kilometres?|kilometers?|km|metres?|meters?|m\b)/gi,
  // "8 deliverables", "9 phases", "5 reports"
  /\b(\d{1,3})\s+(?:deliverables?|phases?|reports?|outputs?|milestones?|stages?|tasks?|activities?)\b/gi,
  // "ETB 7,500,000" or "USD 100,000"
  /\b(?:ETB|USD|EUR|GBP|KES|UGX|TZS|RWF)\s+([\d,]+(?:\.\d+)?)\b/g,
  // "28 calendar days", "12 weeks", "6 months"
  /\b(\d{1,3})\s+(?:calendar\s+days|days|weeks|months)\b/g,
];

const DELIVERABLE_CODE_PATTERNS: RegExp[] = [
  // "D1, D2, D3 ... D8" — all listed in one place
  /\bD\s*\d{1,2}\b/gi,
  // "Deliverable 1:" / "Output 1:"
  /\b(?:Deliverable|Output|Product|Task)\s+\d{1,2}\b/gi,
];

const FILE_FORMAT_PATTERNS: RegExp[] = [
  /\b(?:AutoCAD|Auto\s*CAD|DWG|DXF|DWF|Revit|RVT|IFC|BIM|PDF\/?A?|Microsoft\s*Word|MS\s*Word|DOCX|XLSX|PPT|MPP|MS\s*Project|GIS|ArcGIS|Q?GIS)(?:\s+\d{4}|\s+v?\d+(?:\.\d+)?)?/g,
];

const BRAND_PATTERNS: RegExp[] = [
  // URLs
  /\b(?:https?:\/\/|www\.)\S+/gi,
  // Brand names — usually 2-3 capitalized words sometimes followed by Ltd/PLC/Inc/Foundation
  /\b[A-Z][A-Z0-9]{2,}\s+(?:Ethiopia|Foundation|International|Holdings?|Group|Ltd|PLC|Inc\.?|Limited|Corporation|Bank|Energy|Industries)\b/g,
];

// A place is named. A bare kind of place ("Tower", "Building", "Region") is
// not a location: a telecom-tower EOI printed "Site / Location: Tower" in its
// Tender Specifics table (2026-09-30). The kind words therefore need a name in
// front, and a name that is itself an industry word ("Telecommunications
// Tower", "Office Building") is not one.
const LOCATION_HINTS = [
  /\b(?:Kirkos|Bole|Yeka|Lideta|Addis\s+Abeba|Addis\s+Ababa|Adama|Mekelle|Bahir\s+Dar|Hawassa|Dire\s+Dawa)\b/g,
  /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Kebele|Sub\s*City|Sub-City|Woreda|District|Zone|Region|Province)\b/g,
  /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Plaza|Tower|Centre|Building|Avenue|Road|Street)\b/g,
];

const NOT_A_PLACE_NAME = /^(?:the|this|that|a|an|each|every|any|all|new|existing|main|head|office|control|telecom|telecommunications?|communications?|mobile|radio|cell|lattice|water|steel|concrete|previous|tender|project|site|access|service|services|regional|district|national|federal|and|or|of|for|in|at|to|by|with|from)\b/i;

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Alphanumeric tokens of a reference: "RFQ# 2026-024" → [rfq, 2026, 024]. */
function referenceTokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * True when `shorter` is `longer` with some of its tokens dropped from either
 * end — the same reference without its label or prefix. Token-wise, so
 * "2026-02" is not taken for "2026-024".
 */
function isReferenceRestatedBy(shorter: string, longer: string): boolean {
  const a = referenceTokens(shorter);
  const b = referenceTokens(longer);
  if (a.length === 0 || a.length >= b.length) return false;
  for (let offset = 0; offset + a.length <= b.length; offset++) {
    if (a.every((token, i) => token === b[offset + i])) return true;
  }
  return false;
}

const CONTEXT_BOUNDARY = /[.;:!?\n]/;
const CONTEXT_WORDS = 5;
const LEADING_JOINER = /^(?:and|or|but|while|whereas)$/i;
const TRAILING_JOINER = /^(?:and|or|but|of|the|a|an|to|for|with|in|on|at|by|from)$/i;

function contextWords(value: string): string[] {
  return value
    .replace(/[()[\]{}<>|"“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
}

/**
 * The words a quantity sits in, quoted from its own clause: up to five whole
 * words either side, stopping at a neighbouring number and dropping brackets
 * the cut would leave unbalanced. "office space (454 sqm) in Addis Ababa"
 * gives "office space 454 sqm in Addis Ababa".
 */
function quantityContext(text: string, start: number, end: number): string {
  let before = text.slice(Math.max(0, start - 90), start);
  const lastBoundary = Math.max(-1, ...[...before].map((ch, i) => (CONTEXT_BOUNDARY.test(ch) ? i : -1)));
  if (lastBoundary >= 0) before = before.slice(lastBoundary + 1);
  else if (start > 90) before = before.replace(/^\S*\s/, "");
  let after = text.slice(end, end + 90);
  const firstBoundary = after.search(CONTEXT_BOUNDARY);
  if (firstBoundary >= 0) after = after.slice(0, firstBoundary);
  else if (end + 90 < text.length) after = after.replace(/\s\S*$/, "");

  const lead: string[] = [];
  for (const word of contextWords(before).reverse()) {
    if (/\d/.test(word) || lead.length >= CONTEXT_WORDS) break;
    lead.unshift(word);
  }
  const tail: string[] = [];
  for (const word of contextWords(after)) {
    if (/\d/.test(word) || tail.length >= CONTEXT_WORDS) break;
    tail.push(word);
  }
  while (lead.length > 0 && LEADING_JOINER.test(lead[0]!)) lead.shift();
  while (tail.length > 0 && TRAILING_JOINER.test(tail[tail.length - 1]!)) tail.pop();
  if (lead.length === 0 && tail.length === 0) return "";
  const value = contextWords(text.slice(start, end)).join(" ");
  return [...lead, value, ...tail].join(" ").replace(/[,;]+$/, "");
}

function uniq(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of arr) {
    const k = a.replace(/\s+/g, " ").trim();
    if (!k) continue;
    const lk = k.toLowerCase();
    if (seen.has(lk)) continue;
    seen.add(lk);
    out.push(k);
  }
  return out;
}

function extractAll(text: string, patterns: RegExp[], group = 1): string[] {
  const out: string[] = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const v = (m[group] ?? m[0])?.trim();
      if (v) out.push(v);
    }
  }
  return uniq(out);
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Facts that AI Analyze has already established against the tender source and
 * persisted as canonical. These are NOT a second fact authority — they are the
 * existing one, passed in so this extractor stops competing with it.
 *
 * WHY THIS PARAMETER EXISTS
 * A real owner run had AI Analyze correctly extract the client (Pharo
 * Ventures), the deadline (2026-08-25), the submission method and the
 * technical-only instruction. The proposal writer then logged:
 *
 *   Tender facts extracted: 3 RFP ID(s), 0 deadline(s),
 *   0 deliverable code(s), 0 quantity(s)
 *
 * Zero deadlines, for a tender whose deadline was already known and grounded.
 * The writer called this extractor on raw tender text and used nothing else,
 * so a deadline written in a format DEADLINE_PATTERNS does not match was
 * simply lost — and the proposal could not echo the one date the evaluator
 * most expects to see.
 *
 * Regex over raw text is the right tool for the classes the canonical record
 * does not carry (quantities, deliverable codes, file formats, locations). It
 * is the wrong tool for facts already resolved and source-grounded upstream.
 * So canonical values are seeded first and regex only supplements: it can add
 * a fact the canonical record lacks, never override one it holds.
 */
export type CanonicalTenderFacts = {
  /** Effective deadline, already resolved (overrides applied) upstream. */
  deadlineDisplay?: string | null;
  /** Effective reference / procurement number. */
  referenceNumber?: string | null;
};

export function extractTenderFacts(
  tenderText: string,
  canonical?: CanonicalTenderFacts,
): TenderFacts {
  const canonicalDeadlines = [canonical?.deadlineDisplay].filter((v): v is string => Boolean(v && v.trim()));
  const canonicalRfpIds = [canonical?.referenceNumber].filter((v): v is string => Boolean(v && v.trim()));

  if (!tenderText || tenderText.length < 100) {
    // Even with no usable tender text, canonical facts remain true and
    // must still reach the proposal.
    if (canonicalDeadlines.length > 0 || canonicalRfpIds.length > 0) {
      return {
        rfpIds: canonicalRfpIds,
        deadlines: canonicalDeadlines,
        validityPeriods: [],
        locations: [],
        quantities: [],
        deliverableCodes: [],
        fileFormats: [],
        brandsOrWebsites: [],
        rawCount: canonicalRfpIds.length + canonicalDeadlines.length,
      };
    }
    return {
      rfpIds: [],
      deadlines: [],
      validityPeriods: [],
      locations: [],
      quantities: [],
      deliverableCodes: [],
      fileFormats: [],
      brandsOrWebsites: [],
      rawCount: 0,
    };
  }

  // Canonical first, regex second. uniq() keeps the canonical value at the
  // head of the list and drops a regex match that merely repeats it, so the
  // prompt block leads with the grounded fact.
  const rfpIds = uniq([...canonicalRfpIds, ...extractAll(tenderText, RFP_PATTERNS)])
    // A label followed by a source filename/table heading is not a procurement
    // reference. The loose legacy regex accepted values such as
    // "document.docx" and "Type" from flattened extraction tables.
    .filter((value) =>
      !/\.(?:docx?|pdf|xlsx?)$/i.test(value)
      && !/^(?:type|row|document)$/i.test(value)
      && !/\b(?:metadata|title|issuing|status|references?)\b/i.test(value)
      // Procurement references are identifiers, not prose labels. Requiring a
      // digit rejects flattened column headings such as "Status, issued,
      // references" while retaining ordinary RFP/2026/014-style identifiers.
      && /\d/.test(value),
    )
    // "2026-024" is the same reference as the grounded "RFQ# 2026-024"
    // without its label; listed together they read as two references.
    .filter((value, _index, all) => !all.some((other) => other !== value && isReferenceRestatedBy(value, other)))
    .slice(0, 3);
  const deadlines = uniq([...canonicalDeadlines, ...extractAll(tenderText, DEADLINE_PATTERNS)]).slice(0, 3);
  const validityPeriods = extractAll(tenderText, VALIDITY_PATTERNS).slice(0, 2);

  // Deliverable codes — collect, dedupe, sort numerically.
  const deliverableCodesRaw = extractAll(tenderText, DELIVERABLE_CODE_PATTERNS, 0);
  const deliverableCodes = deliverableCodesRaw
    .map((s) => s.replace(/\s+/g, "").toUpperCase())
    .filter((s, i, a) => a.indexOf(s) === i)
    .sort((a, b) => {
      const ai = parseInt(a.replace(/\D+/g, ""), 10) || 0;
      const bi = parseInt(b.replace(/\D+/g, ""), 10) || 0;
      return ai - bi;
    })
    .slice(0, 12);

  const fileFormats = extractAll(tenderText, FILE_FORMAT_PATTERNS, 0).slice(0, 6);
  const brandsOrWebsites = extractAll(tenderText, BRAND_PATTERNS, 0)
    .filter((s) => !/\.(?:pdf|docx?|xlsx?|jpg|png|gif)$/i.test(s))
    .slice(0, 5);

  // Locations — the matched hint itself is evidence. Surrounding extraction
  // text may cross flattened table-cell boundaries and must not be presented
  // as though it were one source-grounded location.
  const locations: string[] = [];
  for (const re of LOCATION_HINTS) {
    re.lastIndex = 0;
    for (const m of tenderText.matchAll(re)) {
      if (m[0] && !NOT_A_PLACE_NAME.test(m[0])) locations.push(m[0]);
    }
  }
  const dedupedLocations = uniq(locations).slice(0, 4);

  // Quantities — pull each match with a small context window so we know
  // what the number describes ("25 workstations", "40-PAX meeting room").
  const quantities: { value: string; context: string }[] = [];
  for (const re of QUANTITY_CONTEXT_PATTERNS) {
    re.lastIndex = 0;
    for (const m of tenderText.matchAll(re)) {
      const value = m[0]?.replace(/^\W+/, "").replace(/\W+$/, "").replace(/\s+/g, " ").trim() ?? "";
      if (!value) continue;
      const at = m.index ?? 0;
      const context = quantityContext(tenderText, at, at + (m[0]?.length ?? 0));
      quantities.push({ value, context });
      if (quantities.length >= 12) break;
    }
    if (quantities.length >= 12) break;
  }
  const seenQty = new Set<string>();
  const dedupedQuantities = quantities.filter((q) => {
    const k = `${q.value}::${q.context}`.toLowerCase();
    if (seenQty.has(k)) return false;
    seenQty.add(k);
    return true;
  }).slice(0, 10);

  return {
    rfpIds,
    deadlines,
    validityPeriods,
    locations: dedupedLocations,
    quantities: dedupedQuantities,
    deliverableCodes,
    fileFormats,
    brandsOrWebsites,
    rawCount: rfpIds.length + deadlines.length + validityPeriods.length +
      dedupedLocations.length + dedupedQuantities.length +
      deliverableCodes.length + fileFormats.length + brandsOrWebsites.length,
  };
}

// ─── Formatters ─────────────────────────────────────────────────────────

/**
 * Format facts as a prompt directive — fed into the AI prompt under
 * "TENDER FACTS — ECHO VERBATIM IN SECTION C.1 UNDERSTANDING".
 */
export function formatFactsForPrompt(facts: TenderFacts): string {
  if (facts.rawCount === 0) return "";
  const lines: string[] = [
    "",
    "## TENDER FACTS — ECHO VERBATIM IN SECTION C.1 UNDERSTANDING",
    "",
    "These exact numbers, IDs, dates, and brand names were lifted from the tender. The proposal MUST quote them verbatim — at least the RFP ID, the submission deadline, the validity period, the deliverable code list, and the most distinctive 3-5 quantities. Do not paraphrase. Evaluators score recognition.",
    "",
  ];
  if (facts.rfpIds.length > 0) lines.push(`- RFP / Reference: ${facts.rfpIds.join(", ")}`);
  if (facts.deadlines.length > 0) lines.push(`- Submission deadline: ${facts.deadlines.join(" | ")}`);
  if (facts.validityPeriods.length > 0) lines.push(`- Proposal validity: ${facts.validityPeriods.join(" | ")}`);
  if (facts.locations.length > 0) lines.push(`- Site / location: ${facts.locations.join(" ; ")}`);
  if (facts.deliverableCodes.length > 0) lines.push(`- Deliverable codes: ${facts.deliverableCodes.join(", ")}`);
  if (facts.fileFormats.length > 0) lines.push(`- Required file formats / software: ${facts.fileFormats.join(", ")}`);
  if (facts.brandsOrWebsites.length > 0) lines.push(`- Client brand / website: ${facts.brandsOrWebsites.join(" ; ")}`);
  if (facts.quantities.length > 0) {
    lines.push(`- Distinctive quantities (echo at least 3-5 of these in C.1):`);
    for (const q of facts.quantities.slice(0, 8)) {
      const ctx = q.context ? ` — "${q.context}"` : "";
      lines.push(`  • ${q.value}${ctx}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Build a deterministic "Section C.0 — Tender Specifics Recognised by
 * This Proposal" table that ALWAYS appears at the top of Section C.
 * This is the un-skippable proof that the bidder read the document.
 *
 * Returns "" when the facts payload is empty (no tender text or
 * no extractable facts) so we don't emit an empty table.
 */
export function buildTenderSpecificsBlock(facts: TenderFacts): string {
  if (facts.rawCount === 0) return "";
  const rows: { field: string; value: string }[] = [];
  if (facts.rfpIds.length > 0) rows.push({ field: "Tender / RFP Reference", value: facts.rfpIds.join(", ") });
  if (facts.deadlines.length > 0) rows.push({ field: "Submission Deadline", value: facts.deadlines.join(" | ") });
  if (facts.validityPeriods.length > 0) rows.push({ field: "Proposal Validity", value: facts.validityPeriods.join(" | ") });
  if (facts.locations.length > 0) rows.push({ field: "Site / Location", value: facts.locations.join(" ; ") });
  if (facts.deliverableCodes.length > 0) rows.push({ field: "Deliverable Codes", value: facts.deliverableCodes.join(", ") });
  if (facts.fileFormats.length > 0) rows.push({ field: "Required File Formats / Software", value: facts.fileFormats.join(", ") });
  if (facts.brandsOrWebsites.length > 0) rows.push({ field: "Client Brand / Website", value: facts.brandsOrWebsites.join(" ; ") });
  if (facts.quantities.length > 0) {
    // The context already quotes the value in its own words.
    const top5 = facts.quantities.slice(0, 5).map((q) => q.context ? `“${q.context}”` : q.value);
    rows.push({ field: "Distinctive Tender Quantities", value: top5.join(" ; ") });
  }

  if (rows.length === 0) return "";

  const head = "| Tender Specific | Recognised in This Proposal |";
  const sep = "|------------------|------------------------------|";
  const body = rows.map((r) => `| ${r.field} | ${r.value} |`);

  return [
    `<!-- tender-facts:specifics -->`,
    `## C.0 Tender Specifics Recognised by This Proposal`,
    "",
    "The table below confirms the specific tender data recognised by this submission. Every entry is quoted directly from the tender document so the evaluator can verify that the bidder read the requirements exactly as published. The remainder of Section C builds on these specifics.",
    "",
    head,
    sep,
    ...body,
    "",
  ].join("\n");
}
