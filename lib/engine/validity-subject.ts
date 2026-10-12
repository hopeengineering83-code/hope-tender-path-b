// Whose validity period a tender sentence states.
//
// A tender states several validity periods: the offer's ("proposals shall
// remain valid for 90 days") and a bid security's, guarantee's or bond's,
// usually longer ("the bid security shall be valid for 120 days"). Every
// reader of the offer's validity — the tender detail extractors and the
// pricing estimate — took the first "valid … N days" in the text, so a
// security stated first became the validity the financial proposal promised
// and the tender detail showed. This is the one rule they share.

const SECURITY_SUBJECT = /\b(?:securit(?:y|ies)|securing\s+declaration|guarantees?|bonds?|insurance|warrant(?:y|ies)|EMD|earnest\s+money(?:\s+deposit)?)\b/gi;
const OFFER_SUBJECT = /\b(?:proposals?|bids?|offers?|tenders?|quotations?)\b(?!\s+(?:securit|securing|guarantee|bond))/gi;
// Only a full stop, exclamation or question mark that is followed by the
// start of a new sentence ends the context, and never one closing a common
// abbreviation ("issued by ABC Bank Ltd. and shall remain valid…"). A
// semicolon does not ("Bid security required; validity: 120 days" is the
// security's), and neither does a line break: extracted PDF text wraps
// mid-sentence ("the bid security shall be\nvalid for 120 days").
const ABBREVIATIONS = new Set(["ltd", "co", "inc", "plc", "corp", "llc", "no", "nos", "art", "sec", "cl", "para", "e.g", "i.e", "etc", "mr", "mrs", "ms", "dr", "eng", "st", "vs", "approx"]);
const SENTENCE_END_CANDIDATE = /([A-Za-z.]*)[.!?](?=\s+["“(]?[A-Z0-9])/g;
// Initials and dotted initialisms ("J. Smith", "U.S. Bank", "E.U.") do not end a sentence either.
const isAbbreviation = (word: string) => {
  const w = word.toLowerCase().replace(/^\.+/, "");
  return ABBREVIATIONS.has(w) || /^[a-z]$/.test(w) || /^(?:[a-z]\.)+[a-z]$/.test(w);
};
const sentenceEnds = (text: string): number[] => [...text.matchAll(SENTENCE_END_CANDIDATE)]
  .filter((m) => !isAbbreviation(m[1]!))
  .map((m) => m.index! + m[0].length);

const lastIndexOf = (re: RegExp, text: string) => Math.max(-1, ...[...text.matchAll(re)].map((m) => m.index!));

const firstIndexOf = (re: RegExp, text: string) => {
  const hit = [...text.matchAll(re)][0];
  return hit ? hit.index! : -1;
};

// A validity in a predicate coordinated after another one ("The bid shall
// include a bid security and (shall) remain valid for 120 days"; "Bids must be
// accompanied by a bid security valid for 120 days and remain valid for 60
// days") belongs to the sentence's subject — the first one it names — not to
// whatever noun the earlier predicate mentioned last.
const COORDINATED_PREDICATE = /\band\s+(?:(?:shall|must|will|should|is\s+to|are\s+to)\s+(?:remain\s+|be\s+)?|remain\s+|be\s+)$/i;
// A sentence that opens with a pronoun ("It shall remain valid for 120 days")
// takes its subject from the sentence before ("The tender security is
// required.").
const PRONOUN_OPENING = /^\s*["“(]?(?:it|this|that|such|these|they|the\s+same)\b/i;

type Subject = "SECURITY" | "OFFER" | "NONE";
function subjectOf(lead: string, coordinated: boolean): Subject {
  if (coordinated) {
    const security = firstIndexOf(SECURITY_SUBJECT, lead);
    const offer = firstIndexOf(OFFER_SUBJECT, lead);
    if (security < 0 && offer < 0) return "NONE";
    return offer >= 0 && (security < 0 || offer < security) ? "OFFER" : "SECURITY";
  }
  const security = lastIndexOf(SECURITY_SUBJECT, lead);
  const offer = lastIndexOf(OFFER_SUBJECT, lead);
  if (security < 0 && offer < 0) return "NONE";
  return security > offer ? "SECURITY" : "OFFER";
}

// How far back a sentence is looked for. Only a bound on the work done: a
// sentence is read from its own start ("The bid security shall be issued by a
// reputable bank acceptable to the employer and shall remain valid for 120
// days" names the security over 80 characters before the figure).
const MAX_SENTENCE = 1_000;

/**
 * True when the validity period matched at `index` (`length` characters) in
 * `text` belongs to a security, guarantee, bond, insurance or warranty rather
 * than to the offer. The subject named nearest before the figure, within its
 * own sentence, decides.
 */
export function validityBelongsToSecurity(text: string, index: number, length: number): boolean {
  const start = Math.max(0, index - MAX_SENTENCE);
  const window = text.slice(start, index + length);
  // A sentence end is recognised by what follows it, so look into the match.
  const ends = sentenceEnds(window).filter((end) => end <= index - start);
  const sentenceStart = Math.max(0, ...ends);
  const lead = window.slice(sentenceStart);
  const coordinated = COORDINATED_PREDICATE.test(text.slice(Math.max(start + sentenceStart, index - 40), index));
  const subject = subjectOf(lead, coordinated);
  if (subject !== "NONE" || !PRONOUN_OPENING.test(lead)) return subject === "SECURITY";
  // A pronoun-led sentence with no subject of its own: the previous sentence's.
  const previousStart = Math.max(0, ...ends.filter((end) => end < sentenceStart));
  return subjectOf(window.slice(previousStart, sentenceStart), false) === "SECURITY";
}

/** The sentence around `index`, for quoting where a figure came from. */
export function sentenceAround(text: string, index: number, length: number): string {
  const start = Math.max(0, ...sentenceEnds(text.slice(0, index + length)).filter((end) => end <= index));
  const end = /[.!?](?=\s|$)/.exec(text.slice(index + length));
  return text.slice(start, end ? index + length + end.index + 1 : text.length).trim();
}
