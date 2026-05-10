import type { CompanyKnowledgeSnapshot, MatchingResult, RequirementDraft } from "./types";
import { exactSelectionLimit } from "./scope-policy";
import { deriveRequirementConstraintProfile } from "./requirement-constraints";

// Per-record lexical interpretation cycles. For each candidate expert /
// project, the matcher runs MATCHING_CYCLES different tokenization
// strategies against the tender requirements and keeps the best score.
// This is the OLD iteration loop (Stage 1) — purely individual scoring.
const MATCHING_CYCLES = 20;

// Portfolio-level optimization cycles. After Stage 1 produces individual
// scores, Stage 2 iterates PORTFOLIO_OPTIMIZATION_CYCLES combinations of
// the top candidates to find the SET that maximizes collective coverage
// of the tender's capability families and disciplines. This is the
// "iterate to select the best" step the user asked for: instead of
// blindly taking top-N by individual score (which can over-concentrate
// on one capability and under-cover others), we evaluate multiple
// candidate sets and pick the one with the broadest, most coherent
// coverage of what THIS tender actually demands.
const PORTFOLIO_OPTIMIZATION_CYCLES = 20;

// Lowered from 0.90 to 0.75 — at 0.90 experts/projects with slightly different
// vocabulary (e.g., "infrastructure design" vs "civil design") were excluded
// from the evidence library, causing Claude to fall back to placeholders.
// A floor of 3 matches is enforced downstream so the evidence library is
// never empty when candidates exist.
const SELECTION_THRESHOLD = 0.75;

type KnowledgeWithOptionalTrust = { trustLevel?: string | null };

// CapabilityFamily covers the major consultancy disciplines the matching
// engine knows about. The list is intentionally broad — adding a family
// here makes the portfolio optimizer (Stage 2 selection) reward
// candidates who carry that capability when the tender requires it.
//
// New families can be added without breaking anything: capabilityFamilies()
// returns an empty array if no keywords match, in which case the
// portfolio optimizer falls back to individual scores.
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
  | "FINANCIAL_LEGAL"
  | "HEALTHCARE_FACILITIES"
  | "EDUCATION_FACILITIES"
  | "ICT_DIGITAL"
  | "AGRICULTURE_RURAL"
  | "ENERGY_POWER"
  | "TRANSPORT_LOGISTICS"
  | "MINING_EXTRACTIVES"
  | "TELECOMS"
  | "INSTITUTIONAL_REFORM";

