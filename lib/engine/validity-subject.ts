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
// A figure is the offer's only when the tender says so: the offer is named
// on the validity ("Proposal validity: 90 days", "the validity of the bids",
// "Validity: 60 days for the proposal"),
// or is the subject it is predicated of ("Bids shall remain valid for 90
// days", "The bid shall be signed and remain valid for 90 days" when no
// security is named before the "and"). A security named right after the
// figure ("120 days for the bid security") makes it the security's. Any other
// validity — a security's, a licence's, a pronoun's ("It shall remain valid"),
// a bare "Validity: 90 days" — is not read as the offer's: a reader then
// reports it as not stated rather than risk promising some other period. Fail
// closed, never open.

const SECURITY_WORD = /\b(?:securit(?:y|ies)|securing\s+declaration|guarantees?|bonds?|insurance|warrant(?:y|ies)|EMD|earnest\s+money(?:\s+deposit)?)\b/i;
// The offer, or its prices ("Prices quoted shall remain valid", "bid prices",
// "rates quoted") — never a bare "rate", which may be an exchange rate.
const OFFER_NOUN = String.raw`(?:(?:(?:quoted|offered|tendered|bid|proposal|offer)\s+(?:prices?|rates?))|prices?(?:\s+(?:quoted|offered|tendered))?|rates?\s+(?:quoted|offered|tendered)|proposals?|bids?|offers?|tenders?|quotations?)(?!\s+(?:securit|securing|guarantee|bond))`;
const MODALS = String.raw`(?:(?:shall|must|will|should|is|are|to)\s+){1,2}(?:remain\s+|be\s+)?`;
// "Proposal validity: 90 days", "bid validity period of 75 days".
const OFFER_LABEL_BEFORE = new RegExp(String.raw`\b${OFFER_NOUN}\s+$`, "i");
const OFFER_LABEL_IN_MATCH = new RegExp(String.raw`^${OFFER_NOUN}\s+valid`, "i");
// "Validity of the bids: 90 days", "validity period for proposals".
const OFFER_OF_IN_MATCH = new RegExp(String.raw`^valid(?:ity)?(?:\s+period)?\s+(?:of|for)\s+(?:(?:the|each|all|any)\s+)?${OFFER_NOUN}\b`, "i");
// "Proposals shall remain valid", "The offer shall be valid", "Offers are valid".
const OFFER_SUBJECT_BEFORE = new RegExp(String.raw`\b${OFFER_NOUN}\s+${MODALS}$`, "i");
// A sentence whose subject is the offer ("Bids must …", "The bid shall …").
const OFFER_OPENING = new RegExp(String.raw`^\s*["“(]?(?:(?:the|each|every|all|any|a|an)\s+)?${OFFER_NOUN}\s+(?:shall|must|will|should|is|are)\b`, "i");
// "… and (shall) remain valid for N days": a predicate coordinated after another.
const COORDINATED_PREDICATE = /\band\s+(?:(?:shall|must|will|should|is\s+to|are\s+to)\s+(?:remain\s+|be\s+)?|remain\s+|be\s+)$/i;
// "120 days for the bid security", "… of the performance guarantee": a security
// named in a phrase directly after the figure.
const SECURITY_QUALIFIER = new RegExp(String.raw`^\s*(?:for|of|on|under|covering)\s+(?:(?:the|its|a|an|any|each|such)\s+)?(?:[A-Za-z-]+\s+){0,2}?` + SECURITY_WORD.source, "i");
// "60 days for the proposal", "… of all bids": the offer named right after it.
const OFFER_QUALIFIER = new RegExp(String.raw`^\s*(?:for|of)\s+(?:(?:the|its|a|an|any|each|all|every)\s+)?${OFFER_NOUN}\b`, "i");

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
 * in `text` is positively the offer's (see the rules above). Any other
 * validity, and any attribution that is not clear, is not.
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
  const after = text.slice(index + length, index + length + 120);
  if (SECURITY_QUALIFIER.test(after)) return false;
  if (OFFER_QUALIFIER.test(after)) return true;
  // The offer named on the validity, or the subject it is predicated of.
  if (OFFER_LABEL_IN_MATCH.test(match) || OFFER_OF_IN_MATCH.test(match) || OFFER_LABEL_BEFORE.test(before) || OFFER_SUBJECT_BEFORE.test(before)) return true;
  // A coordinated predicate of a sentence whose subject is the offer — unless
  // a security named before it could be what it is predicated of ("a bid
  // security, which shall be issued by a bank and remain valid").
  if (COORDINATED_PREDICATE.test(before) && OFFER_OPENING.test(sentence) && !SECURITY_WORD.test(before)) return true;
  return false;
}

/** The sentence around `index`, for quoting where a figure came from. */
export function sentenceAround(text: string, index: number, length: number): string {
  const start = Math.max(0, ...sentenceEnds(text.slice(0, index + length)).filter((end) => end <= index));
  // The same sentence ends as above ("Jan. 2027" does not end one).
  const end = sentenceEnds(text.slice(index + length))[0];
  return text.slice(start, end === undefined ? text.length : index + length + end).trim();
}
