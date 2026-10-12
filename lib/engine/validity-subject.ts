// Whose validity period a tender sentence states.
//
// A tender states several validity periods: the offer's ("proposals shall
// remain valid for 90 days") and a bid security's, guarantee's or bond's,
// usually longer ("the bid security shall be valid for 120 days"). Every
// reader of the offer's validity — the tender detail extractors and the
// pricing estimate — took the first "valid … N days" in the text, so a
// security stated first became the validity the financial proposal promised
// and the tender detail showed. This is the one rule they share.
//
// A figure is the offer's only on positive evidence: the offer named on the
// validity itself, the offer as the sentence's subject of a coordinated
// "… and remain valid", or a sentence (with, for a pronoun opening, the one
// before it) that names no security at all. Anything else is ambiguous and is
// not read as the offer's: a reader then reports the validity as not stated
// rather than risk promising a security's period. Fail closed, never open.

const SECURITY_WORD = /\b(?:securit(?:y|ies)|securing\s+declaration|guarantees?|bonds?|insurance|warrant(?:y|ies)|EMD|earnest\s+money(?:\s+deposit)?)\b/i;
const OFFER_NOUN = String.raw`(?:proposals?|bids?|offers?|tenders?|quotations?)(?!\s+(?:securit|securing|guarantee|bond))`;
// "Proposal validity: 90 days", "bid validity period of 75 days".
const OFFER_LABEL_BEFORE = new RegExp(String.raw`\b${OFFER_NOUN}\s+$`, "i");
const OFFER_LABEL_IN_MATCH = new RegExp(String.raw`^${OFFER_NOUN}\s+valid`, "i");
// "Proposals shall remain valid", "The offer shall be valid", "Offers are valid".
const OFFER_SUBJECT_BEFORE = new RegExp(String.raw`\b${OFFER_NOUN}\s+(?:(?:shall|must|will|should|is|are|to)\s+){1,2}(?:remain\s+|be\s+)?$`, "i");
// A sentence whose subject is the offer ("Bids must …", "The bid shall …").
const OFFER_OPENING = new RegExp(String.raw`^\s*["“(]?(?:(?:the|each|every|all|any|a|an)\s+)?${OFFER_NOUN}\s+(?:shall|must|will|should|is|are)\b`, "i");
// "… and (shall) remain valid for N days": a predicate coordinated after another.
const COORDINATED_PREDICATE = /\band\s+(?:(?:shall|must|will|should|is\s+to|are\s+to)\s+(?:remain\s+|be\s+)?|remain\s+|be\s+)$/i;
// A sentence opening with a pronoun or possessive takes its subject from the one before.
const PRONOUN_OPENING = /^\s*["“(]?(?:its?|this|that|such|these|those|they|their|the\s+same)\b/i;

// Only a full stop, exclamation or question mark followed by the start of a
// new sentence ends one — never one closing a common abbreviation, a month, an
// initial or a dotted initialism ("Ltd.", "No.", "Jan.", "J.", "U.S."). A new
// sentence starts with a capital, or with a clause number before one ("2.1
// Validity"); a bare figure ("31 Jan. 2027 and …") continues the sentence. A
// semicolon does not end one, and neither does a line break: extracted PDF
// text wraps mid-sentence. Every doubt keeps the sentence whole, so a
// security named in it is never cut off from its validity.
const ABBREVIATIONS = new Set([
  "ltd", "co", "inc", "plc", "corp", "llc", "no", "nos", "art", "sec", "cl", "para", "e.g", "i.e", "etc",
  "mr", "mrs", "ms", "dr", "eng", "st", "vs", "approx",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);
const SENTENCE_END_CANDIDATE = /([A-Za-z.]*)[.!?](?=\s+(?:\d+(?:\.\d+)*[.)]?\s+)?["“(]?[A-Z])/g;
const isAbbreviation = (word: string) => {
  const w = word.toLowerCase().replace(/^\.+/, "");
  return ABBREVIATIONS.has(w) || /^[a-z]$/.test(w) || /^(?:[a-z]\.)+[a-z]$/.test(w);
};
const sentenceEnds = (text: string): number[] => [...text.matchAll(SENTENCE_END_CANDIDATE)]
  .filter((m) => !isAbbreviation(m[1]!))
  .map((m) => m.index! + m[0].length);

// How far back a sentence is looked for. Only a bound on the work done.
const MAX_SENTENCE = 1_000;

/**
 * True only when the validity period matched at `index` (`length` characters)
 * in `text` is positively the offer's (see the rules above). A security's,
 * guarantee's or bond's validity, and any attribution that is not clear, is
 * not.
 */
export function isOfferValidity(text: string, index: number, length: number): boolean {
  const start = Math.max(0, index - MAX_SENTENCE);
  const window = text.slice(start, index + length);
  // A sentence end is recognised by what follows it, so look into the match.
  const ends = sentenceEnds(window).filter((end) => end <= index - start);
  const sentenceStart = Math.max(0, ...ends);
  const sentence = window.slice(sentenceStart);
  const before = window.slice(sentenceStart, index - start);
  const match = text.slice(index, index + length);

  // The offer named on the validity itself.
  if (OFFER_LABEL_IN_MATCH.test(match) || OFFER_LABEL_BEFORE.test(before) || OFFER_SUBJECT_BEFORE.test(before)) return true;
  // A coordinated predicate of a sentence whose subject is the offer.
  if (COORDINATED_PREDICATE.test(before) && OFFER_OPENING.test(sentence)) return true;
  // Otherwise only a sentence that names no security (nor, when it opens with
  // a pronoun, does the sentence before it).
  if (SECURITY_WORD.test(sentence)) return false;
  if (PRONOUN_OPENING.test(sentence)) {
    const previousStart = Math.max(0, ...ends.filter((end) => end < sentenceStart));
    if (SECURITY_WORD.test(window.slice(previousStart, sentenceStart))) return false;
  }
  return true;
}

/** The sentence around `index`, for quoting where a figure came from. */
export function sentenceAround(text: string, index: number, length: number): string {
  const start = Math.max(0, ...sentenceEnds(text.slice(0, index + length)).filter((end) => end <= index));
  // The same sentence ends as above ("Jan. 2027" does not end one).
  const end = sentenceEnds(text.slice(index + length))[0];
  return text.slice(start, end === undefined ? text.length : index + length + end).trim();
}