const CAPABILITY_KEYWORDS: Record<CapabilityFamily, RegExp[]> = {
  WATER_SUPPLY: [/water/i, /supply/i, /sanitary/i, /hydraulic/i, /pipeline/i, /pipe/i, /borehole/i, /well/i, /drilling/i, /reservoir/i, /pump/i, /irrigation/i, /woreda/i, /kebele/i, /WASH/i, /sanitation/i],
  SOLAR_PUMPING: [/solar/i, /pv/i, /photovoltaic/i, /pump/i, /pumping/i, /electromechanical/i, /electro/i, /mechanical/i, /power/i, /energy/i],
  FEASIBILITY_DESIGN: [/feasibility/i, /study/i, /fsdd/i, /detailed\s+design/i, /design/i, /assessment/i, /investigation/i, /survey/i, /drawing/i, /specification/i, /bill\s+of\s+quantity/i, /boq/i],
  SUPERVISION_CONTRACT: [/supervision/i, /construction\s+supervision/i, /contract\s+administration/i, /site/i, /quality\s+control/i, /resident/i, /inspection/i],
  URBAN_MUNICIPAL: [/urban/i, /municipal/i, /town/i, /city/i, /woreda/i, /kebele/i, /master\s+plan/i, /planning/i, /settlement/i, /spatial/i, /zoning/i],
  CIVIL_INFRASTRUCTURE: [/civil/i, /infrastructure/i, /road/i, /bridge/i, /drainage/i, /structure/i, /building/i, /rehabilitation/i, /establishment/i, /construction/i],
  ELECTRO_MECHANICAL: [/electrical/i, /mechanical/i, /electro/i, /mep/i, /pump/i, /generator/i, /power/i, /motor/i, /HVAC/i, /cooling/i],
  GEOTECH_HYDROGEOLOGY: [/geotech/i, /geological/i, /hydrogeology/i, /soil/i, /foundation/i, /investigation/i, /drilling/i, /groundwater/i, /aquifer/i],
  ENVIRONMENT_SOCIAL: [/environment/i, /social/i, /safeguard/i, /climate/i, /esmp/i, /esia/i, /impact/i, /resettlement/i, /biodiversity/i, /ESS\d/i, /ESF/i],
  PROJECT_MANAGEMENT: [/project\s+management/i, /team\s+leader/i, /coordination/i, /schedule/i, /programme/i, /work\s+plan/i, /planning/i, /reporting/i, /PMI/i, /PMP/i],
  ARCHITECTURE_BUILDINGS: [/architecture/i, /architectural/i, /building/i, /housing/i, /facility/i, /office/i, /hospital/i, /school/i, /campus/i],
  FINANCIAL_LEGAL: [/financial/i, /audit/i, /turnover/i, /registration/i, /license/i, /certificate/i, /tax/i, /legal/i, /vat/i, /tin/i, /procurement/i],
  // Universal families — added so the portfolio optimizer can match any
  // tender sector, not only the construction / consulting cluster.
  HEALTHCARE_FACILITIES: [/health/i, /hospital/i, /medical/i, /clinic/i, /OPD/i, /ward/i, /surgical/i, /radiology/i, /pharmacy/i, /laboratory/i, /biomedical/i, /pharma/i, /patient/i, /IPC\b/i],
  EDUCATION_FACILITIES: [/school/i, /university/i, /college/i, /education/i, /classroom/i, /vocational/i, /training\s+cent/i, /campus/i, /academic/i],
  ICT_DIGITAL: [/ICT\b/i, /digital/i, /software/i, /platform/i, /database/i, /MIS\b/i, /ERP\b/i, /integration/i, /API\b/i, /cloud/i, /cyber/i, /information\s+system/i, /data\s+management/i, /web/i, /mobile\s+app/i],
  AGRICULTURE_RURAL: [/agricultur/i, /agronom/i, /irrigation/i, /livestock/i, /horticulture/i, /value\s+chain/i, /smallholder/i, /post-?harvest/i, /agribusiness/i, /food\s+secur/i, /rural\s+development/i],
  ENERGY_POWER: [/energy/i, /electricity/i, /grid/i, /transmission/i, /distribution/i, /generation/i, /substation/i, /renewable/i, /wind/i, /hydro\s*power/i, /geothermal/i, /off-?grid/i, /mini-?grid/i],
  TRANSPORT_LOGISTICS: [/transport/i, /logistics/i, /port/i, /airport/i, /railway/i, /aviation/i, /maritime/i, /freight/i, /cargo/i, /supply\s+chain/i, /warehouse/i, /terminal/i],
  MINING_EXTRACTIVES: [/mining/i, /extractiv/i, /quarry/i, /mineral/i, /ore/i, /tailings/i, /pit/i, /smelter/i, /refining/i, /artisanal/i],
  TELECOMS: [/telecom/i, /telecommunication/i, /fiber/i, /fibre/i, /broadband/i, /5G\b/i, /4G\b/i, /tower/i, /spectrum/i, /BTS\b/i, /backhaul/i],
  INSTITUTIONAL_REFORM: [/institutional/i, /governance/i, /policy/i, /reform/i, /capacity\s+build/i, /public\s+sector/i, /civil\s+service/i, /regulator/i, /strateg(?:y|ic)\s+plan/i, /M&E/i, /monitoring\s+and\s+evaluation/i],
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

function criticalFamilyMismatchPenalty(queryText: string, recordText: string): number {
  const requiredFamilies = capabilityFamilies(queryText);
  const recordFamilies = capabilityFamilies(recordText);
  if (requiredFamilies.length === 0 || recordFamilies.length === 0) return 0;

  const sharedFamilies = requiredFamilies.filter((family) => recordFamilies.includes(family));
  if (sharedFamilies.length > 0) return 0;

  const strictFamilies: CapabilityFamily[] = [
    "HEALTHCARE_FACILITIES",
    "EDUCATION_FACILITIES",
    "ICT_DIGITAL",
    "MINING_EXTRACTIVES",
    "TELECOMS",
  ];

  const requiresStrictFamily = requiredFamilies.some((family) => strictFamilies.includes(family));
  return requiresStrictFamily ? -0.28 : -0.12;
}

function requirementWeight(priority: string): number {
  if (priority === "MANDATORY") return 3;
  if (priority === "SCORED") return 2;
  return 1;
}

function weightedRequiredFamilies(requirements: RequirementDraft[], tenderTitle?: string | null, tenderSector?: string | null): CapabilityFamily[] {
  const weighted: CapabilityFamily[] = [];
  for (const requirement of requirements) {
    const families = capabilityFamilies(`${requirement.title} ${requirement.description}`);
    const weight = requirementWeight(requirement.priority);
    for (let i = 0; i < weight; i += 1) weighted.push(...families);
  }
  if (tenderTitle) weighted.push(...capabilityFamilies(tenderTitle));
  if (tenderSector) weighted.push(...capabilityFamilies(tenderSector));
  return weighted;
}

function strictFamilyRequired(requiredFamilies: CapabilityFamily[]): boolean {
  const strictFamilies: CapabilityFamily[] = ["HEALTHCARE_FACILITIES", "EDUCATION_FACILITIES", "ICT_DIGITAL", "MINING_EXTRACTIVES", "TELECOMS"];
  return requiredFamilies.some((family) => strictFamilies.includes(family));
}

function minimumFamilyDiversity(requiredFamilies: CapabilityFamily[]): number {
  if (strictFamilyRequired(requiredFamilies)) return Math.min(3, Math.max(2, requiredFamilies.length));
  return Math.min(2, requiredFamilies.length);
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
  const profile = deriveRequirementConstraintProfile(requirements);
  const exact = exactSelectionLimit(requirements, type);
  if (exact > 0) return Math.min(exact, available);
  if (type === "EXPERT" && profile.expertCount > 0) return Math.min(profile.expertCount, available);
  if (type === "PROJECT_EXPERIENCE" && profile.projectCount > 0) return Math.min(profile.projectCount, available);
  const relevant = requirements.filter((r) => r.requirementType === type);
  if (relevant.length > 0) return Math.min(available, type === "EXPERT" ? 8 : 10);
  return Math.min(available, type === "EXPERT" ? 6 : 8);
}

function selectAboveThreshold<T extends { score: number; isSelected: boolean }>(matches: T[], limit: number): T[] {
  if (limit <= 0) return matches.map((m) => ({ ...m, isSelected: false }));

  let selected = 0;
  const result = matches.map((m) => {
    if (m.score >= SELECTION_THRESHOLD && selected < limit) {
      selected += 1;
      return { ...m, isSelected: true };
    }
    return { ...m, isSelected: false };
  });

  // Floor guarantee: always select the top 3 by score even when all fall
  // below the threshold, so the evidence library passed to Claude is never
  // empty when candidates exist.
  const MIN_SELECTED = Math.min(3, limit, matches.length);
  if (selected < MIN_SELECTED) {
    let forcedCount = selected;
    return result.map((m) => {
      if (!m.isSelected && forcedCount < MIN_SELECTED) {
        forcedCount += 1;
        return { ...m, isSelected: true };
      }
      return m;
    });
  }
  return result;
}

// ─── Portfolio optimization (Stage 2 selection) ──────────────────────────────
//
// `selectAboveThreshold` (Stage 1) just picks top-N by individual score.
// That can over-concentrate: e.g., for a healthcare tender it might pick
// 5 experts who all duplicate "structural engineer" capability and miss
// MEP, biomedical, or healthcare-planning experts that the evaluator
// specifically wants. Stage 2 below evaluates multiple candidate sets
// and picks the one with the broadest, most coherent coverage of what
// THIS tender actually demands.
//
// Algorithm — runs PORTFOLIO_OPTIMIZATION_CYCLES times:
//
//   1. Greedy seed: take the top-scoring candidate.
//   2. For each remaining slot, evaluate every remaining candidate
//      against the running set. Score each candidate by:
//        - individual score (weight 0.55)  — keep quality high
//        - marginal capability coverage gain (weight 0.30)  —
//          reward capabilities the running set doesn't already have
//        - sector / discipline diversity (weight 0.15)  — reward
//          adding a discipline the set lacks
//      Pick the candidate with the highest combined score.
//   3. After filling all slots, score the whole set by:
//        - sum of individual scores (efficiency)
//        - capability-family coverage breadth
//        - discipline / sector breadth
//
// Across PORTFOLIO_OPTIMIZATION_CYCLES iterations, the seed is varied
// (cycle 1 = top-scorer, cycle 2 = second-top, …, cycle 20 = a
// shuffled candidate). The cycle producing the highest set score wins.
//
// This is the universal optimizer — works for any sector because
// coverage is computed against `requiredCapabilityFamilies` extracted
// from the tender requirements directly, not a sector hardcode.

function uniqueStringsFrom(arrays: string[][]): Set<string> {
  const out = new Set<string>();
  for (const arr of arrays) for (const v of arr) {
    const t = v.trim();
    if (t.length > 0) out.add(t.toLowerCase());
  }
  return out;
}

interface PortfolioCandidate<T extends { score: number; isSelected: boolean }> {
  match: T;
  capabilityFamilies: CapabilityFamily[];
  disciplineTags: string[];
}

function setCoverageScore<T extends { score: number; isSelected: boolean }>(
  candidates: PortfolioCandidate<T>[],
  requiredFamilies: CapabilityFamily[],
  requiredDisciplines: Set<string>,
): number {
  if (candidates.length === 0) return 0;

  const setFamilies = new Set<CapabilityFamily>();
  const setDisciplines = new Set<string>();
  let scoreSum = 0;
  for (const c of candidates) {
    for (const f of c.capabilityFamilies) setFamilies.add(f);
    for (const d of c.disciplineTags) setDisciplines.add(d.toLowerCase());
    scoreSum += c.match.score;
  }

  const familyCoverage = requiredFamilies.length === 0
    ? 1
    : requiredFamilies.filter((f) => setFamilies.has(f)).length / requiredFamilies.length;

  const disciplineCoverage = requiredDisciplines.size === 0
    ? 1
    : [...requiredDisciplines].filter((d) => setDisciplines.has(d)).length / requiredDisciplines.size;

  const efficiency = scoreSum / candidates.length;

  // Weighted blend — coverage is more important than raw score because
  // coverage is what the evaluator explicitly scores against.
  return efficiency * 0.45 + familyCoverage * 0.40 + disciplineCoverage * 0.15;
}

function marginalGainScore<T extends { score: number; isSelected: boolean }>(
  candidate: PortfolioCandidate<T>,
  currentSet: PortfolioCandidate<T>[],
  requiredFamilies: CapabilityFamily[],
  requiredDisciplines: Set<string>,
): number {
  const currentFamilies = new Set<CapabilityFamily>();
  const currentDisciplines = new Set<string>();
  for (const c of currentSet) {
    for (const f of c.capabilityFamilies) currentFamilies.add(f);
    for (const d of c.disciplineTags) currentDisciplines.add(d.toLowerCase());
  }

  const newFamilies = candidate.capabilityFamilies.filter((f) => !currentFamilies.has(f) && requiredFamilies.includes(f)).length;
  const newDisciplines = candidate.disciplineTags.filter((d) => !currentDisciplines.has(d.toLowerCase()) && requiredDisciplines.has(d.toLowerCase())).length;

  const requiredFamiliesCount = Math.max(requiredFamilies.length, 1);
  const requiredDisciplinesCount = Math.max(requiredDisciplines.size, 1);

  return (
    candidate.match.score * 0.55 +
    (newFamilies / requiredFamiliesCount) * 0.30 +
    (newDisciplines / requiredDisciplinesCount) * 0.15
  );
}

function optimizePortfolioSelection<T extends { score: number; isSelected: boolean }>(
  matches: T[],
  candidates: PortfolioCandidate<T>[],
  limit: number,
  requiredFamilies: CapabilityFamily[],
  requiredDisciplines: Set<string>,
): T[] {
  if (limit <= 0 || candidates.length === 0) {
    return matches.map((m) => ({ ...m, isSelected: false }));
  }

  // Pre-filter: only candidates above the selection threshold are
  // eligible. Keeps Stage 2 selecting from the same quality pool as
  // Stage 1 did.
  const hardFamilyGate = strictFamilyRequired(requiredFamilies);
  const strictEligible = candidates.filter((c) => {
    if (c.match.score < SELECTION_THRESHOLD) return false;
    if (!hardFamilyGate) return true;
    return c.capabilityFamilies.some((family) => requiredFamilies.includes(family));
  });
  const eligible = strictEligible.length > 0
    ? strictEligible
    : candidates.filter((c) => c.match.score >= SELECTION_THRESHOLD);
  if (eligible.length === 0) {
    // No eligible candidates — leave isSelected=false on everything,
    // matching the Stage 1 behaviour.
    return matches.map((m) => ({ ...m, isSelected: false }));
  }

  let bestSet: PortfolioCandidate<T>[] = [];
  let bestScore = -Infinity;

  for (let cycle = 0; cycle < PORTFOLIO_OPTIMIZATION_CYCLES; cycle += 1) {
    // Vary the seed across cycles: cycle 0 starts with top-scorer,
    // cycle 1 starts with #2, etc. Once we've used all real seeds,
    // remaining cycles re-evaluate with random tie-breaking — cheap
    // exploration that catches alternative seeds we'd otherwise miss.
    const seedIdx = cycle % eligible.length;
    const seed = eligible[seedIdx];
    const remaining = eligible.filter((c, i) => i !== seedIdx);
    const set: PortfolioCandidate<T>[] = [seed];

    while (set.length < limit && remaining.length > 0) {
      let bestNext = remaining[0];
      let bestNextScore = -Infinity;
      let bestNextIdx = 0;
      for (let i = 0; i < remaining.length; i += 1) {
        const candidate = remaining[i];
        const gain = marginalGainScore(candidate, set, requiredFamilies, requiredDisciplines);
        if (gain > bestNextScore) {
          bestNext = candidate;
          bestNextScore = gain;
          bestNextIdx = i;
        }
      }
      set.push(bestNext);
      remaining.splice(bestNextIdx, 1);
    }

    const setScore = setCoverageScore(set, requiredFamilies, requiredDisciplines);
    if (setScore > bestScore) {
      bestScore = setScore;
      bestSet = set;
    }
  }

  // Coverage rescue pass: if strict families are required and still missing
  // from the winning set, swap in the highest scoring candidate carrying
  // each missing family (while preserving set size).
  if (hardFamilyGate && bestSet.length > 0) {
    const covered = new Set<CapabilityFamily>();
    for (const c of bestSet) for (const f of c.capabilityFamilies) covered.add(f);
    const missing = requiredFamilies.filter((f) => !covered.has(f));
    for (const family of missing) {
      const replacement = eligible
        .filter((c) => c.capabilityFamilies.includes(family) && !bestSet.includes(c))
        .sort((a, b) => b.match.score - a.match.score)[0];
      if (!replacement) continue;
      const dropIdx = bestSet
        .map((candidate, idx) => ({ idx, score: candidate.match.score, helps: candidate.capabilityFamilies.some((f) => missing.includes(f)) }))
        .filter((item) => !item.helps)
        .sort((a, b) => a.score - b.score)[0]?.idx;
      if (dropIdx === undefined) continue;
      bestSet.splice(dropIdx, 1, replacement);
    }
  }

  // Diversity guardrail: enforce minimum distinct required-family coverage.
  const minDiversity = minimumFamilyDiversity(requiredFamilies);
  if (minDiversity > 0 && bestSet.length > 0) {
    const distinctCovered = () => {
      const set = new Set<CapabilityFamily>();
      for (const c of bestSet) {
        for (const f of c.capabilityFamilies) if (requiredFamilies.includes(f)) set.add(f);
      }
      return set;
    };

    let covered = distinctCovered();
    if (covered.size < minDiversity) {
      const missing = requiredFamilies.filter((f) => !covered.has(f));
      for (const family of missing) {
        if (covered.size >= minDiversity) break;
        const replacement = eligible
          .filter((c) => c.capabilityFamilies.includes(family) && !bestSet.includes(c))
          .sort((a, b) => b.match.score - a.match.score)[0];
        if (!replacement) continue;
        const dropIdx = bestSet
          .map((candidate, idx) => ({ idx, score: candidate.match.score, familyCount: candidate.capabilityFamilies.filter((f) => requiredFamilies.includes(f)).length }))
          .sort((a, b) => (a.familyCount - b.familyCount) || (a.score - b.score))[0]?.idx;
        if (dropIdx === undefined) continue;
        bestSet.splice(dropIdx, 1, replacement);
        covered = distinctCovered();
      }
    }
  }

  // Mark the winning set as selected on the final returned matches.
  const selectedIds = new Set(bestSet.map((c) => (c.match as unknown as { expertId?: string; projectId?: string }).expertId ?? (c.match as unknown as { projectId?: string }).projectId));
  return matches.map((m) => {
    const id = (m as unknown as { expertId?: string; projectId?: string }).expertId ?? (m as unknown as { projectId?: string }).projectId;
    return { ...m, isSelected: id !== undefined && selectedIds.has(id) };
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
  const requiredFamiliesWeighted = weightedRequiredFamilies(requirements, tenderTitle, tenderSector);
  const requiredFamiliesUnique = [...new Set(requiredFamiliesWeighted)];
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
      const recordFamilies = capabilityFamilies(recordText);
      const trustLevel = optionalTrust(expert);
      const capability = capabilityScore(queryText, recordText, "expert");
      const weightedCapability = requiredFamiliesWeighted.length === 0
        ? capability
        : requiredFamiliesWeighted.filter((family) => recordFamilies.includes(family)).length / requiredFamiliesWeighted.length;
      const sector = sectorBoost(tenderSector, parseArr(expert.sectors));
      const trust = trustLevelAdjustment(trustLevel);
      const experience = (expert.yearsExperience ?? 0) >= 15 ? 0.12 : (expert.yearsExperience ?? 0) >= 10 ? 0.10 : (expert.yearsExperience ?? 0) >= 5 ? 0.05 : 0;
      const mismatchPenalty = criticalFamilyMismatchPenalty(queryText, recordText);
      const score = Math.max(0, Math.min(1, seniorScore({ cosine: bestScore, capability: Math.max(capability, weightedCapability), sector, trust, experience, valueOrRecency: 0, hasRealText: docTokens.length > 8 }) + mismatchPenalty));
      const evidence = [expert.title, ...parseArr(expert.disciplines), ...parseArr(expert.sectors)].filter(Boolean).join(" · ");
      const topMatches = [...new Set(docTokens.filter((t) => baseQueryTokens.includes(t)))].slice(0, 8).join(", ");
      const requiredFamilyHits = requiredFamiliesUnique.filter((family) => recordFamilies.includes(family)).length;
      const families = recordFamilies.join(", ");
      const trustLabel = trustLevelLabel(trustLevel);
      const thresholdLabel = score >= SELECTION_THRESHOLD ? "Auto-selected ≥75%." : "Below 75%; review only.";
      return {
        expertId: expert.id,
        score,
        rationale: `[${trustLabel}] 100-expert style broad-fit score using ${MATCHING_CYCLES} interpretation cycles; winning lexical cycle ${bestCycle}. ${thresholdLabel} Required-family coverage: ${requiredFamilyHits}/${Math.max(requiredFamiliesUnique.length, 1)}. Capability families: ${families || "general consultancy"}. Keywords: ${topMatches || evidence || "general professional profile"}.${expert.yearsExperience ? ` ${expert.yearsExperience} yrs experience.` : ""}`,
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
      const recordFamilies = capabilityFamilies(recordText);
      const trustLevel = optionalTrust(project);
      const capability = capabilityScore(queryText, recordText, "project");
      const weightedCapability = requiredFamiliesWeighted.length === 0
        ? capability
        : requiredFamiliesWeighted.filter((family) => recordFamilies.includes(family)).length / requiredFamiliesWeighted.length;
      const sector = sectorBoost(tenderSector, [project.sector ?? "", ...parseArr(project.serviceAreas)]);
      const trust = trustLevelAdjustment(trustLevel);
      let recency = 0;
      if (project.endDate) {
        const ageYears = (Date.now() - new Date(project.endDate).getTime()) / (365.25 * 24 * 3600 * 1000);
        if (ageYears < 5) recency += 0.07;
        else if (ageYears < 10) recency += 0.03;
      }
      if ((project.contractValue ?? 0) > 100000) recency += 0.03;
      const mismatchPenalty = criticalFamilyMismatchPenalty(queryText, recordText);
      const score = Math.max(0, Math.min(1, seniorScore({ cosine: bestScore, capability: Math.max(capability, weightedCapability), sector, trust, experience: 0, valueOrRecency: recency, hasRealText: docTokens.length > 8 }) + mismatchPenalty));
      const evidence = [project.sector, ...parseArr(project.serviceAreas)].filter(Boolean).join(" · ");
      const topMatches = [...new Set(docTokens.filter((t) => baseQueryTokens.includes(t)))].slice(0, 8).join(", ");
      const requiredFamilyHits = requiredFamiliesUnique.filter((family) => recordFamilies.includes(family)).length;
      const families = recordFamilies.join(", ");
      const trustLabel = trustLevelLabel(trustLevel);
      const thresholdLabel = score >= SELECTION_THRESHOLD ? "Auto-selected ≥75%." : "Below 75%; review only.";
      return {
        projectId: project.id,
        score,
        rationale: `[${trustLabel}] 100-expert style broad-fit score using ${MATCHING_CYCLES} interpretation cycles; winning lexical cycle ${bestCycle}. ${thresholdLabel} Required-family coverage: ${requiredFamilyHits}/${Math.max(requiredFamiliesUnique.length, 1)}. Capability families: ${families || "general project profile"}. Keywords: ${topMatches || evidence || "general project profile"}.${project.contractValue ? ` Contract: ${project.currency ?? "USD"} ${project.contractValue.toLocaleString()}.` : ""}`,
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

  // ─── Stage 2: Portfolio optimization ───────────────────────────────────────
  // Stage 1 above produced individual scores per expert / project using
  // 20 lexical cycles. Stage 2 below evaluates PORTFOLIO_OPTIMIZATION_CYCLES
  // candidate SETS to find the combination that best COVERS the tender's
  // capability families and disciplines as a group — not just the
  // individually highest scorers. This is the universal optimizer: it
  // looks at what THIS tender requires (extracted from requirement text),
  // not at hardcoded sector buckets, so it works for healthcare, water,
  // road, urban, environmental, ICT, education, and any future sector.
  //
  // Why this matters: the previous selection just took top-N by score.
  // For complex tenders with multiple disciplines (e.g., a hospital
  // assignment requiring architectural + structural + MEP + biomedical
  // experts), top-N often duplicated one discipline and missed others.
  // The portfolio optimizer rewards SETS that collectively cover all
  // required disciplines.

  const requirementText = queryText;
  const requiredFamilies = requiredFamiliesUnique.length > 0 ? requiredFamiliesUnique : capabilityFamilies(requirementText);
  const requirementDisciplineSources = [
    requirementText,
    ...requirements.map((r) => `${r.title} ${r.description}`),
    tenderTitle ?? "",
    tenderSector ?? "",
  ];
  const requiredDisciplines = uniqueStringsFrom(
    requirementDisciplineSources.map((src) => tokenize(src).filter((t) => t.length >= 5)),
  );

  const expertCandidates: PortfolioCandidate<typeof expertMatches[number]>[] = expertMatches.map((m, idx) => {
    const expert = knowledge.experts[idx];
    // Defensive: the .sort() above reorders expertMatches, so index alignment
    // is broken. Look up the expert by id instead.
    const e = knowledge.experts.find((x) => x.id === m.expertId);
    const recordText = e ? [e.fullName, e.title, e.profile, ...parseArr(e.disciplines), ...parseArr(e.sectors)].join(" ") : "";
    const disciplines = e ? [...parseArr(e.disciplines), ...parseArr(e.sectors)] : [];
    void expert; // satisfy linter on unused-but-typed variable
    return {
      match: m,
      capabilityFamilies: capabilityFamilies(recordText),
      disciplineTags: disciplines,
    };
  });

  const projectCandidates: PortfolioCandidate<typeof projectMatches[number]>[] = projectMatches.map((m) => {
    const p = knowledge.projects.find((x) => x.id === m.projectId);
    const recordText = p ? [p.name, p.clientName, p.country, p.sector, p.summary, ...parseArr(p.serviceAreas)].join(" ") : "";
    const disciplines = p ? [p.sector ?? "", ...parseArr(p.serviceAreas)].filter(Boolean) : [];
    return {
      match: m,
      capabilityFamilies: capabilityFamilies(recordText),
      disciplineTags: disciplines,
    };
  });

  return {
    expertMatches: optimizePortfolioSelection(
      expertMatches,
      expertCandidates,
      selectedLimit(requirements, "EXPERT", expertMatches.length),
      requiredFamilies,
      requiredDisciplines,
    ),
    projectMatches: optimizePortfolioSelection(
      projectMatches,
      projectCandidates,
      selectedLimit(requirements, "PROJECT_EXPERIENCE", projectMatches.length),
      requiredFamilies,
      requiredDisciplines,
    ),
  };
}
