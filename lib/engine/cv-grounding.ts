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
