/**
 * What an eligibility requirement is actually about.
 *
 * Tenders list very different things under "Eligibility": a valid business
 * licence, but also "availability of a multidisciplinary professional team",
 * "proven experience in designing healthcare facilities" and "strong
 * understanding of healthcare regulations". Matched by its category alone,
 * every one of them was answered with the firm's registration record, and the
 * proposal's own compliance matrix printed "Multidisciplinary Team — from
 * legal/registration record (PPA Supplier Registration Evidence) — FULLY MET"
 * (Pharo, hosted runs 2026-10-08 and 2026-10-10). A registration proves the
 * firm exists; it does not prove a team, a track record or an understanding.
 *
 * The subject is read from the requirement's own words. A requirement that
 * names a registration, licence, certificate or tax document stays a
 * registration requirement whatever else it says.
 */

export type EligibilitySubject = "REGISTRATION" | "TEAM" | "EXPERIENCE" | "UNDERSTANDING";

const REGISTRATION = /\b(?:registration|registered|licen[cs]e[ds]?|certificates?|certified|incorporat\w*|tax|vat|tin|good\s+standing|permits?|accredit\w*|grade|clearance)\b/i;
const TEAM = /\b(?:team|experts?|personnel|staff|specialists?|professionals|curriculum\s+vitae|cvs?)\b/i;
const EXPERIENCE = /\b(?:experience[ds]?|portfolio|track\s+record|similar\s+(?:projects?|assignments?|works?)|completed\s+(?:projects?|assignments?|works?)|references?)\b/i;
const UNDERSTANDING = /\b(?:understanding|knowledge|familiarity|awareness)\b/i;

export function eligibilitySubjectOf(text: string): EligibilitySubject {
  if (REGISTRATION.test(text)) return "REGISTRATION";
  if (TEAM.test(text)) return "TEAM";
  if (EXPERIENCE.test(text)) return "EXPERIENCE";
  if (UNDERSTANDING.test(text)) return "UNDERSTANDING";
  return "REGISTRATION";
}
