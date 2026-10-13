/**
 * What the tender's own text states about delivery: the submission method
 * clause, the submission e-mail addresses, and the deadline.
 *
 * Each reader returns the clause it relied on, verbatim, so the value can be
 * grounded (file + page + quote) exactly like an AI-extracted fact. Nothing is
 * inferred that the text does not say.
 *
 * Read from a real feasibility-study ToR on 2026-10-06, which the app had
 * read as: no deadline, a submission e-mail, and an ungrounded "Portal":
 *
 *   "Quotations must be uploaded online through the following web tendering
 *    portal not later than the 2 3rd
 *    of September 2026, 3:00 PM that is accessible through the following link:"
 *
 *   "... please talk to your contact at Welthungerhilfe or send an email to
 *    screening@welthungerhilfe.de."   (the supplier-screening privacy notice)
 *
 * The deadline was missed because the PDF text split "23rd" and wrapped the
 * line, and because the first trigger that matched ("deadline for bid
 * submission will …") held no date and stopped the search. The e-mail was every
 * address in the document. The method's only grounding attempt searched for
 * the label "Portal" rather than the clause that states it.
 */

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const MONTH_RX = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

export interface SourceClause {
  /** Character offset of the clause in the ORIGINAL text. */
  readonly index: number;
  /** The clause, verbatim from the original text (whitespace as in the source). */
  readonly quote: string;
}

/** Collapse whitespace and mend digits a PDF text layer split ("2 3rd"). */
function normalizeWithMap(text: string): { normalized: string; map: number[] } {
  let normalized = "";
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      if (!lastWasSpace && normalized.length > 0) {
        normalized += " ";
        map.push(i);
      }
      lastWasSpace = true;
      continue;
    }
    lastWasSpace = false;
    normalized += ch;
    map.push(i);
  }
  return { normalized, map };
}

function clauseAt(text: string, map: number[], start: number, end: number): SourceClause {
  const from = map[start] ?? 0;
  const to = (map[Math.max(start, end - 1)] ?? from) + 1;
  return { index: from, quote: text.slice(from, to).trim() };
}

function sentenceAround(normalized: string, index: number, length: number): [number, number] {
  let start = normalized.lastIndexOf(". ", index);
  start = start < 0 ? Math.max(0, index - 160) : Math.max(start + 2, index - 240);
  let end = normalized.indexOf(". ", index + length);
  end = end < 0 ? Math.min(normalized.length, index + length + 160) : Math.min(end + 1, index + length + 240);
  return [start, end];
}

// ─── Deadline ────────────────────────────────────────────────────────────────

const DEADLINE_TRIGGER = /\b(?:submission\s+deadline|closing\s+(?:date|time)|bid\s+closing|deadline|due\s+(?:date|on|by)|not\s+later\s+than|no\s+later\s+than|on\s+or\s+before|(?:received|submitted|uploaded|delivered)\s+(?:on\s+or\s+)?(?:by|before))\b/gi;

const OTHER_DEADLINE = /\b(?:clarifications?|quer(?:y|ies)|questions?|enquir(?:y|ies)|pre-?bid|site\s+visit|inception|payment|invoice|report(?:ing)?)\b/i;

type StatedDay = { year: number; month: number; day: number; end: number };

function parseStatedDay(s: string): StatedDay | null {
  // 23rd of September 2026 / 23 September 2026 / 23 Sept. 2026
  let m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RX}\\.?,?\\s+(\\d{4})\\b`, "i").exec(s);
  if (m) return day(Number(m[3]), MONTHS[m[2]!.toLowerCase()] ?? MONTHS[m[2]!.toLowerCase().slice(0, 3)], Number(m[1]), m);
  // September 23rd, 2026 / September 23 2026
  m = new RegExp(`\\b${MONTH_RX}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "i").exec(s);
  if (m) return day(Number(m[3]), MONTHS[m[1]!.toLowerCase()] ?? MONTHS[m[1]!.toLowerCase().slice(0, 3)], Number(m[2]), m);
  // 2026-09-23
  m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s);
  if (m) return day(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m);
  // 23/09/2026 or 23.09.2026 (day first, the form these tenders use)
  m = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/.exec(s);
  if (m) return day(Number(m[3]), Number(m[2]) - 1, Number(m[1]), m);
  return null;
}

