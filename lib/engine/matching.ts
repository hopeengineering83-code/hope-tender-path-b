import type { CompanyKnowledgeSnapshot, MatchingResult, RequirementDraft } from "./types";
import { exactSelectionLimit } from "./scope-policy";

const MATCHING_CYCLES = 5;

function tokenize(value: string | null | undefined): string[] {
  return (value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

function parseArr(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  try { return JSON.parse(v as string) as string[]; } catch { return []; }
}

function buildIdf(corpus: string[][]): Map<string, number> {
  const docCount = corpus.length;
  const df = new Map<string, number>();
  for (const doc of corpus) {
    for (const token of new Set(doc)) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [token, count] of df) idf.set(token, Math.log((docCount + 1) / (count + 1)) + 1);
  return idf;
}

function tfidfScore(queryTokens: string[], docTokens: string[], idf: Map<string, number>): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;
  const docFreq = new Map<string, number>();
  for (const t of docTokens) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  let score = 0;
  for (const token of queryTokens) {
    if (!docFreq.has(token)) continue;
    const tf = (docFreq.get(token) ?? 0) / docTokens.length;
    score += tf * (idf.get(token) ?? 1);
  }
  return score / queryTokens.length;
}

function sectorBoost(tenderSector: string | null | undefined, items: string[]): number {
  if (!tenderSector) return 0;
  const tender = tenderSector.toLowerCase();
  return items.some((item) => item.toLowerCase().includes(tender) || tender.includes(item.toLowerCase())) ? 0.15 : 0;
}

function reviewStatusPenalty(text: string | null | undefined): number {
  return text?.includes("REVIEW REQUIRED") ? -0.08 : 0.04;
}

function cycleQueryTokens(baseTokens: string[], cycle: number): string[] {
  if (cycle === 1) return baseTokens;
  if (cycle === 2) return [...baseTokens, ...baseTokens.filter((token) => token.length > 6)];
  if (cycle === 3) return baseTokens.filter((token) => !["shall", "must", "submit", "required", "proposal"].includes(token));
  if (cycle === 4) return [...baseTokens, ...baseTokens.slice(0, Math.ceil(baseTokens.length / 2))];
  return [...new Set(baseTokens)];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function selectTopExact<T extends { score: number; isSelected: boolean }>(matches: T[], limit: number): T[] {
  if (limit <= 0) return matches.map((m) => ({ ...m, isSelected: false }));
  let selected = 0;
  return matches.map((m) => {
    if (m.score > 0.01 && selected < limit) {
      selected += 1;
      return { ...m, isSelected: true };
    }
    return { ...m, isSelected: false };
  });
}

export function buildMatches(
  requirements: RequirementDraft[],
  knowledge: CompanyKnowledgeSnapshot,
  tenderSector?: string | null,
  tenderTitle?: string | null,
): MatchingResult {
  const priorityWeight: Record<string, number> = { MANDATORY: 3, SCORED: 2, INFORMATIONAL: 1 };
  const queryParts: string[] = [];
  for (const req of requirements) {
    const w = priorityWeight[req.priority] ?? 1;
    for (let i = 0; i < w; i += 1) queryParts.push(`${req.title} ${req.description}`);
  }
  if (tenderTitle) queryParts.push(tenderTitle, tenderTitle);
  const baseQueryTokens = tokenize(queryParts.join(" "));

  const expertTokenSets = knowledge.experts.map((e) =>
    tokenize([e.fullName, e.title, e.profile, ...parseArr(e.disciplines), ...parseArr(e.sectors), ...parseArr(e.certifications)].join(" ")),
  );
  const projectTokenSets = knowledge.projects.map((p) =>
    tokenize([p.name, p.clientName, p.country, p.sector, p.summary, ...parseArr(p.serviceAreas)].join(" ")),
  );
  const idf = buildIdf([...expertTokenSets, ...projectTokenSets]);

  const expertMatches = knowledge.experts
    .map((expert, idx) => {
      const docTokens = expertTokenSets[idx] ?? [];
      const cycleScores: number[] = [];
      for (let cycle = 1; cycle <= MATCHING_CYCLES; cycle += 1) {
        const queryTokens = cycleQueryTokens(baseQueryTokens, cycle);
        cycleScores.push(tfidfScore(queryTokens, docTokens, idf));
      }
      let score = average(cycleScores);
      score += sectorBoost(tenderSector, parseArr(expert.sectors));
      score += reviewStatusPenalty(expert.profile);
      if ((expert.yearsExperience ?? 0) >= 10) score += 0.10;
      else if ((expert.yearsExperience ?? 0) >= 5) score += 0.05;
      score = Math.max(0, Math.min(1, score));
      const evidence = [expert.title, ...parseArr(expert.disciplines)].filter(Boolean).join(" · ");
      const topMatches = [...new Set(docTokens.filter((t) => baseQueryTokens.includes(t)))].slice(0, 6).join(", ");
      return {
        expertId: expert.id,
        score,
        rationale: score > 0.02
          ? `5-cycle match. Matched on: ${topMatches || evidence || "source snippet/name"}.${expert.profile?.includes("REVIEW REQUIRED") ? " Draft record: review details before final use." : ""}${expert.yearsExperience ? ` ${expert.yearsExperience} yrs experience.` : ""}`
          : "Limited keyword overlap with this tender after 5 matching cycles.",
        evidenceSummary: evidence || (expert.profile?.includes("REVIEW REQUIRED") ? "Draft imported CV record; source snippet available in review page" : "No evidence summary"),
        isSelected: false,
      };
    })
    .sort((a, b) => b.score - a.score);

  const projectMatches = knowledge.projects
    .map((project, idx) => {
      const docTokens = projectTokenSets[idx] ?? [];
      const cycleScores: number[] = [];
      for (let cycle = 1; cycle <= MATCHING_CYCLES; cycle += 1) {
        const queryTokens = cycleQueryTokens(baseQueryTokens, cycle);
        cycleScores.push(tfidfScore(queryTokens, docTokens, idf));
      }
      let score = average(cycleScores);
      score += sectorBoost(tenderSector, [project.sector ?? "", ...parseArr(project.serviceAreas)]);
      score += reviewStatusPenalty(project.summary);
      if (project.endDate) {
        const ageYears = (Date.now() - new Date(project.endDate).getTime()) / (365.25 * 24 * 3600 * 1000);
        if (ageYears < 3) score += 0.08;
        else if (ageYears < 5) score += 0.04;
      }
      if ((project.contractValue ?? 0) > 100000) score += 0.05;
      score = Math.max(0, Math.min(1, score));
      const evidence = [project.sector, ...parseArr(project.serviceAreas)].filter(Boolean).join(" · ");
      const topMatches = [...new Set(docTokens.filter((t) => baseQueryTokens.includes(t)))].slice(0, 6).join(", ");
      return {
        projectId: project.id,
        score,
        rationale: score > 0.02
          ? `5-cycle match. Matched on: ${topMatches || evidence || "source snippet/name"}.${project.summary?.includes("REVIEW REQUIRED") ? " Draft record: review details before final use." : ""}${project.contractValue ? ` Contract: ${project.currency ?? "USD"} ${project.contractValue.toLocaleString()}.` : ""}`
          : "Limited project overlap with this tender after 5 matching cycles.",
        evidenceSummary: evidence || (project.summary?.includes("REVIEW REQUIRED") ? "Draft imported project record; source snippet available in review page" : "No evidence summary"),
        isSelected: false,
      };
    })
    .sort((a, b) => b.score - a.score);

  return {
    expertMatches: selectTopExact(expertMatches, exactSelectionLimit(requirements, "EXPERT")),
    projectMatches: selectTopExact(projectMatches, exactSelectionLimit(requirements, "PROJECT_EXPERIENCE")),
  };
}
