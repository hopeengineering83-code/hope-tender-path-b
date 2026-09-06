/**
 * What of a source-verified vault text field may be shown to a client.
 *
 * THE DELIVERED DEFECT
 * --------------------
 * Hosted run 34038487418 shipped this as the opening of a named expert's
 * biography, under "A.5.1 Principal Qualifications — Detailed Bios":
 *
 *   "Profile. HOPE URBAN PLANNING ARCHITECTURAL AND ENGINEERING CONSULTANCY
 *    PLC ENG. AHMED KEBEDE TEKAW General Manager & Practicing Professional
 *    Engineer Structural Engineer · Geotechnical Engineer · Project Manager
 *    Major Projects | 5 International | 11+ Years Experience General Manager &
 *    Practicing Professional Engineer Hope Urban Planning Architectural and
 *    Engineering Consultancy Ahmed Kebede Tekaw Languages Amharic (Excellent),
 *    English…"
 *
 * That is the CV's letterhead and header card, read straight off the source
 * document: the firm's name twice, the person's name twice, their title twice,
 * a run of label headings, and a cut mid-list. It is not a biography, and an
 * evaluator reads it as a document the bidder did not check.
 *
 * The same run's "Key Technical Contribution" column carried the reference
 * letter's own bookkeeping — "Ref: …/1591/18 Date: 19/01/2018 E.C. Author:
 * Tariku Abebaw (Building Officer, Gimba…" — which is provenance the app keeps
 * to prove the record, not something a client is asked to read.
 *
 * WHY THE FIX BELONGS HERE
 * ------------------------
 * These fields are source-verified and immutable: provenanceMatchesCurrentRecord()
 * hashes each verified value and requires it to still equal what was verified
 * against the source document, so trimming one character in the record breaks
 * generation outright. Nothing here touches a record. This is the rendering
 * boundary — it decides what part of a stored value is shown, and declines to
 * show a value that is document furniture rather than prose.
 *
 * Declining is the point. A bio the firm cannot support in prose is better
 * absent than printed as a letterhead dump; the structured lines around it —
 * disciplines, sectors, years, project mapping — carry the same facts in a form
 * the evaluator can actually score.
 */

/** Bookkeeping the app keeps to prove a record, never written for a reader. */
const PROVENANCE_LABEL_RX =
  /\b(?:Ref(?:erence)?\s*(?:no\.?|number)?|Date|Author|Signed\s+by|Issued\s+by|Tel(?:ephone)?|Phone|Mobile|E-?mail|Contact(?:\s+person)?)\s*[:：]/i;

/** Label headings off a CV's header card. */
const CV_CARD_LABEL_RX =
  /\b(?:Languages|Software\s+Skills|Countries\s+of\s+Work|Total\s+Professional\s+Experience|Major\s+Projects|Nationality|Date\s+of\s+Birth|Membership|Key\s+Qualifications)\b\s*[:：]?/gi;

/** A numbered CV section heading: "2. EDUCATION, TRAINING & …". */
const CV_SECTION_HEADING_RX =
  /\b\d+\s*\.\s*(?:PERSONNEL\s+INFORMATION|EDUCATION[^.]{0,40}|EMPLOYMENT\s+RECORD|WORK\s+EXPERIENCE|LANGUAGE\s+SKILLS|REFERENCES?)\b/gi;

/** Three or more shouting words in a row: letterhead, not a sentence. */
const SHOUTY_RUN_RX = /(?:\b[A-Z][A-Z&.()'’\-]{1,}\b(?:\s+|$)){3,}/g;

/**
 * Strip source-document furniture from a stored value before it is shown.
 *
 * Keeps whatever real content precedes the furniture: a project summary that
 * opens with the project's own description and then runs into the reference
 * letter's bookkeeping keeps the description.
 */
export function withoutSourceProvenance(text: string | null | undefined): string {
  if (!text) return "";
  let value = text.replace(/\s+/g, " ").trim();

  // Provenance runs to the end of the value, so cut there rather than trying to
  // pick individual labels out of it.
  const provenance = value.search(PROVENANCE_LABEL_RX);
  if (provenance > 0) value = value.slice(0, provenance);
  else if (provenance === 0) value = "";

  value = value
    .replace(CV_SECTION_HEADING_RX, " ")
    .replace(CV_CARD_LABEL_RX, " ")
    .replace(SHOUTY_RUN_RX, " ");

  return value
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:.\-–—|·]+/, "")
    .replace(/[\s,;:\-–—|·]+$/, "")
    .trim();
}

/**
 * A sentence needs a subject and a verb; this cannot check for those, so it
 * checks the two things that separated every delivered furniture dump from
 * every delivered paragraph: furniture has no finished sentence, and it shouts.
 */
/**
 * Words that hold a sentence together. A written paragraph is full of them; a
 * header card — "General Manager & Practicing Professional Engineer Structural
 * Engineer · Project Manager | 5 International | 11+ Years Experience" — is a
 * list of noun phrases and has almost none. Measured on the values the delivered
 * proposal actually carried, this separates the two cleanly where counting
 * capitals and full stops did not: the CV dump ends "(since July 2015 G.C.)",
 * which looks like a finished sentence, and a label card reads "Position:
 * Senior Electrical Engineer. English, Amharic." with a full stop per fragment.
 */
