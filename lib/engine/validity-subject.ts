// Whose validity period a tender sentence states.
//
// A tender states several validity periods: the offer's ("proposals shall
// remain valid for 90 days") and a bid security's, guarantee's or bond's,
// usually longer ("the bid security shall be valid for 120 days"). Every
// reader of the offer's validity — the tender detail extractors and the
// pricing estimate — took the first "valid … N days" in the text, so a
// security stated first became the validity the financial proposal promised
// and the tender detail showed. This is the one rule they share.

const SECURITY_SUBJECT = /\b(?:securit(?:y|ies)|securing\s+declaration|guarantees?|bonds?|insurance|warrant(?:y|ies))\b/gi;
const OFFER_SUBJECT = /\b(?:proposals?|bids?|offers?|tenders?|quotations?)\b(?!\s+(?:securit|securing|guarantee|bond))/gi;
// Only a full stop, exclamation or question mark ends the context. A
// semicolon does not ("Bid security required; validity: 120 days" is the
// security's), and neither does a line break: extracted PDF text wraps
// mid-sentence ("the bid security shall be\nvalid for 120 days").
const SENTENCE_END = /[.!?](?=\s)/g;

const lastIndexOf = (re: RegExp, text: string) => Math.max(-1, ...[...text.matchAll(re)].map((m) => m.index!));

/**
 * True when the validity period matched at `index` (`length` characters) in
 * `text` belongs to a security, guarantee, bond, insurance or warranty rather
 * than to the offer. The subject named nearest before the figure, within its
 * own sentence and the 80 characters before the match, decides.
 */
export function validityBelongsToSecurity(text: string, index: number, length: number): boolean {
  const start = Math.max(0, index - 80);
  const before = text.slice(start, index);
  const sentenceStart = Math.max(0, ...[...before.matchAll(SENTENCE_END)].map((m) => m.index! + 1));
  const lead = before.slice(sentenceStart) + text.slice(index, index + length);
  return lastIndexOf(SECURITY_SUBJECT, lead) > lastIndexOf(OFFER_SUBJECT, lead);
}

/** The sentence around `index`, for quoting where a figure came from. */
export function sentenceAround(text: string, index: number, length: number): string {
  const before = text.slice(0, index);
  const start = Math.max(0, ...[...before.matchAll(SENTENCE_END)].map((m) => m.index! + 1));
  const end = /[.!?](?=\s|$)/.exec(text.slice(index + length));
  return text.slice(start, end ? index + length + end.index + 1 : text.length).trim();
}
