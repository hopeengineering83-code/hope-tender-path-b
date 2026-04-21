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

export function buildMatches(
  requirements: RequirementDraft[],
  knowledge: CompanyKnowledgeSnapshot,
): MatchingResult {
  const requirementTokens = tokenize(requirements.map((req) => `${req.description} ${req.title}`).join(" "));

  const expertMatches = knowledge.experts
    .map((expert) => {
      const expertTokens = tokenize([
        expert.fullName,
        expert.title,
        expert.profile,
        ...(expert.disciplines ?? []),
        ...(expert.sectors ?? []),
        ...(expert.certifications ?? []),
      ].join(" "));
      const score = overlapScore(requirementTokens, expertTokens);
      return {
        expertId: expert.id,
        score,
        rationale: score > 0 ? "Expert discipline overlap detected against tender requirement language." : "No strong overlap detected yet.",
        evidenceSummary: [expert.title, ...(expert.disciplines ?? [])].filter(Boolean).join(" · "),
        isSelected: false,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((match, index) => ({ ...match, isSelected: index < 3 && match.score > 0 }));

  const projectMatches = knowledge.projects
    .map((project) => {
      const projectTokens = tokenize([
        project.name,
        project.clientName,
        project.country,
        project.sector,
        project.summary,
        ...(project.serviceAreas ?? []),
      ].join(" "));
      const score = overlapScore(requirementTokens, projectTokens);
      return {
        projectId: project.id,
        score,
        rationale: score > 0 ? "Project service and sector overlap detected against tender requirement language." : "No strong project overlap detected yet.",
        evidenceSummary: [project.sector, ...(project.serviceAreas ?? [])].filter(Boolean).join(" · "),
        isSelected: false,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((match, index) => ({ ...match, isSelected: index < 5 && match.score > 0 }));

  return {
    expertMatches,
    projectMatches,
  };
}
