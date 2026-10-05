// What the assignment IS, as opposed to the words that only sit near it.
// Sector and theme detection read assignmentSubjectText(), never raw text.

/**
 * The words that say what the assignment IS, with the words that only sit
 * near it removed. Sector and theme detection read this, never the raw text.
 *
 * 2026-10-05 hands-off acceptance: an architectural office-space EOI from a
 * global-health non-profit shipped a hospital proposal — clinical briefs, IPC
 * flow audits, medical-gas hold points, patient-flow simulation — because the
 * client's own mission statement said "health", and a "C.8 Hospitality &
 * Tourism Facilities" section because the document-collection address was
 * "behind The HUB Hotel". Neither describes the work. What is removed:
 *
 *  - landmarks in directions ("behind/near/opposite … Hotel/Hospital/…");
 *  - a labelled address value ("Physical Address …: …");
 *  - an organisation describing itself ("X is a global non-profit …",
 *    "Our mission is …") — that is who the client is, not what it is buying;
 *  - fixed phrases whose sector word is not a sector: "health and safety",
 *    "occupational health", "gifts and hospitality", "last resort".
 */
const LANDMARK_NOUN = "(?:hotel|hospital|clinic|health\\s+cent(?:er|re)|resort|lodge|guest\\s*house|school|college|university|church|mosque|cathedral|mall|plaza|bank|tower|building|stadium|square|market|station|airport|embassy|ministry|bureau|office)";
const LANDMARK = new RegExp(
  `\\b(?:behind|near|nearby|opposite|next\\s+to|adjacent\\s+to|beside|in\\s+front\\s+of|across\\s+from|close\\s+to|around|facing|off)\\s+(?:the\\s+)?(?:[A-Z0-9][\\w&'.-]*\\s+){0,5}${LANDMARK_NOUN}s?\\b`,
  "gi",
);
const LABELLED_ADDRESS = /\b(?:physical|postal|office|street|delivery|submission|mailing|collection)?\s*address(?:\s+(?:for|of)\s+[\w\s]{0,40}?)?\s*:\s*[^\n.;]{0,200}/gi;
const ORGANISATION_SELF_DESCRIPTION = /\b(?:is|are)\s+(?:a|an|the)\s+(?:[\w-]+\s+){0,5}(?:non-?profit|not-for-profit|NGO|non-governmental|charity|charitable|foundation|organi[sz]ation|institution|agency|team\s+of)\b|\b(?:our|its|their)\s+(?:mission|vision)\s+is\b|\b(?:dedicated|committed)\s+to\s+(?:achieving|advancing|improving|accelerating|ensuring)\b/i;
const NOT_A_SECTOR_PHRASE = /\b(?:environment(?:al)?,?\s+)?health\s*(?:,|and|&)\s*safety\b|\bsafety\s*(?:and|&)\s*health\b|\boccupational\s+health\b|\bgifts?,?\s*(?:and|or|&)\s*hospitality\b|\bhospitality\s*(?:and|or|&)\s*gifts?\b|\b(?:corporate\s+)?entertainment\s*(?:and|or|&)\s*hospitality\b|\blast\s+resort\b/gi;

export function assignmentSubjectText(text: string): string {
  if (!text) return "";
  const withoutPlaces = text.replace(LABELLED_ADDRESS, " ").replace(LANDMARK, " ");
  const sentences = withoutPlaces.split(/(?<=[.!?])\s+|\n+/);
  return sentences
    .filter((sentence) => !ORGANISATION_SELF_DESCRIPTION.test(sentence))
    .join("\n")
    .replace(NOT_A_SECTOR_PHRASE, " ");
}

/** Health WORK, not the word: bare "health" is in a health ministry's name,
 * a donor's mission and every "health and safety plan". */
export const HEALTHCARE_WORK = /hospital|medical|clinic|specialty.*cent|health\s*(?:care|facilit|cent(?:er|re)s?|posts?|stations?|services?|institution|infrastructure)|\bpatients?\b|maternity|\bOPD\b|out-?patient|in-?patient|pharmac(?:y|ies)\b/i;
/** Hospitality WORK: "lodge" alone is a verb and "last resort" is not a resort. */
export const HOSPITALITY_WORK = /\bhotels?\b|\bhospitality\s+(?:facilit|sector|industry|project|development|design|building)|\bresorts?\b|\b(?:eco|safari|game|tourist|mountain)[- ]?lodges?\b|\bguest\s*houses?\b|tourism\s+(?:facilit|development|infrastructure)/i;

/**
 * True when an inferred SECTOR LABEL is healthcare. The checks this replaces
 * tested /hospital/ against the label, and "Hospitality & Tourism" contains
 * "hospital": every hotel tender received the hospital work plan, IPC hold
 * points, clinical risks and medical-gas QA (2026-10-05).
 */
export function isHealthcareSector(sector: string | null | undefined): boolean {
  return /health|medical|clinic|radiology|pharmacy|biomedical|\bhospitals?\b/i.test(sector ?? "");
}
