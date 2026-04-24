import type { CompanyKnowledgeSnapshot, MatchingResult, RequirementDraft } from "./types";

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

// Build IDF weights: tokens appearing in many docs are less informative
function buildIdf(corpus: string[][]): Map<string, number> {
  const docCount = corpus.length;
  const df = new Map<string, number>();
  for (const doc of corpus) {
    for (const token of new Set(doc)) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [token, count] of df) {
    idf.set(token, Math.log((docCount + 1) / (count + 1)) + 1);
  }
  return idf;
}

function tfidfScore(
  queryTokens: string[],
  docTokens: string[],
  idf: Map<string, number>,
): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;
  const docFreq = new Map<string, number>();
  for (const t of docTokens) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  let score = 0;
  for (const token of queryTokens) {
    if (!docFreq.has(token)) continue;
    const tf = (docFreq.get(token) ?? 0) / docTokens.length;
    const w = idf.get(token) ?? 1;
    score += tf * w;
  }
  return score / queryTokens.length;
}

function sectorBoost(tenderSector: string | null | undefined, items: string[]): number {
  if (!tenderSector) return 0;
  const tender = tenderSector.toLowerCase();
  for (const item of items) {
    if (item.toLowerCase().includes(tender) || tender.includes(item.toLowerCase())) return 0.15;
  }
  return 0;
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
  tenderSector?: string | null,
  tenderTitle?: string | null,
): MatchingResult {
  // Build weighted query from requirements (MANDATORY reqs count 3x)
  const priorityWeight: Record<string, number> = { MANDATORY: 3, SCORED: 2, INFORMATIONAL: 1 };
  const queryParts: string[] = [];
  for (const req of requirements) {
    const w = priorityWeight[req.priority] ?? 1;
    for (let i = 0; i < w; i++) queryParts.push(`${req.title} ${req.description}`);
  }
  if (tenderTitle) queryParts.push(tenderTitle, tenderTitle);
  const queryTokens = tokenize(queryParts.join(" "));

  // Token sets for IDF corpus
  const expertTokenSets = knowledge.experts.map((e) =>
    tokenize([e.fullName, e.title, e.profile, ...parseArr(e.disciplines), ...parseArr(e.sectors), ...parseArr(e.certifications)].join(" "))
  );
  const projectTokenSets = knowledge.projects.map((p) =>
    tokenize([p.name, p.clientName, p.country, p.sector, p.summary, ...parseArr(p.serviceAreas)].join(" "))
  );

  const idf = buildIdf([...expertTokenSets, ...projectTokenSets, queryTokens]);

  // Expert matching with TF-IDF + sector/experience bonuses
  const expertMatches = knowledge.experts
    .map((expert, idx) => {
      const docTokens = expertTokenSets[idx] ?? [];
      let score = tfidfScore(queryTokens, docTokens, idf);
      score += sectorBoost(tenderSector, parseArr(expert.sectors));
      if ((expert.yearsExperience ?? 0) >= 10) score += 0.10;
      else if ((expert.yearsExperience ?? 0) >= 5) score += 0.05;
      score = Math.min(1, score);

      const evidence = [expert.title, ...parseArr(expert.disciplines)].filter(Boolean).join(" · ");
      const overlap = [...new Set(docTokens.filter((t) => queryTokens.includes(t)))].slice(0, 4);
      const topMatches = overlap.join(", ");

      return {
        expertId: expert.id,
        score,
        rationale: score > 0.02
          ? `Matched on: ${topMatches || evidence}.${expert.yearsExperience ? ` ${expert.yearsExperience} yrs experience.` : ""}`
          : "Limited keyword overlap with this tender.",
        evidenceSummary: evidence || "No evidence summary",
        isSelected: false,
      };
    })
    .sort((a, b) => b.score - a.score);

  // Enforce required expert quantity
  const expertReq = requirements.find((r) => r.requirementType === "EXPERT" && r.requiredQuantity);
  const maxExperts = expertReq?.requiredQuantity ?? 3;
  let expertsSelected = 0;
  const expertMatchesFinal = expertMatches.map((m) => {
    if (m.score > 0.01 && expertsSelected < maxExperts) { expertsSelected++; return { ...m, isSelected: true }; }
    return m;
  });

  // Project matching with TF-IDF + sector/recency/value bonuses
  const projectMatches = knowledge.projects
    .map((project, idx) => {
      const docTokens = projectTokenSets[idx] ?? [];
      let score = tfidfScore(queryTokens, docTokens, idf);
      score += sectorBoost(tenderSector, [project.sector ?? "", ...parseArr(project.serviceAreas)]);

      if (project.endDate) {
        const ageYears = (Date.now() - new Date(project.endDate).getTime()) / (365.25 * 24 * 3600 * 1000);
        if (ageYears < 3) score += 0.08;
        else if (ageYears < 5) score += 0.04;
      }
      if ((project.contractValue ?? 0) > 100000) score += 0.05;
      score = Math.min(1, score);

      const evidence = [project.sector, ...parseArr(project.serviceAreas)].filter(Boolean).join(" · ");
      const overlap = [...new Set(docTokens.filter((t) => queryTokens.includes(t)))].slice(0, 4);
      const topMatches = overlap.join(", ");

      return {
        projectId: project.id,
        score,
        rationale: score > 0.02
          ? `Matched on: ${topMatches || evidence}.${project.contractValue ? ` Contract: ${project.currency ?? "USD"} ${project.contractValue.toLocaleString()}.` : ""}`
          : "Limited project overlap with this tender.",
        evidenceSummary: evidence || "No evidence summary",
        isSelected: false,
      };
    })
    .sort((a, b) => b.score - a.score);

  const projectReq = requirements.find((r) => r.requirementType === "PROJECT_EXPERIENCE" && r.requiredQuantity);
  const maxProjects = projectReq?.requiredQuantity ?? 5;
  let projectsSelected = 0;
  const projectMatchesFinal = projectMatches.map((m) => {
    if (m.score > 0.01 && projectsSelected < maxProjects) { projectsSelected++; return { ...m, isSelected: true }; }
    return m;
  });

  return { expertMatches: expertMatchesFinal, projectMatches: projectMatchesFinal };
}
