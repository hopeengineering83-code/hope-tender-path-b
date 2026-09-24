/**
 * What an expert's OWN CV text supports.
 *
 * An expert record carries structured tags (disciplines, sectors) and the CV's
 * full text (`profile`). On a real vault the tags are firm-wide boilerplate:
 * all 28 experts of one firm carry "Architecture" and "Healthcare", so any
 * claim derived from them — "this person worked on that hospital", "this
 * person uses Revit" — is the same claim for everybody and true for few.
 * These helpers answer from the CV text instead: a project is attributed to a
 * person only when their CV names it, and software only when their CV lists
 * it. They return nothing rather than guess.
 */

// Words that name a kind of project rather than a particular one. A phrase made
// only of these ("Hospital Project") cannot tie a project to a CV.
const GENERIC_PROJECT_WORDS = new Set([
  "project", "projects", "hospital", "general", "building", "buildings", "construction", "design",
  "supervision", "center", "centre", "complex", "consolidated", "office", "phase", "works", "facility",
  "renovation", "rehabilitation", "feasibility", "study", "terrace", "commercial", "residential",
  "apartment", "hotel", "star", "blocks", "block", "master", "planning", "with", "from",
]);

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9ሀ-፿]+/).filter(Boolean);
}

function isDistinctive(word: string): boolean {
  return word.length >= 4 && !GENERIC_PROJECT_WORDS.has(word) && !/^\d+$/.test(word);
}

/**
 * A CV names a project when it contains a run of the project's own words that
 * identifies it: two distinctive words side by side ("abdul seid", "dessie
 * specialized"), or the whole name when the name has one. Scattered words
 * across a thirty-page CV do not count.
 */
function cvNamesProject(paddedCvWords: string, name: string): boolean {
  const nameWords = words(name);
  for (let len = nameWords.length; len >= 2; len -= 1) {
    for (let i = 0; i + len <= nameWords.length; i += 1) {
      const phrase = nameWords.slice(i, i + len);
      const distinctive = phrase.filter(isDistinctive).length;
      if (distinctive >= 2 || (len === nameWords.length && distinctive >= 1)) {
        if (paddedCvWords.includes(` ${phrase.join(" ")} `)) return true;
      }
    }
  }
  return false;
}

/** The projects, in the order given, that this person's own CV text names. */
export function projectsNamedInCv<P extends { name?: string | null }>(cvText: string | null | undefined, projects: readonly P[]): P[] {
  const cvWords = words(String(cvText ?? ""));
  if (cvWords.length === 0) return [];
  const padded = ` ${cvWords.join(" ")} `;
  return projects.filter((p) => cvNamesProject(padded, p.name ?? ""));
}

// Design and engineering software a CV may list. Matched as whole tokens.
const SOFTWARE_VOCABULARY = [
  "AutoCAD", "Civil 3D", "Revit", "ArchiCAD", "SketchUp", "Lumion", "3ds Max", "Rhino", "Navisworks",
  "ETABS", "SAP2000", "SAFE", "STAAD", "Tekla", "Robot",
  "ETAP", "DIALux", "EPANET", "WaterCAD", "SewerCAD", "HEC-RAS", "HEC-HMS",
  "ArcGIS", "QGIS", "Global Mapper",
  "Primavera", "MS Project", "Microsoft Project", "CostX",
];

/** The software this person's own CV text lists. */
export function softwareNamedInCv(cvText: string | null | undefined): string[] {
  const cv = String(cvText ?? "");
  if (!cv.trim()) return [];
  return SOFTWARE_VOCABULARY.filter((tool) =>
    new RegExp(`(^|[^a-z0-9])${tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(cv),
  );
}

// A professional registration as CVs print it: "PPA/1840", "PSNE/17891",
// "PEPCM/5718". A reference letter's number runs on ("DRE/021/25",
// "EHT/GM/057/2025") and is not one.
const REGISTRATION = /(?<![A-Za-z/])([A-Z]{2,8})\/(\d{3,6})(?![\/\d])/g;
const REGISTRATION_CONTEXT = /(?:professional\s+reg|reg(?:istration)?\.?\s*(?:no|number)|licen[cs]|construction\s+(?:works\s+regulatory\s+)?authority|practicing\s+professional|professional\s+(?:engineer|architect))/i;
const REFERENCE_CONTEXT = /\bref(?:erence)?\.?\s*(?:no\.?)?\s*:?\s*$/i;
const REGISTERED_TITLE = /((?:Practicing\s+)?(?:Professional|Licensed)\s+(?:[A-Z][a-z]+\s+){0,3}(?:Engineer|Architect|Planner|Surveyor)(?:\s*\([A-Z]{1,5}\))?(?:\s+in\s+[A-Z][a-z]+(?:\s+(?!Reg\b|No\b)[A-Z][a-z]+){0,2})?|(?:[A-Z][a-z]+\s+){1,2}(?:Engineer|Architect))(?:[\s•·:.,()\-]|Reg(?:istration)?\b|No\b|Number\b|\([^)]{0,40}\)|\d{2}\/\d{2}\/\d{4}|G\.C\.)*$/;

/**
 * The professional registrations this person's own CV states, as
 * "Practicing Professional Architect (PPA/1840)", or the bare number when the
 * CV gives no title beside it. Expert records hold a certifications field that
 * is usually empty, and the proposal printed "—" in the licence column of every
 * row while the CVs carried the numbers.
 */
export function licencesNamedInCv(cvText: string | null | undefined): string[] {
  const cv = String(cvText ?? "").replace(/\s+/g, " ");
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of cv.matchAll(REGISTRATION)) {
    const number = `${match[1]}/${match[2]}`;
    if (seen.has(number)) continue;
    const before = cv.slice(Math.max(0, (match.index ?? 0) - 140), match.index ?? 0);
    if (REFERENCE_CONTEXT.test(before.slice(-20)) || !REGISTRATION_CONTEXT.test(before)) continue;
    seen.add(number);
    const title = before.match(REGISTERED_TITLE)?.[1]?.replace(/\s+/g, " ").trim();
    found.push(title ? `${title} (${number})` : `Reg. No. ${number}`);
  }
  return found.slice(0, 3);
}
