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
export const HEALTHCARE_WORK = /\bhospitals?\b|medical|clinic|specialty.*cent|health\s*(?:care|facilit|cent(?:er|re)s?|posts?|stations?|services?|institution|infrastructure)|\bpatients?\b|maternity|\bOPD\b|out-?patient|in-?patient|pharmac(?:y|ies)\b/i;
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

/** Supervision OF WORKS: "under the supervision of the client" is not this. */
const SUPERVISION_WORK = /\b(?:construction|site|works)\s+supervision\b|\bsupervis(?:e|es|ing|ion\s+of)\s+(?:the\s+)?(?:[\w-]+\s+){0,3}?(?:construction|works|contractors?)\b|\bresident\s+engineer|\bcontract\s+administration\b/i;
const DESIGN_WORK = /\b(?:architectural|structural|MEP|engineering|detailed|concept(?:ual)?|schematic|preliminary|building|interior)\s+design\b|\bdesign\s+(?:of\s+(?:a|an|the)\b|services\b|consultancy\b|and\s+(?:construction\s+)?supervision\b)|\b(?:architectural|structural|MEP)(?:\s*,\s*\w+)*(?:\s*,?\s*and\s+\w+)?\s+design\b/i;

/** True when the tender asks for supervision of construction works. */
export function assignmentIncludesSupervision(text: string | null | undefined): boolean {
  return SUPERVISION_WORK.test(assignmentSubjectText(text ?? ""));
}

/**
 * True when the assignment is supervision of works and not their design.
 *
 * The inferred sector label "Building Design & Construction Supervision"
 * covered both kinds of work, and the methodology chosen from it was the
 * supervision one for every building tender: a G+8 office DESIGN tender was
 * answered with site-inspection regimes, interim payment certificates and
 * variation orders (2026-10-05 tender-type matrix). Reads what the tender
 * asks for: supervision of works with no design work named. "Supervise the
 * works to the approved design" names no design work, so it stays supervision.
 */
export function isSupervisionOnlyAssignment(text: string | null | undefined): boolean {
  const subject = assignmentSubjectText(text ?? "");
  return SUPERVISION_WORK.test(subject) && !DESIGN_WORK.test(subject);
}

export const BUILDING_DESIGN_SECTOR = "Building Design";
export const BUILDING_SUPERVISION_SECTOR = "Building Construction Supervision";
export const BUILDING_DESIGN_AND_SUPERVISION_SECTOR = "Building Design & Construction Supervision";

/**
 * The building-work sector label for what the tender asks for. Every
 * builder keys on the label — work plan, risks, methodology, personnel — and
 * one combined label gave a design-only tender a supervision proposal.
 */
export function buildingSectorLabel(text: string | null | undefined): string {
  if (!assignmentIncludesSupervision(text)) return BUILDING_DESIGN_SECTOR;
  return isSupervisionOnlyAssignment(text) ? BUILDING_SUPERVISION_SECTOR : BUILDING_DESIGN_AND_SUPERVISION_SECTOR;
}

export function isBuildingSectorLabel(sector: string | null | undefined): boolean {
  return sector === BUILDING_DESIGN_SECTOR || sector === BUILDING_SUPERVISION_SECTOR || sector === BUILDING_DESIGN_AND_SUPERVISION_SECTOR;
}

/**
 * What kind of work the deliverables are, for the review and quality wording
 * that follows from it. A three-stage "schematic / developed / pre-issue"
 * design review was written into every proposal: a geotechnical
 * investigation, a structural condition assessment, a road-supervision
 * contract and a quantity-surveying service all promised floor plans and MEP
 * routing at 30% (2026-10-08 tender-type matrix).
 */
export type ReviewDiscipline = "DESIGN" | "SUPERVISION" | "STUDY" | "CONTRACT_ADMINISTRATION" | "GENERAL";

const CONTRACT_ADMIN_WORK = /\bquantity\s+survey(?:ing|ors?)?\b|\bcontract\s+administration\b|\bcost\s+(?:control|management|consultancy)\b|\bfinal\s+account\b/i;
const STUDY_WORK = /\b(?:geotechnical|soil|ground|site|condition|structural|traffic|topographic(?:al)?|baseline|household|socio-?economic)\s+(?:investigations?|assessments?|surveys?|audits?|appraisals?)\b|\b(?:pre-?)?feasibility\s+stud(?:y|ies)\b|\b(?:market|diagnostic|baseline)\s+stud(?:y|ies)\b|\bimpact\s+assessments?\b|\bESIA\b|\b(?:investigat|assess|audit)(?:e|es|ing)\s+the\s+(?:structural\s+)?(?:condition|ground|soil)\b/i;

function disciplineOfSubject(subject: string): ReviewDiscipline {
  if (DESIGN_WORK.test(subject)) return "DESIGN";
  if (CONTRACT_ADMIN_WORK.test(subject) && !/\b(?:construction|site|works)\s+supervision\b|\bresident\s+engineer\b/i.test(subject)) return "CONTRACT_ADMINISTRATION";
  if (SUPERVISION_WORK.test(subject)) return "SUPERVISION";
  // A study that also designs or supervises is not only a study.
  if (STUDY_WORK.test(subject) && !/\bdesign\b/i.test(subject)) return "STUDY";
  return "GENERAL";
}

/** The tender's title decides when it states the work; otherwise its text. */
export function reviewDisciplineOf(title: string | null | undefined, text?: string | null): ReviewDiscipline {
  const byTitle = disciplineOfSubject(assignmentSubjectText(title ?? ""));
  if (byTitle !== "GENERAL") return byTitle;
  return disciplineOfSubject(assignmentSubjectText(text ?? ""));
}

/** The three review stages, in the words that fit the work. */
export function threeStageReview(discipline: ReviewDiscipline): { name: string; stages: string; slashed: string } {
  switch (discipline) {
    case "DESIGN": return { name: "Three-stage design review", stages: "schematic, developed and pre-issue", slashed: "schematic / developed / pre-issue" };
    case "SUPERVISION": return { name: "Three-stage inspection review", stages: "inspection plan, works inspection and certification, and completion", slashed: "inspection plan / inspection and certification / completion" };
    case "STUDY": return { name: "Three-stage technical review", stages: "investigation programme, draft findings and final report", slashed: "investigation programme / draft findings / final report" };
    case "CONTRACT_ADMINISTRATION": return { name: "Three-stage cost review", stages: "cost baseline, interim valuation and final account", slashed: "cost baseline / interim valuation / final account" };
    default: return { name: "Three-stage review", stages: "inception, draft and pre-issue", slashed: "inception / draft / pre-issue" };
  }
}
