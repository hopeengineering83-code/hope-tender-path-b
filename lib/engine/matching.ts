import type { CompanyKnowledgeSnapshot, MatchingResult, RequirementDraft } from "./types";
import { exactSelectionLimit } from "./scope-policy";

const MATCHING_CYCLES = 20;
const SELECTION_THRESHOLD = 0.90;

type KnowledgeWithOptionalTrust = { trustLevel?: string | null };

type CapabilityFamily =
  | "WATER_SUPPLY"
  | "SOLAR_PUMPING"
  | "FEASIBILITY_DESIGN"
  | "SUPERVISION_CONTRACT"
  | "URBAN_MUNICIPAL"
  | "CIVIL_INFRASTRUCTURE"
  | "ELECTRO_MECHANICAL"
  | "GEOTECH_HYDROGEOLOGY"
  | "ENVIRONMENT_SOCIAL"
  | "PROJECT_MANAGEMENT"
  | "ARCHITECTURE_BUILDINGS"
  | "FINANCIAL_LEGAL";

const CAPABILITY_KEYWORDS: Record<CapabilityFamily, RegExp[]> = {
  WATER_SUPPLY: [/water/i, /supply/i, /sanitary/i, /hydraulic/i, /pipeline/i, /pipe/i, /borehole/i, /well/i, /drilling/i, /reservoir/i, /pump/i, /irrigation/i, /woreda/i, /kebele/i],
  SOLAR_PUMPING: [/solar/i, /pv/i, /photovoltaic/i, /pump/i, /pumping/i, /electromechanical/i, /electro/i, /mechanical/i, /power/i, /energy/i],
  FEASIBILITY_DESIGN: [/feasibility/i, /study/i, /fsdd/i, /detailed\s+design/i, /design/i, /assessment/i, /investigation/i, /survey/i, /drawing/i, /specification/i, /bill\s+of\s+quantity/i, /boq/i],
  SUPERVISION_CONTRACT: [/supervision/i, /construction\s+supervision/i, /contract\s+administration/i, /site/i, /quality\s+control/i, /resident/i, /inspection/i],
  URBAN_MUNICIPAL: [/urban/i, /municipal/i, /town/i, /city/i, /woreda/i, /kebele/i, /master\s+plan/i, /planning/i, /settlement/i],
  CIVIL_INFRASTRUCTURE: [/civil/i, /infrastructure/i, /road/i, /bridge/i, /drainage/i, /structure/i, /building/i, /rehabilitation/i, /establishment/i, /construction/i],
  ELECTRO_MECHANICAL: [/electrical/i, /mechanical/i, /electro/i, /mep/i, /pump/i, /generator/i, /power/i, /motor/i],
  GEOTECH_HYDROGEOLOGY: [/geotech/i, /geological/i, /hydrogeology/i, /soil/i, /foundation/i, /investigation/i, /drilling/i, /groundwater/i],
  ENVIRONMENT_SOCIAL: [/environment/i, /social/i, /safeguard/i, /climate/i, /esmp/i, /impact/i, /resettlement/i],
  PROJECT_MANAGEMENT: [/project\s+management/i, /team\s+leader/i, /coordination/i, /schedule/i, /programme/i, /work\s+plan/i, /planning/i, /reporting/i],
  ARCHITECTURE_BUILDINGS: [/architecture/i, /architectural/i, /building/i, /housing/i, /facility/i, /office/i, /hospital/i, /school/i],
  FINANCIAL_LEGAL: [/financial/i, /audit/i, /turnover/i, /registration/i, /license/i, /certificate/i, /tax/i, /legal/i, /vat/i, /tin/i],
};

