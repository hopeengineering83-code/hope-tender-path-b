// The single domain-signal vocabulary shared by requirement constraint
// derivation and evidence matching.
//
// WHY THIS EXISTS
// ---------------
// Two copies of this table used to live in two files, and they disagreed.
// lib/engine/requirement-constraints.ts derived domainTags from the tender's
// requirements with one set of patterns; lib/engine/matching.ts scored a
// candidate record against the same tags with a second, differently written
// set. Because `strictDomain` is true whenever any tag is derived, and a record
// scoring 0 against those tags is HARD-EXCLUDED (score forced to 0, never
// selectable), the two tables silently decided whether any evidence at all
// could be proposed.
//
// The observed failure: the `mining` pattern was /mining|extractive|quarry|
// mineral|ore/i, with no word boundary on `ore`. A rural water supply tender
// whose requirement reads "detailed engineering design of water supply schemes
// including boreholes, pumping mains, reservoirs and distribution networks"
// matched on the `ore` inside "b(ore)holes". The tender was classified mining,
// strict-domain filtering switched on, and all four source-verified water
// supply experts — including a Team Leader with 22 years in water supply, on a
// tender asking for fifteen — were hard-excluded to score 0. Generation then
// refused with NO_EXPERT_MATCHES_SELECTED — and since selection is automatic
// and Engine-owned, there was nothing the owner could do to overrule it. One
// unanchored three-letter alternation made the tender unfinishable.
//
// Every token short enough to appear inside an unrelated word is now anchored.
// "ore" also sits inside score, before, more, store, restore, shore, core and
// therefore; "ward" inside award and forward; "bts" inside doubts.

export type DomainTag =
  | "healthcare"
  | "telecom"
  | "ict"
  | "mining"
  | "education";

/**
 * Patterns applied to the TENDER's requirement text to decide which domains a
 * tender belongs to. Deriving a tag here switches on strict-domain filtering,
 * so these must only fire on unambiguous domain vocabulary.
 */
export const DOMAIN_TENDER_SIGNALS: Record<DomainTag, RegExp> = {
  healthcare: /\b(?:hospitals?|healthcare|health\s+care|medical|clinics?)\b/i,
  telecom: /\b(?:telecoms?|telecommunications?|fibre|fiber\s+optic|broadband|5g|4g)\b/i,
  ict: /\b(?:ict|software|information\s+systems?|information\s+technology|it\s+systems?|erp|crm|databases?|cyber\s?security|network\s+infrastructure|data\s+cent(?:er|re)|cloud\s+platform)\b/i,
  mining: /\b(?:mining|extractive|quarr(?:y|ies)|minerals?|ores?|tailings)\b/i,
  education: /\b(?:schools?|education|universit(?:y|ies)|colleges?|campus(?:es)?|classrooms?)\b/i,
};

/**
 * Patterns applied to a CANDIDATE RECORD's text (an expert profile, a project
 * reference) to decide whether it covers a tagged domain.
 *
 * Deliberately broader than the tender-side signals: a tender names its domain
 * once in formal language, while an expert profile evidences it through the
 * work described. Being broader here can only ever admit a record for review,
 * never exclude one, so the asymmetry is safe in the direction that matters.
 */
export const DOMAIN_RECORD_SIGNALS: Record<DomainTag, RegExp> = {
  healthcare: /\b(?:hospitals?|healthcare|health\s+care|medical|clinics?|wards?|pharmac(?:y|ies)|laborator(?:y|ies)|patients?)\b/i,
  telecom: /\b(?:telecoms?|telecommunications?|fibre|fiber|broadband|5g|4g|towers?|bts)\b/i,
  ict: /\b(?:ict|digital|software|platforms?|information\s+systems?|databases?|apis?|cloud)\b/i,
  mining: /\b(?:mining|extractive|quarr(?:y|ies)|minerals?|ores?|tailings)\b/i,
  education: /\b(?:schools?|education|universit(?:y|ies)|colleges?|campus(?:es)?|classrooms?)\b/i,
};

export const DOMAIN_TAGS = Object.keys(DOMAIN_TENDER_SIGNALS) as DomainTag[];

/** Tags a tender's requirement text carries. */
export function deriveDomainTags(text: string): DomainTag[] {
  return DOMAIN_TAGS.filter((tag) => DOMAIN_TENDER_SIGNALS[tag].test(text));
}

/**
 * Fraction of the tender's domain tags a candidate record evidences.
 *
 * Returns 0 for an empty tag list so callers can treat "no domain constraint"
 * and "no overlap" distinctly — only the latter should ever hard-exclude.
 */
export function domainTagMatchScore(domainTags: readonly string[], recordText: string): number {
  if (domainTags.length === 0) return 0;
  const matches = domainTags.filter((tag) => DOMAIN_RECORD_SIGNALS[tag as DomainTag]?.test(recordText));
  return matches.length / domainTags.length;
}
