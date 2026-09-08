/**
 * Semantic tender-context selection.
 *
 * Writer prompts used to carry the tender by head-slice — `tenderText.slice(0,
 * 8_000)` and friends. A head-slice is the worst possible selection: the first
 * pages of a real tender are the cover sheet, the invitation letter, the table
 * of contents and the instructions-to-bidders boilerplate, while the scope of
 * work, the deliverable schedule and the technical specification — the parts a
 * methodology has to answer — sit past the cut. The writer was therefore paying
 * full price for front matter and then writing the methodology without ever
 * seeing the scope.
 *
 * This module keeps the tender passages that a given writer actually needs,
 * chosen by scoring each passage against that writer's focus vocabulary, and
 * drops the rest. Selection is sector-neutral: the focus terms describe a
 * DOCUMENT ROLE ("scope", "deliverable", "methodology") rather than an
 * industry, so a road tender and a hospital tender are cut the same way.
 *
 * Two invariants hold whatever the budget:
 *   - the opening of the document is always retained, because that is where the
 *     reference number, the client, the title and the deadline live;
 *   - passages are emitted in document order, with an explicit elision marker,
 *     so the writer can never mistake a gap for continuous text.
 */

/** Marker written wherever passages were dropped, so elision is visible. */
export const TENDER_CONTEXT_ELISION = "[… tender text omitted here …]";

/**
 * Chars of the document opening retained regardless of score. Deliberately
 * small: it exists to carry the reference number and title, not to pay for the
 * invitation letter and the disclaimer behind them. The first passage is always
 * kept; after that the allowance is a ceiling the loop may not overshoot,
 * because overshooting is how unscored front matter used to buy its way in.
 */
const OPENING_ALLOWANCE_CHARS = 800;

/**
 * How weak a passage may be, relative to the tender's most on-focus passage,
 * and still be worth sending. Spare budget is not a reason to ship the
 * arbitration annex: a passage far off the writer's focus costs tokens and
 * gives the writer nothing to say.
 */
const PASSAGE_RELATIVE_FLOOR = 0.15;

/** Passages shorter than this are joined onto their neighbour rather than scored alone. */
const MIN_PASSAGE_CHARS = 120;

/** Fallback passage size when the document has no blank-line structure. */
const FALLBACK_PASSAGE_CHARS = 700;

function normaliseTerms(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 4),
  );
}

/**
 * Split the tender into passages. Blank lines are the natural boundary in
 * extracted tender text; documents that arrive as one unbroken block are cut
 * into fixed-size passages instead, on a line boundary where one is available.
 */
export function splitTenderPassages(tenderText: string): string[] {
  const byBlankLine = tenderText.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  const passages: string[] = [];
  for (const passage of byBlankLine) {
    if (passage.length <= FALLBACK_PASSAGE_CHARS * 2) {
      passages.push(passage);
      continue;
    }
    // Oversized block — cut it down, preferring a line boundary.
    let rest = passage;
    while (rest.length > FALLBACK_PASSAGE_CHARS * 2) {
      const window = rest.slice(0, FALLBACK_PASSAGE_CHARS);
      const lastBreak = window.lastIndexOf("\n");
      const cut = lastBreak > FALLBACK_PASSAGE_CHARS / 2 ? lastBreak : FALLBACK_PASSAGE_CHARS;
      passages.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut);
    }
    if (rest.trim().length > 0) passages.push(rest.trim());
  }
  // Fold runts into the previous passage so scoring never runs on a stray line.
  const merged: string[] = [];
  for (const passage of passages) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && passage.length < MIN_PASSAGE_CHARS) {
      merged[merged.length - 1] = `${previous}\n${passage}`;
    } else {
      merged.push(passage);
    }
  }
  return merged;
}

/**
 * Score one passage for a writer.
 *
 * Focus-term density decides relevance. The length divisor keeps a long
 * passage from outranking a dense one on volume, and the numeral bonus favours
 * passages carrying the quantities, standards and clause numbers that make a
 * methodology specific rather than generic — the same property the proposal is
 * graded on.
 */
function isFocusTerm(term: string, focus: ReadonlySet<string>): boolean {
  if (focus.has(term)) return true;
  return term.endsWith("s") && focus.has(term.slice(0, -1));
}