const FUNCTION_WORD_RX =
  /\b(?:is|are|was|were|be|been|has|have|had|will|would|shall|should|can|may|the|a|an|of|in|on|at|to|for|from|with|by|as|and|or|but|this|that|these|those|which|who|whose|his|her|their|our|its|we|he|she|they|it|not|than|then|when|where|while|during|through|across|between|within|under|over|after|before|each|every|all|both|also|more|most|some|only|because|so|such|into|about|against|per)\b/gi;

function readsAsProse(text: string, minLength: number): boolean {
  if (text.length < minLength) return false;
  if (!/[.!?](?:\s|$)/.test(text)) return false;
  // Card separators. Prose does not use them.
  if (/[|·•]/.test(text)) return false;
  const words = text.match(/\b[A-Za-z][A-Za-z&.'’\-]*\b/g) ?? [];
  if (words.length < 12) return false;
  const shouted = words.filter((word) => word.length > 1 && word === word.toUpperCase()).length;
  if (shouted / words.length > 0.25) return false;
  // A header card repeats the person's name or title verbatim.
  if (hasRepeatedPhrase(words, 4)) return false;
  const functionWords = (text.match(FUNCTION_WORD_RX) ?? []).length;
  if (functionWords / words.length < 0.1) return false;
  // "Label Value Label Value" reads as a card even in mixed case.
  const labelPairs = (text.match(/\b[A-Z][A-Za-z ]{2,24}\s*[:：]/g) ?? []).length;
  const sentenceEnds = (text.match(/[.!?](?:\s|$)/g) ?? []).length;
  return !(labelPairs >= 2 && labelPairs > sentenceEnds);
}

/** Does any run of `size` consecutive words occur more than once? */
function hasRepeatedPhrase(words: string[], size: number): boolean {
  if (words.length < size * 2) return false;
  const seen = new Set<string>();
  for (let i = 0; i + size <= words.length; i += 1) {
    const phrase = words.slice(i, i + size).join(" ").toLowerCase();
    if (seen.has(phrase)) return true;
    seen.add(phrase);
  }
  return false;
}

/**
 * The prose of a stored profile, or an empty string when the stored value is
 * document furniture rather than a biography.
 */
export function proseProfileOrEmpty(text: string | null | undefined, minLength = 80): string {
  const cleaned = withoutSourceProvenance(text);
  return readsAsProse(cleaned, minLength) ? cleaned : "";
}

/**
 * Cut trailing fragments a truncation leaves behind: an unclosed bracket, a
 * dangling conjunction, a label with nothing after it. A delivered proposal
 * ended cells at "(Building Officer, Gimba…", "2. EDUCATION, TRAINING &…" and
 * "Sectors: …", each of which reads as a broken document rather than a
 * shortened one.
 */
export function tidyTruncation(text: string): string {
  let value = text.replace(/…\s*$/, "").trimEnd();
  // Drop a trailing unclosed parenthetical.
  const open = (value.match(/\(/g) ?? []).length;
  const close = (value.match(/\)/g) ?? []).length;
  if (open > close) {
    const lastOpen = value.lastIndexOf("(");
    if (lastOpen > 0) value = value.slice(0, lastOpen).trimEnd();
  }
  // A label with nothing under it says less than no label at all, and a cut
  // cell can end on several of them in a row ("Disciplines: Sectors: "). The
  // colon has to be stripped after the label it belongs to, not before it.
  let previous: string;
  do {
    previous = value;
    value = value.replace(/\s*\b[A-Z][A-Za-z ]{2,24}\s*[:：]\s*$/, "").trimEnd();
  } while (value !== previous);
  value = value
    .replace(/\s+(?:and|or|&|with|for|of|the|a|an|in|on|to|by|from)$/i, "")
    .replace(/[\s,;:\-–—|·]+$/, "")
    .trimEnd();
  return value ? `${value}…` : "";
}

/**
 * A stored value shown in a facts column rather than as a paragraph.
 *
 * A table cell listing qualifications does not need to read as prose — "MSc
 * Electrical Engineering, hospital MEP design" is exactly what an evaluator
 * wants there. What it must not carry is the source document's letterhead, its
 * provenance, or the header card's habit of repeating the person's own name and
 * title back at itself, which is what put "— DR. ENG. KEMAL MOHAMMED ZEINU
 * Senior Environmental & Electrical Expert (PhD) HOPE URBAN PLANNING … Senior
 * Environmental & Electrical Expert Hope Urban Planning Architectural and
 * Engineering…" into a delivered sector-experience column.
 */
export function factualCardOrEmpty(text: string | null | undefined): string {
  const cleaned = withoutSourceProvenance(text);
  if (!cleaned) return "";
  const words = cleaned.match(/\b[A-Za-z][A-Za-z&.'’\-]*\b/g) ?? [];
  if (hasRepeatedPhrase(words, 4)) return "";
  const shouted = words.filter((word) => word.length > 1 && word === word.toUpperCase()).length;
  if (words.length > 0 && shouted / words.length > 0.25) return "";
  return cleaned;
}