function day(year: number, month: number | undefined, dayOfMonth: number, match: RegExpExecArray): StatedDay | null {
  if (month === undefined || month < 0 || month > 11) return null;
  if (dayOfMonth < 1 || dayOfMonth > 31 || year < 1990 || year > 2100) return null;
  const probe = new Date(Date.UTC(year, month, dayOfMonth));
  return probe.getUTCDate() === dayOfMonth ? { year, month, day: dayOfMonth, end: match.index + match[0].length } : null;
}

// "3:00 PM", "15:00 hrs", "15.00 hrs", "3 pm", "noon". A dotted time needs
// its unit, so a clause number ("Section 4.12") or a date's own digits
// ("23.09.2026") are not read as one.
const TIME_PATTERNS: readonly RegExp[] = [
  /\b(\d{1,2}):(\d{2})(?!:?\d)\s*(a\.?\s?m\b\.?|p\.?\s?m\b\.?)?/i,
  /\b(\d{1,2})\.(\d{2})\s*(a\.?\s?m\b\.?|p\.?\s?m\b\.?|hrs?\b|hours\b|h\b)/i,
  /\b(\d{1,2})()\s*(a\.?m\b\.?|p\.?m\b\.?)/i,
];

function parseStatedTime(s: string): { hours: number; minutes: number } | null {
  if (/\b(?:noon|midday)\b/i.test(s)) return { hours: 12, minutes: 0 };
  for (const rx of TIME_PATTERNS) {
    const m = rx.exec(s);
    if (!m) continue;
    let hours = Number(m[1]);
    const minutes = m[2] ? Number(m[2]) : 0;
    const meridiem = (m[3] ?? "").toLowerCase().replace(/[^aph]/g, "").charAt(0);
    if (meridiem === "p" && hours < 12) hours += 12;
    if (meridiem === "a" && hours === 12) hours = 0;
    if (hours > 23 || minutes > 59) return null;
    return { hours, minutes };
  }
  return null;
}

/**
 * The date (and, when stated beside it, the clock time) in a fragment, as
 * stated: the clock time is kept as written, without guessing a time zone.
 */
function parseStatedDate(fragment: string): Date | null {
  const s = fragment.replace(/\b(\d)\s(\d)(st|nd|rd|th)\b/gi, "$1$2$3");
  const stated = parseStatedDay(s);
  if (!stated) return null;
  // The clock time stated with the date, not one from a later sentence.
  const time = parseStatedTime(s.slice(0, stated.end + 30));
  return new Date(Date.UTC(stated.year, stated.month, stated.day, time?.hours ?? 0, time?.minutes ?? 0));
}

/**
 * The submission deadline the text states: the first deadline trigger that is
 * followed (within 80 characters, across line breaks) by a parseable date.
 */
export function findStatedDeadline(text: string | null | undefined): (SourceClause & { date: Date }) | null {
  if (!text) return null;
  const { normalized, map } = normalizeWithMap(text);
  DEADLINE_TRIGGER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DEADLINE_TRIGGER.exec(normalized))) {
    const window = normalized.slice(m.index, m.index + m[0].length + 80);
    // A clarification, pre-bid, site-visit or reporting date is not the
    // submission deadline, even when it is called one.
    const stop = normalized.lastIndexOf(". ", m.index);
    const sentenceStart = Math.max(m.index - 60, stop < 0 ? 0 : stop + 2);
    const around = normalized.slice(sentenceStart, m.index + m[0].length + 40);
    if (OTHER_DEADLINE.test(around)) continue;
    const date = parseStatedDate(window);
    if (!date) continue;
    let end = Math.min(normalized.length, m.index + m[0].length + 80);
    // End on a whole word, so the quote reads as the source does.
    while (end < normalized.length && end < m.index + m[0].length + 100 && /\S/.test(normalized[end]!)) end += 1;
    const clause = clauseAt(text, map, m.index, end);
    return { ...clause, date };
  }
  return null;
}

// ─── Submission e-mail ───────────────────────────────────────────────────────

