import type { RequirementDraft } from "./types";

export type ScopeRequirement = Pick<
  RequirementDraft,
  "title" | "description" | "requirementType" | "priority" | "requiredQuantity" | "exactFileName" | "exactOrder" | "restrictions"
>;

function textFor(requirement: ScopeRequirement): string {
  return [
    requirement.title,
    requirement.description,
    requirement.requirementType,
    requirement.priority,
    requirement.exactFileName ?? "",
    requirement.restrictions ?? "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function allText(requirements: ScopeRequirement[]): string {
  return requirements.map(textFor).join("\n");
}

function hasExplicitQuantityLanguage(requirement: ScopeRequirement, type: string): boolean {
  const text = textFor(requirement);
  if (type === "EXPERT") {
    return /(?:minimum|at\s+least|not\s+less\s+than|no\.\s*of|required|shall\s+provide|must\s+provide|key\s+experts?|experts?\s+required|personnel\s+required|team\s+composition|composition\s+of\s+team)\s*(?:of|:)?\s*\d{1,2}|\d{1,2}\s+(?:key\s+)?(?:experts?|specialists?|personnel|staff|professionals)\b/i.test(text);
  }
  if (type === "PROJECT_EXPERIENCE") {
    return /(?:minimum|at\s+least|not\s+less\s+than|required|shall\s+provide|must\s+provide|similar\s+(?:projects?|assignments?)|project\s+references?|references?\s+required)\s*(?:of|:)?\s*\d{1,2}|\d{1,2}\s+(?:similar\s+)?(?:projects?|assignments?|references?|contracts?)\b/i.test(text);
  }
  return false;
}

/**
 * Returns the explicit tender selection count for experts/projects.
 *
 * Important: do NOT sum quantities across extracted/strategic requirement rows.
 * A long tender can mention page numbers, section numbers, points, years, rows,
 * and individual CV/project criteria many times. Summing those rows creates fake
 * requirements such as 139 experts or 13 projects. A real tender count is the
 * single strongest explicit quantity found in wording like "minimum 3 experts"
 * or "at least 2 similar projects".
 */
export function exactSelectionLimit(requirements: ScopeRequirement[], type: string): number {
  const relevant = requirements.filter((requirement) => requirement.requirementType === type);
  if (relevant.length === 0) return 0;

  const explicit = relevant
    .filter((requirement) => (requirement.requiredQuantity ?? 0) > 0)
    .filter((requirement) => hasExplicitQuantityLanguage(requirement, type))
    .map((requirement) => requirement.requiredQuantity ?? 0)
    .filter((quantity) => quantity > 0 && quantity <= 50);

  return explicit.length > 0 ? Math.max(...explicit) : 0;
}

export function hasAmbiguousQuantity(requirement: ScopeRequirement): boolean {
  if (!["EXPERT", "PROJECT_EXPERIENCE"].includes(requirement.requirementType)) return false;
  if (requirement.requiredQuantity && requirement.requiredQuantity > 0 && hasExplicitQuantityLanguage(requirement, requirement.requirementType)) return false;
  const text = textFor(requirement);
  return /(expert|key personnel|specialist|cv|curriculum vitae|staff|project reference|similar experience|past performance|portfolio)/i.test(text);
}

export function requiresGeneratedArtifact(requirement: ScopeRequirement): boolean {
  const text = textFor(requirement);
  if (requirement.exactFileName || requirement.exactOrder) return true;
  if (["FORM", "DECLARATION", "ANNEX", "SCHEDULE"].includes(requirement.requirementType)) return true;
  if (requirement.requirementType === "COMPANY_PROFILE") return /company profile|firm profile|profile document/.test(text);
  if (requirement.requirementType === "METHODOLOGY") return /methodology|technical approach|work plan|execution plan|technical proposal/.test(text);
  if (requirement.requirementType === "EXPERT") return /\bcv\b|curriculum vitae|personnel form|staff form|expert form|key personnel schedule/.test(text);
  if (requirement.requirementType === "PROJECT_EXPERIENCE") return /project reference|reference sheet|similar experience|past performance|portfolio|experience form/.test(text);
  return /proposal|submission file|separate file|attachment|template|document required|must submit|shall submit/.test(text);
}

export function forbidsBranding(requirements: ScopeRequirement[]): boolean {
  return /no\s+(company\s+)?(logo|letterhead|branding|stamp|seal)|without\s+(company\s+)?(logo|letterhead|branding|stamp|seal)|plain\s+template|do\s+not\s+(use|include)\s+(company\s+)?(logo|letterhead|branding|stamp|seal)/i.test(allText(requirements));
}

export function forbidsCoverPage(requirements: ScopeRequirement[]): boolean {
  return /no\s+cover\s+page|without\s+a?\s*cover\s+page|do\s+not\s+include\s+(a\s+)?cover\s+page/i.test(allText(requirements));
}

export function requiresCoverPage(requirements: ScopeRequirement[]): boolean {
  const text = allText(requirements);
  return /cover page|required cover|title page|front page/i.test(text) && !forbidsCoverPage(requirements);
}

export function requiresSignatureOrStamp(requirements: ScopeRequirement[]): boolean {
  return /signature|signed|stamp|seal|company seal/i.test(allText(requirements));
}

export function normalizeSubmissionFileName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (/\.[a-z0-9]{2,5}$/i.test(trimmed)) return trimmed;
  return `${trimmed}.docx`;
}
