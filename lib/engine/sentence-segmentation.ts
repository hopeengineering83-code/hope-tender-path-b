/**
 * ONE RULE, SHARED: a period inside a token is not a sentence boundary.
 *
 * WHY THIS MODULE EXISTS (the evidence, not a preference)
 * ------------------------------------------------------
 * Two sentence splitters run on the production path, and they answer two
 * genuinely different questions:
 *
 *   lib/engine/pricing-hygiene.ts  sentences()
 *     "What unit do I JUDGE?"  A table row rendered one cell per line is a
 *     unit, so a newline is a boundary, and the terminator is dropped because
 *     the fragment is matched against detection patterns.
 *
 *   lib/engine/export-gap-repair.ts  splitIntoSentences()
 *     "What unit do I REMOVE from a paragraph?"  The surviving sentences are
 *     re-joined and written into a client document, so newlines inside a
 *     paragraph are not boundaries and the terminator must be kept or the
 *     delivered prose loses its punctuation.
 *
 * Those differences are real and are NOT consolidated here. A probe over the
 * fourteen semantics named in the splitter requirements found the two
 * disagreeing on ten -- but the disagreements fall into two piles. Most are
 * the newline/terminator policy above, which each module is right about for
 * its own question. The rest are one shared invariant that only one of the two
 * implements, which is exactly where they drifted:
 *
 *   decimal money   pricing-hygiene:  ["... ETB 550,074,678.02 was delivered."]
 *                   export-gap-repair ["... ETB 550,074,678.", "02 was ..."]
 *   email           export-gap-repair ["Send to tender.", "office@example.",
 *                                      "gov.", "et before the deadline."]
 *   url             export-gap-repair ["See https://example.", "gov.",
 *                                      "et/docs/v1.", "2/tor.", "pdf ..."]
 *   date            export-gap-repair ["Completed 12.03.", "2019 and handed
 *                                      over."]
 *
 * export-gap-repair carried a lookbehind for up to THREE digits before the
 * point, which rescues "ETB 550.1M" -- the figure that shipped to a client as
 * "Construction Value of Works 1M" -- but not a full amount, an email, a URL
 * or a date. The invariant is the same one in every case and belongs in one
 * place: a period whose neighbours make it internal punctuation is not a
 * terminator.
 *
 * THIS IS NOT A RELAXATION OF ANY DETECTION
 * -----------------------------------------
 * Keeping a token whole makes fragments LARGER, never smaller. In
 * pricing-hygiene a larger fragment carries more context into the historical
 * exemption, and the currentOfferPricing veto and priced-content guards run on
 * the merged fragment too -- it gains context, and the context is judged. In
 * export-gap-repair a larger unit means an unsafe sentence is removed whole
 * rather than leaving the half that carries the amount; that direction is
 * fail-safe. No threshold moves, no pattern is narrowed, and nothing is
 * whitelisted.
 */

export interface SegmentOptions {
  /**
   * True for a judge that treats a table rendered one cell per line as one
   * unit per cell. False for a repairer working inside a single paragraph,
   * where a newline is a line wrap and not the end of a claim.
   */
  newlinesAreBoundaries: boolean;
  /**
   * True when the segments are re-joined into delivered prose and must keep
   * their punctuation. False when they are matched against detection patterns.
   * A terminator at the very end of the text is kept either way -- it never
   * acted as a delimiter.
   */
  keepTerminators: boolean;
}

/** A span of text in which no `.`/`!`/`?` may end a sentence. */
interface Protected {
  start: number;
  end: number;
}

/**
 * A bare-word abbreviation whose trailing period is part of the word.
 *
 * Deliberately a closed list of the titles and units that appear in tender
 * prose across sectors -- professional titles, figure/table references,
 * reference-number words and the Ethiopian calendar marker. An open rule such
 * as "any short capitalised word" would swallow a genuine one-word sentence.
 */