function scorePassage(passage: string, focus: ReadonlySet<string>, alreadyProvided: ReadonlySet<string>): number {
  const terms = passage.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length >= 4);
  if (terms.length === 0) return 0;
  let hits = 0;
  // Tenders write "key experts", "the Consultants shall", "the deliverables".
  // Matching the exact token only would score those passages as off-focus and
  // drop the Key Personnel clause the writer is required to name experts from,
  // so a trailing plural counts as its singular.
  for (const term of terms) if (isFocusTerm(term, focus)) hits += 1;
  const density = hits / Math.sqrt(terms.length);
  const numerals = /\b\d/.test(passage) ? 1.1 : 1;
  // A passage whose vocabulary is already covered by the structured blocks in
  // the same prompt earns its place only if it is strongly on-focus: repeating
  // the requirements list back as raw text buys the writer nothing.
  const distinct = new Set(terms);
  let covered = 0;
  for (const term of distinct) if (alreadyProvided.has(term)) covered += 1;
  const redundancy = distinct.size === 0 ? 0 : covered / distinct.size;
  return density * numerals * (1 - 0.5 * redundancy);
}

export type TenderContextSelection = {
  text: string;
  /** True when the whole tender fitted and nothing was dropped. */
  complete: boolean;
  passagesKept: number;
  passagesTotal: number;
};

/**
 * Select the tender passages a writer needs, within a character budget.
 *
 * When the tender already fits the budget it is returned untouched — this
 * never truncates a document it could have sent whole.
 */
export function selectTenderContext(
  tenderText: string,
  opts: {
    budgetChars: number;
    focusTerms: readonly string[];
    /** Blocks already present in the same prompt; their vocabulary is discounted. */
    alreadyProvided?: readonly string[];
  },
): TenderContextSelection {
  const text = (tenderText ?? "").trim();
  const passages = splitTenderPassages(text);
  if (text.length <= opts.budgetChars) {
    return { text, complete: true, passagesKept: passages.length, passagesTotal: passages.length };
  }

  const focus = normaliseTerms(opts.focusTerms.join(" "));
  const alreadyProvided = normaliseTerms((opts.alreadyProvided ?? []).join(" "));

  const kept = new Set<number>();
  let used = 0;

  // The opening always travels: reference number, client, title, deadline.
  for (let index = 0; index < passages.length; index += 1) {
    const cost = passages[index].length + 2;
    if (index > 0 && used + cost > OPENING_ALLOWANCE_CHARS) break;
    kept.add(index);
    used += cost;
  }

  const ranked = passages
    .map((passage, index) => ({ index, score: scorePassage(passage, focus, alreadyProvided) }))
    .filter((row) => !kept.has(row.index))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));

  const floor = ranked.length > 0 ? ranked[0].score * PASSAGE_RELATIVE_FLOOR : 0;
  for (const row of ranked) {
    if (row.score <= 0 || row.score < floor) break;
    const cost = passages[row.index].length + 2;
    if (used + cost > opts.budgetChars) continue;
    kept.add(row.index);
    used += cost;
  }

  const ordered = Array.from(kept).sort((a, b) => a - b);
  const out: string[] = [];
  let previous = -1;
  for (const index of ordered) {
    if (previous !== -1 && index !== previous + 1) out.push(TENDER_CONTEXT_ELISION);
    out.push(passages[index]);
    previous = index;
  }
  if (previous !== -1 && previous !== passages.length - 1) out.push(TENDER_CONTEXT_ELISION);

  return {
    text: out.join("\n\n"),
    complete: false,
    passagesKept: ordered.length,
    passagesTotal: passages.length,
  };
}

/**
 * Focus vocabulary per writer. These name what part of a tender the section has
 * to answer — not what industry the tender is in.
 */
export const TENDER_FOCUS_METHODOLOGY = [
  "scope", "services", "works", "methodology", "approach", "tasks", "activities",
  "deliverable", "deliverables", "output", "outputs", "report", "reports", "drawings",
  "design", "study", "survey", "investigation", "supervision", "phase", "phases",
  "stage", "stages", "schedule", "programme", "timeline", "duration", "months",
  "weeks", "specification", "specifications", "standard", "standards", "code",
  "quality", "inspection", "testing", "review", "approval", "requirement",
  "requirements", "consultant", "team", "expert", "personnel", "qualification",
  "experience", "objective", "objectives", "terms", "reference", "assignment",
] as const;

export const TENDER_FOCUS_SUBMISSION = [
  "submission", "submit", "deadline", "closing", "envelope", "sealed", "bid",
  "security", "bond", "guarantee", "validity", "format", "copies", "original",
  "address", "email", "portal", "opening", "eligibility", "documents", "forms",
  "annex", "schedule", "declaration", "signature", "stamp", "registration",
  "licence", "license", "certificate", "compliance", "instructions", "bidders",
] as const;

export const TENDER_FOCUS_EVALUATION = [
  "evaluation", "criteria", "criterion", "score", "scoring", "points", "marks",
  "weight", "weighting", "technical", "financial", "qualification", "experience",
  "methodology", "personnel", "capacity", "responsive", "responsiveness",
  "threshold", "minimum", "award", "selection", "shortlist", "quality",
] as const;
