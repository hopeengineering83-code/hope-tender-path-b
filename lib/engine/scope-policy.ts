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

export function matchingRequirements(requirements: ScopeRequirement[], type: string): ScopeRequirement[] {
  return requirements.filter((requirement) => requirement.requirementType === type);
}

export function exactSelectionLimit(requirements: ScopeRequirement[], type: string): number {
  const relevant = matchingRequirements(requirements, type);
  if (relevant.length === 0) return 0;

  const explicitQuantity = relevant.reduce((sum, requirement) => sum + (requirement.requiredQuantity ?? 0), 0);
  return explicitQuantity > 0 ? explicitQuantity : 0;
}

export function hasAmbiguousQuantity(requirement: ScopeRequirement): boolean {
  if (!["EXPERT", "PROJECT_EXPERIENCE"].includes(requirement.requirementType)) return false;
  if (requirement.requiredQuantity && requirement.requiredQuantity > 0) return false;

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
  return /no\s+(company\s+)?(logo|letterhead|branding|stamp|seal)|without\s+(company\s+)?(logo|letterhead|branding|stamp|seal)|plain\s+template|do\s+not\s+(use|include)\s+(company\s+)?(logo|letterhead|branding|stamp|seal)/i.test(
    allText(requirements),
  );
}

export function requiresCoverPage(requirements: ScopeRequirement[]): boolean {
  const text = allText(requirements);
  return /cover page|required cover|title page|front page/i.test(text) && !forbidsCoverPage(requirements);
}

export function forbidsCoverPage(requirements: ScopeRequirement[]): boolean {
  return /no\s+cover\s+page|without\s+a?\s*cover\s+page|do\s+not\s+include\s+(a\s+)?cover\s+page/i.test(allText(requirements));
}

export function requiresSignatureOrStamp(requirements: ScopeRequirement[]): boolean {
  return /signature|signed|stamp|seal|company seal/i.test(allText(requirements));
}

export function normalizeSubmissionFileName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (/\.[a-z0-9]{2,5}$/i.test(trimmed)) return trimmed;
  return `${trimmed}.docx`;
}