const ABBREVIATIONS = [
  "Dr", "Prof", "Mr", "Mrs", "Ms", "Messrs", "Eng", "Engr", "Arch", "Ato", "Wro", "Wt",
  "St", "Ltd", "Plc", "PLC", "Co", "Inc", "Corp", "Pty", "Sc", "Tech",
  "No", "no", "Nos", "Ref", "Fig", "Figs", "Tbl", "Vol", "Ch", "Sec", "Art", "Para", "pp",
  "approx", "est", "max", "min", "etc", "vs", "viz", "cf", "incl", "excl",
  "E", "C", "G", "A", "B", "D", "i", "e", "ie", "eg",
];

const ABBREVIATION_RX = new RegExp(
  `(?:^|[\\s("'\\[])(?:${ABBREVIATIONS.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\.`,
  "g",
);

/**
 * An email address or a URL, captured as one token.
 *
 * Trailing sentence punctuation is excluded from the token, so "Send it to
 * bids@example.gov.et." still ends a sentence at the final period while the
 * periods inside the address do not.
 */
const ADDRESS_RX =
  /(?:https?:\/\/|www\.)[^\s<>()\[\]]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * A clock meridiem. Tender deadlines are written "before 10:00 a.m. on the
 * closing date", and splitting after "m." severs the time from its date.
 */
const MERIDIEM_RX = /\b[ap]\.m\./gi;

/** Digits on both sides of the point: 550,074,678.02 · 12.03.2019 · v1.2 · 99.9%. */
const NUMBER_INTERNAL_RX = /\d[.]\d/g;

/**
 * A list ordinal: up to three digits at a boundary, then a period.
 *
 * This preserves pricing-hygiene's existing lookbehind exactly. A Company
 * Vault project reference is written as an enumerated list, and cutting at the
 * ordinals severed each amount from the project heading, the client and the
 * years that identify it as a PAST project -- so a historical figure was
 * reported as this bid's price, intermittently, depending on where the
 * numbering fell.
 */
const ORDINAL_RX = /(?:^|[\s(\[])\d{1,3}[.]/g;

function protectedSpans(text: string): Protected[] {
  const spans: Protected[] = [];
  for (const rx of [ADDRESS_RX, NUMBER_INTERNAL_RX, ABBREVIATION_RX, MERIDIEM_RX, ORDINAL_RX]) {
    rx.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rx.exec(text)) !== null) {
      let end = match.index + match[0].length;
      if (rx === ADDRESS_RX) {
        // Drop punctuation the address swallowed from the end of the sentence.
        while (end > match.index && /[.,;:!?)\]]/.test(text[end - 1])) end -= 1;
      }
      spans.push({ start: match.index, end });
      if (match[0].length === 0) rx.lastIndex += 1;
    }
  }
  return spans;
}

function isProtected(spans: Protected[], index: number): boolean {
  return spans.some((span) => index >= span.start && index < span.end);
}

/**
 * Split text into the units a caller judges or rewrites.
 *
 * A terminator ends a sentence only when it is followed by whitespace or the
 * end of the text AND is not inside a protected token. Runs of terminators
 * ("?!") are consumed together.
 */
export function segmentSentences(text: string, options: SegmentOptions): string[] {
  if (!text) return [];
  const normalised = text.replace(/\r\n?/g, "\n");
  const spans = protectedSpans(normalised);
  const segments: string[] = [];
  let start = 0;

  for (let i = 0; i < normalised.length; i += 1) {
    const ch = normalised[i];

    if (ch === "\n" && options.newlinesAreBoundaries) {
      segments.push(normalised.slice(start, i));
      while (i + 1 < normalised.length && normalised[i + 1] === "\n") i += 1;
      start = i + 1;
      continue;
    }

    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    if (isProtected(spans, i)) continue;

    let end = i;
    while (end + 1 < normalised.length && /[.!?]/.test(normalised[end + 1])) end += 1;

    const next = normalised[end + 1];
    const atEnd = next === undefined;
    const followedByBreak = next !== undefined && /\s/.test(next);
    if (!atEnd && !followedByBreak) continue;
    if (atEnd) break; // a trailing terminator never delimited anything

    segments.push(normalised.slice(start, options.keepTerminators ? end + 1 : i));
    start = end + 1;
  }

  segments.push(normalised.slice(start));
  return segments.map((segment) => segment.replace(/\s+/g, " ").trim()).filter(Boolean);
}