const EMAIL_RX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SUBMISSION_WORDS = /\b(?:submi(?:t|ts|tted|ssion|ssions)|proposals?|bids?|tenders?|quotations?|offers?|applications?|expressions?\s+of\s+interest|send\s+(?:your|the|all)\s+(?:proposals?|bids?|offers?|applications?|documents?))\b/i;
const NOT_SUBMISSION_WORDS = /\b(?:data\s+protection|personal\s+data|privacy|processed\s+or\s+stored|screening|complaints?|grievances?|fraud|corruption|whistle-?blow\w*|misconduct|safeguarding|sexual\s+exploitation|ethics\s+hotline|unsubscribe|clarifications?|quer(?:y|ies)|questions?|enquir(?:y|ies))\b/i;

/** Whether an e-mail address sits in a sentence about submitting. */
export function isSubmissionEmailContext(text: string, emailIndex: number, emailLength: number): boolean {
  const { normalized, map } = normalizeWithMap(text);
  // map is original-offset per normalized char; find the normalized index.
  let n = map.findIndex((orig) => orig >= emailIndex);
  if (n < 0) n = normalized.length;
  const [start, end] = sentenceAround(normalized, n, emailLength);
  const sentence = normalized.slice(start, end);
  return SUBMISSION_WORDS.test(sentence) && !NOT_SUBMISSION_WORDS.test(sentence);
}

/** E-mail addresses the text gives for submission, in order of appearance. */
export function submissionEmailsFromText(text: string | null | undefined, limit = 6): string[] {
  if (!text) return [];
  const out: string[] = [];
  EMAIL_RX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMAIL_RX.exec(text))) {
    const email = m[0].toLowerCase();
    if (out.includes(email)) continue;
    if (isSubmissionEmailContext(text, m.index, m[0].length)) out.push(email);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * How an e-mail address appears in the text: "submission" when any occurrence
 * is in a sentence about submitting, "other" when every occurrence is in some
 * other context (a privacy notice, a complaints line), "absent" when the text
 * does not contain it.
 */
export function submissionEmailStanding(text: string | null | undefined, email: string): "submission" | "other" | "absent" {
  if (!text || !email) return "absent";
  const needle = email.trim().toLowerCase();
  const lower = text.toLowerCase();
  let at = lower.indexOf(needle);
  if (at < 0) return "absent";
  while (at >= 0) {
    if (isSubmissionEmailContext(text, at, needle.length)) return "submission";
    at = lower.indexOf(needle, at + needle.length);
  }
  return "other";
}

// ─── Submission method clause ────────────────────────────────────────────────

const METHOD_CLAUSES: Record<"portal" | "email" | "physical", RegExp> = {
  portal: /\b(?:upload(?:ed)?|submi(?:t|tted|ssion)|appl(?:y|ications?))\b[^.]{0,120}\b(?:portal|online|e-?tender(?:ing)?|e-?procurement|electronic(?:ally)?|web\s+(?:site|platform)|platform)\b|\b(?:portal|e-?tender(?:ing)?|e-?procurement)\b[^.]{0,80}\b(?:upload(?:ed)?|submi(?:t|tted|ssion))\b/i,
  email: /\b(?:submi(?:t|tted|ssion)|send|sent|e-?mail(?:ed)?)\b[^.]{0,120}\b(?:by|via|through|to)\s+e-?mail\b|\b(?:submi(?:t|tted|ssion)|send|sent)\b[^.]{0,120}@/i,
  physical: /\b(?:sealed\s+envelopes?|hard\s+cop(?:y|ies)|hand[-\s]deliver(?:ed|y)?|courier|delivered\s+(?:by\s+hand|in\s+person|to\s+the\s+(?:office|address))|tender\s+box|physical\s+(?:submission|delivery))\b/i,
};

function methodClass(method: string): "portal" | "email" | "physical" | null {
  const m = method.toLowerCase();
  if (/portal|online|electronic|e-?tender|e-?procurement|platform|web/.test(m)) return "portal";
  if (/e-?mail/.test(m)) return "email";
  if (/hard\s*copy|sealed|physical|hand|courier|envelope|in\s*person|box/.test(m)) return "physical";
  return null;
}

/** The clause in which the text states the submission method, verbatim. */
export function findSubmissionMethodClause(method: string | null | undefined, text: string | null | undefined): SourceClause | null {
  if (!method || !text) return null;
  const cls = methodClass(method);
  if (!cls) return null;
  const { normalized, map } = normalizeWithMap(text);
  const m = METHOD_CLAUSES[cls].exec(normalized);
  if (!m) return null;
  return clauseAt(text, map, m.index, m.index + m[0].length);
}