function tokenize(value: string | null | undefined): string[] {
  return (value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

function parseArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  try {
    const parsed = JSON.parse(String(v ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function buildIdf(corpus: string[][]): Map<string, number> {
  const docCount = Math.max(corpus.length, 1);
  const df = new Map<string, number>();
  for (const doc of corpus) {
    for (const token of new Set(doc)) df.set(token, (df.get(token) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [token, count] of df) idf.set(token, Math.log((docCount + 1) / (count + 1)) + 1);
  return idf;
}

function cosineTfidf(queryTokens: string[], docTokens: string[], idf: Map<string, number>): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;

  const queryFreq = new Map<string, number>();
  for (const t of queryTokens) queryFreq.set(t, (queryFreq.get(t) ?? 0) + 1);

  const docFreq = new Map<string, number>();
  for (const t of docTokens) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);

  const allTokens = new Set([...queryFreq.keys(), ...docFreq.keys()]);

  let dot = 0;
  let qNorm = 0;
  let dNorm = 0;
  for (const token of allTokens) {
    const w = idf.get(token) ?? 1;
    const q = ((queryFreq.get(token) ?? 0) / queryTokens.length) * w;
    const d = ((docFreq.get(token) ?? 0) / docTokens.length) * w;
    dot += q * d;
    qNorm += q * q;
    dNorm += d * d;
  }

  const denom = Math.sqrt(qNorm) * Math.sqrt(dNorm);
  return denom === 0 ? 0 : dot / denom;
}

function capabilityFamilies(text: string): CapabilityFamily[] {
  return (Object.keys(CAPABILITY_KEYWORDS) as CapabilityFamily[]).filter((family) =>
    CAPABILITY_KEYWORDS[family].some((pattern) => pattern.test(text)),
  );
}

function capabilityScore(queryText: string, recordText: string, type: "expert" | "project"): number {
  const qFamilies = capabilityFamilies(queryText);
  const rFamilies = capabilityFamilies(recordText);
  if (qFamilies.length === 0 || rFamilies.length === 0) return 0;
  const shared = qFamilies.filter((family) => rFamilies.includes(family));
  const coverage = shared.length / Math.max(qFamilies.length, 1);
  const depth = shared.length / Math.max(rFamilies.length, 1);
  let score = coverage * 0.75 + depth * 0.25;

  // Senior-consultant equivalence: a firm with design/supervision/water/infra
  // experience can be strongly relevant even when wording is not identical.
  const broadInfra = ["WATER_SUPPLY", "FEASIBILITY_DESIGN", "SUPERVISION_CONTRACT", "CIVIL_INFRASTRUCTURE"] as CapabilityFamily[];
  const sharedBroadInfra = broadInfra.filter((family) => qFamilies.includes(family) && rFamilies.includes(family)).length;
  if (sharedBroadInfra >= 2) score += type === "project" ? 0.18 : 0.14;
  if (qFamilies.includes("SOLAR_PUMPING") && rFamilies.some((f) => ["ELECTRO_MECHANICAL", "WATER_SUPPLY", "SOLAR_PUMPING"].includes(f))) score += 0.16;
  if (qFamilies.includes("GEOTECH_HYDROGEOLOGY") && rFamilies.some((f) => ["GEOTECH_HYDROGEOLOGY", "WATER_SUPPLY", "FEASIBILITY_DESIGN"].includes(f))) score += 0.10;

  return Math.max(0, Math.min(1, score));
}

function sectorBoost(tenderSector: string | null | undefined, items: string[]): number {
  if (!tenderSector) return 0;
  const tender = tenderSector.toLowerCase();
  const itemText = items.join(" ").toLowerCase();
  if (!itemText) return 0;
  if (items.some((item) => item.toLowerCase().includes(tender) || tender.includes(item.toLowerCase()))) return 0.15;
  if (/urban|planning|infrastructure|water|sanitary|engineering|design|supervision/.test(tender) && /urban|planning|infrastructure|water|sanitary|engineering|design|supervision/.test(itemText)) return 0.12;
  return 0;
}

function trustLevelAdjustment(trustLevel: string | null | undefined): number {
  if (trustLevel === "REVIEWED") return 0.18;
  if (trustLevel === "AI_DRAFT") return -0.03;
  return -0.10;
}

function trustLevelLabel(trustLevel: string | null | undefined): string {
  if (trustLevel === "REVIEWED") return "✓ Reviewed";
  if (trustLevel === "AI_DRAFT") return "⚠ AI draft — review before final use";
  return "⚠ Regex draft — review required";
}

function cycleQueryTokens(baseTokens: string[], cycle: number): string[] {
  const stop = new Set(["shall", "must", "submit", "required", "proposal", "tender", "document", "provide", "include", "form"]);
  const unique = [...new Set(baseTokens)];
  const long = baseTokens.filter((token) => token.length >= 5);
  const domain = baseTokens.filter((token) => /(engineer|architect|planning|design|supervision|management|urban|road|water|structural|electrical|mechanical|project|expert|experience|consultancy|hospital|building|master|geotechnical|financial|legal|registration|methodology|construction|infrastructure|environmental|feasibility|solar|pump|borehole|hydraulic|sanitary)/i.test(token));
  const noStop = baseTokens.filter((token) => !stop.has(token));
  const firstHalf = baseTokens.slice(0, Math.ceil(baseTokens.length / 2));
  const secondHalf = baseTokens.slice(Math.floor(baseTokens.length / 2));

  switch (cycle) {
    case 1: return baseTokens;
    case 2: return [...baseTokens, ...long];
    case 3: return noStop;
    case 4: return [...baseTokens, ...firstHalf];
    case 5: return unique;
    case 6: return domain;
    case 7: return long;
    case 8: return [...secondHalf, ...baseTokens.slice(0, Math.ceil(baseTokens.length / 3))];
    case 9: return [...baseTokens, ...noStop.filter((token) => token.length >= 5)];
    case 10: return [...new Set(noStop)];
    case 11: return [...domain, ...domain, ...long];
    case 12: return [...firstHalf, ...domain];
    case 13: return [...secondHalf, ...domain];
    case 14: return baseTokens.filter((token) => /(expert|staff|cv|personnel|team|leader|specialist|engineer|architect|planner|experience|years|hydraulic|water|electrical|mechanical)/i.test(token));
    case 15: return baseTokens.filter((token) => /(project|reference|similar|assignment|portfolio|client|contract|completed|experience|sector|water|design|supervision|solar)/i.test(token));
    case 16: return [...unique, ...domain, ...noStop.slice(0, 20)];
    case 17: return noStop.filter((token) => token.length >= 6);
    case 18: return [...baseTokens.slice(0, 15), ...baseTokens.slice(-15), ...domain];
    case 19: return [...baseTokens, ...domain, ...domain, ...noStop.filter((token) => token.length >= 6)];
    case 20: return [...new Set([...domain, ...long, ...noStop])];
    default: return unique;
  }
}

function selectedLimit(requirements: RequirementDraft[], type: string, available: number): number {
  const exact = exactSelectionLimit(requirements, type);
  if (exact > 0) return Math.min(exact, available);
  const relevant = requirements.filter((r) => r.requirementType === type);
  if (relevant.length > 0) return Math.min(available, type === "EXPERT" ? 8 : 10);
  return Math.min(available, type === "EXPERT" ? 6 : 8);
}

function selectAboveThreshold<T extends { score: number; isSelected: boolean }>(matches: T[], limit: number): T[] {
  if (limit <= 0) return matches.map((m) => ({ ...m, isSelected: false }));

  let selected = 0;
  return matches.map((m) => {
    if (m.score >= SELECTION_THRESHOLD && selected < limit) {
      selected += 1;
      return { ...m, isSelected: true };
    }
    return { ...m, isSelected: false };
  });
}

function optionalTrust(item: KnowledgeWithOptionalTrust): string | null | undefined {
  return item.trustLevel;
}

function seniorScore(params: {
  cosine: number;
  capability: number;
  sector: number;
  trust: number;
  experience: number;
  valueOrRecency: number;
  hasRealText: boolean;
}): number {
  const base = params.capability >= 0.72
    ? (params.capability * 0.62 + params.cosine * 0.20 + params.sector + params.trust + params.experience + params.valueOrRecency)
    : (params.capability * 0.42 + params.cosine * 0.35 + params.sector + params.trust + params.experience + params.valueOrRecency);
  const evidenceConfidence = params.hasRealText ? 0.06 : -0.08;
  return Math.max(0, Math.min(1, base + evidenceConfidence));
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
  if (tenderSector) queryParts.push(tenderSector);
  const queryText = queryParts.join(" ");
  const baseQueryTokens = tokenize(queryText);

  const expertTexts = knowledge.experts.map((e) => [e.fullName, e.title, e.profile, ...parseArr(e.disciplines), ...parseArr(e.sectors), ...parseArr(e.certifications)].join(" "));
  const projectTexts = knowledge.projects.map((p) => [p.name, p.clientName, p.country, p.sector, p.summary, ...parseArr(p.serviceAreas)].join(" "));
  const expertTokenSets = expertTexts.map(tokenize);
  const projectTokenSets = projectTexts.map(tokenize);
  const idf = buildIdf([...expertTokenSets, ...projectTokenSets]);

  const expertMatches = knowledge.experts
    .map((expert, idx) => {
      const docTokens = expertTokenSets[idx] ?? [];
      let bestScore = 0;
      let bestCycle = 0;
      for (let cycle = 1; cycle <= MATCHING_CYCLES; cycle += 1) {
        const queryTokens = cycleQueryTokens(baseQueryTokens, cycle);
        const s = cosineTfidf(queryTokens, docTokens, idf);
        if (s > bestScore) { bestScore = s; bestCycle = cycle; }
      }
      const recordText = expertTexts[idx] ?? "";
      const trustLevel = optionalTrust(expert);
      const capability = capabilityScore(queryText, recordText, "expert");
      const sector = sectorBoost(tenderSector, parseArr(expert.sectors));
      const trust = trustLevelAdjustment(trustLevel);
      const experience = (expert.yearsExperience ?? 0) >= 15 ? 0.12 : (expert.yearsExperience ?? 0) >= 10 ? 0.10 : (expert.yearsExperience ?? 0) >= 5 ? 0.05 : 0;
      const score = seniorScore({ cosine: bestScore, capability, sector, trust, experience, valueOrRecency: 0, hasRealText: docTokens.length > 8 });
      const evidence = [expert.title, ...parseArr(expert.disciplines), ...parseArr(expert.sectors)].filter(Boolean).join(" · ");
      const topMatches = [...new Set(docTokens.filter((t) => baseQueryTokens.includes(t)))].slice(0, 8).join(", ");
      const families = capabilityFamilies(recordText).join(", ");
      const trustLabel = trustLevelLabel(trustLevel);
      const thresholdLabel = score >= SELECTION_THRESHOLD ? "Auto-selected ≥90%." : "Below 90%; review only.";
      return {
        expertId: expert.id,
        score,
        rationale: `[${trustLabel}] 100-expert style broad-fit score using ${MATCHING_CYCLES} interpretation cycles; winning lexical cycle ${bestCycle}. ${thresholdLabel} Capability families: ${families || "general consultancy"}. Keywords: ${topMatches || evidence || "general professional profile"}.${expert.yearsExperience ? ` ${expert.yearsExperience} yrs experience.` : ""}`,
        evidenceSummary: evidence || "No disciplines/sectors recorded — review the expert profile",
        isSelected: false,
      };
    })
    .sort((a, b) => {
      const aReviewed = a.rationale.includes("✓ Reviewed") ? 1 : 0;
      const bReviewed = b.rationale.includes("✓ Reviewed") ? 1 : 0;
      if (aReviewed !== bReviewed) return bReviewed - aReviewed;
      return b.score - a.score;
    });

  const projectMatches = knowledge.projects
    .map((project, idx) => {
      const docTokens = projectTokenSets[idx] ?? [];
      let bestScore = 0;
      let bestCycle = 0;
      for (let cycle = 1; cycle <= MATCHING_CYCLES; cycle += 1) {
        const queryTokens = cycleQueryTokens(baseQueryTokens, cycle);
        const s = cosineTfidf(queryTokens, docTokens, idf);
        if (s > bestScore) { bestScore = s; bestCycle = cycle; }
      }
      const recordText = projectTexts[idx] ?? "";
      const trustLevel = optionalTrust(project);
      const capability = capabilityScore(queryText, recordText, "project");
      const sector = sectorBoost(tenderSector, [project.sector ?? "", ...parseArr(project.serviceAreas)]);
      const trust = trustLevelAdjustment(trustLevel);
      let recency = 0;
      if (project.endDate) {
        const ageYears = (Date.now() - new Date(project.endDate).getTime()) / (365.25 * 24 * 3600 * 1000);
        if (ageYears < 5) recency += 0.07;
        else if (ageYears < 10) recency += 0.03;
      }
      if ((project.contractValue ?? 0) > 100000) recency += 0.03;
      const score = seniorScore({ cosine: bestScore, capability, sector, trust, experience: 0, valueOrRecency: recency, hasRealText: docTokens.length > 8 });
      const evidence = [project.sector, ...parseArr(project.serviceAreas)].filter(Boolean).join(" · ");
      const topMatches = [...new Set(docTokens.filter((t) => baseQueryTokens.includes(t)))].slice(0, 8).join(", ");
      const families = capabilityFamilies(recordText).join(", ");
      const trustLabel = trustLevelLabel(trustLevel);
      const thresholdLabel = score >= SELECTION_THRESHOLD ? "Auto-selected ≥90%." : "Below 90%; review only.";
      return {
        projectId: project.id,
        score,
        rationale: `[${trustLabel}] 100-expert style broad-fit score using ${MATCHING_CYCLES} interpretation cycles; winning lexical cycle ${bestCycle}. ${thresholdLabel} Capability families: ${families || "general project profile"}. Keywords: ${topMatches || evidence || "general project profile"}.${project.contractValue ? ` Contract: ${project.currency ?? "USD"} ${project.contractValue.toLocaleString()}.` : ""}`,
        evidenceSummary: evidence || "No service areas recorded — review the project record",
        isSelected: false,
      };
    })
    .sort((a, b) => {
      const aReviewed = a.rationale.includes("✓ Reviewed") ? 1 : 0;
      const bReviewed = b.rationale.includes("✓ Reviewed") ? 1 : 0;
      if (aReviewed !== bReviewed) return bReviewed - aReviewed;
      return b.score - a.score;
    });

  return {
    expertMatches: selectAboveThreshold(expertMatches, selectedLimit(requirements, "EXPERT", expertMatches.length)),
    projectMatches: selectAboveThreshold(projectMatches, selectedLimit(requirements, "PROJECT_EXPERIENCE", projectMatches.length)),
  };
}
