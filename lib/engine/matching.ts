import type { CompanyKnowledgeSnapshot, MatchingResult, RequirementDraft } from "./types";

function tokenize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

function overlapScore(source: string[], target: string[]) {
  if (source.length === 0 || target.length === 0) return 0;
  const targetSet = new Set(target);
  let hits = 0;
  for (const token of source) {
    if (targetSet.has(token)) hits += 1;
  }
  return hits / Math.max(source.length, target.length);
}

function parseArr(v: unknown): string[] {
  if (Array.isArray(v)) return v;
  try {
    return JSON.parse(v as string) as string[];
  } catch {
    return [];
  }
}

function getRequiredQuantity(requirements: RequirementDraft[], type: string, fallback: number): number {
  const qty = requirements
    .filter((req) => req.requirementType === type)
    .reduce((sum, req) => sum + (req.requiredQuantity ?? 0), 0);
  return qty > 0 ? qty : fallback;
}

export function buildMatches(
  requirements: RequirementDraft[],
  knowledge: CompanyKnowledgeSnapshot,
): MatchingResult {
  const requirementTokens = tokenize(requirements.map((req) => `${req.description} ${req.title}`).join(" "));
  const requiredExpertCount = getRequiredQuantity(requirements, "EXPERT", 3);
  const requiredProjectCount = getRequiredQuantity(requirements, "PROJECT_EXPERIENCE", 5);

  const expertMatches = knowledge.experts
    .map((expert) => {
      const expertTokens = tokenize([
        expert.fullName,
        expert.title,
        expert.profile,
        ...parseArr(expert.disciplines),
        ...parseArr(expert.sectors),
        ...parseArr(expert.certifications),
      ].join(" "));
      const score = overlapScore(requirementTokens, expertTokens);
      return {
        expertId: expert.id,
        score,
        rationale: score > 0
          ? "Expert discipline overlap detected against tender requirement language."
          : "No strong overlap detected yet.",
        evidenceSummary: [expert.title, ...parseArr(expert.disciplines)].filter(Boolean).join(" · "),
        isSelected: false,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((match, index) => ({ ...match, isSelected: index < requiredExpertCount && match.score > 0 }));

  const projectMatches = knowledge.projects
    .map((project) => {
      const projectTokens = tokenize([
        project.name,
        project.clientName,
        project.country,
        project.sector,
        project.summary,
        ...parseArr(project.serviceAreas),
      ].join(" "));
      const score = overlapScore(requirementTokens, projectTokens);
      return {
        projectId: project.id,
        score,
        rationale: score > 0
          ? "Project service and sector overlap detected against tender requirement language."
          : "No strong project overlap detected yet.",
        evidenceSummary: [project.sector, ...parseArr(project.serviceAreas)].filter(Boolean).join(" · "),
        isSelected: false,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((match, index) => ({ ...match, isSelected: index < requiredProjectCount && match.score > 0 }));

  return {
    expertMatches,
    projectMatches,
  };
}
