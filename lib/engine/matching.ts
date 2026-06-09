import type { CompanyKnowledgeSnapshot, MatchingResult, RequirementDraft } from "./types";
import { exactSelectionLimit } from "./scope-policy";
import { deriveRequirementConstraintProfile } from "./requirement-constraints";
import { safeParseJsonArray } from "./safe-json-util";
import {
  CapabilityFamily,
  capabilityFamilies,
  detectDominantFamily,
} from "./universal-tender-taxonomy";

// Per-record lexical interpretation cycles. For each candidate expert /
// project, the matcher runs MATCHING_CYCLES different tokenization
// strategies against the tender requirements and keeps the best score.
const MATCHING_CYCLES = 20;

// Portfolio-level optimization cycles.
const PORTFOLIO_OPTIMIZATION_CYCLES = 20;

// Selection threshold for including a record in the evidence library.
const SELECTION_THRESHOLD = 0.75;

type KnowledgeWithOptionalTrust = { trustLevel?: string | null };

const KEEP_SHORT_TOKENS = new Set(["ai", "pm", "qa", "qc", "hr", "gm", "jv", "ict"]);

function tokenize(value: string | null | undefined): string[] {
  return (value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 || KEEP_SHORT_TOKENS.has(t));
}

function parseArr(v: unknown): string[] {
  return safeParseJsonArray(v as string);
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

function cosineSimilarity(vec1: Map<string, number>, vec2: Map<string, number>): number {
  let dotProduct = 0;
  for (const [token, val1] of vec1) dotProduct += val1 * (vec2.get(token) ?? 0);
  const mag1 = Math.sqrt([...vec1.values()].reduce((sum, v) => sum + v * v, 0));
  const mag2 = Math.sqrt([...vec2.values()].reduce((sum, v) => sum + v * v, 0));
  if (mag1 === 0 || mag2 === 0) return 0;
  return dotProduct / (mag1 * mag2);
}

function tfidf(doc: string[], idf: Map<string, number>): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of doc) tf.set(token, (tf.get(token) ?? 0) + 1);
  const vector = new Map<string, number>();
  for (const [token, count] of tf) vector.set(token, count * (idf.get(token) ?? 0));
  return vector;
}

export function scoreRequirementMatch(queryText: string, recordText: string, idf: Map<string, number>, tenderSector?: string | null, recordSector?: string | null, recordDisciplines: string[] = []): number {
  const qTokens = tokenize(queryText);
  if (qTokens.length === 0) return 0;

  const qVector = tfidf(qTokens, idf);
  const rTokens = tokenize(recordText);
  if (rTokens.length === 0) return 0;

  const rVector = tfidf(rTokens, idf);
  let score = cosineSimilarity(qVector, rVector);

  if (tenderSector && recordSector && tenderSector.toLowerCase().includes(recordSector.toLowerCase())) {
    score += 0.15;
  }

  const qFamilies = capabilityFamilies(queryText);
  const rFamilies = capabilityFamilies(recordText).concat(recordDisciplines.flatMap(capabilityFamilies));
  const shared = qFamilies.filter((f) => rFamilies.includes(f));
  if (shared.length > 0) {
    score += 0.20;
  }

  const dominant = detectDominantFamily(queryText);
  if (dominant && !rFamilies.includes(dominant)) {
    score *= 0.30;
  }

  return Math.max(0, Math.min(1, score));
}

const SECTOR_CONFLICT_GROUPS: RegExp[] = [
  /health|hospital|medical|clinic|patient|pharmacy|biomedical/,
  /warehouse|logistics|cargo|freight|storage|supply.?chain|distribution.?cent/,
  /water|borehole|hydraulic|irrigation|sanitation|sewer/,
  /road|bridge|highway|pavement|transport(?!ation.?planning)/,
  /school|university|campus|education|classroom/,
  /industrial|manufacturing|factory/,
  /\bport\b.*\b(design|master.*plan|infrastructure|facilit|terminal|study)\b|\b(berth|quay.*wall|dredging.*scheme|maritime.*infrastructure|harbour.*develop|ISPS.*audit)\b/,
  /\b(HAZOP|P&ID|upstream.*petroleum|petrochemical.*plant|refinery.*design|wellhead.*design|pipeline.*design|oil.*facilit|gas.*facilit)\b/,
  /\b(KYC|AML|core.*banking|microfinance.*platform|credit.*risk.*model|prudential.*regul|capital.*adequacy|Basel.*compliance)\b/,
];

function sectorBoost(tenderSector: string | null | undefined, items: string[]): number {
  if (!tenderSector) return 0;
  const tender = tenderSector.toLowerCase();
  const itemText = items.join(" ").toLowerCase();
  if (!itemText) return 0;

  const tenderGroup = SECTOR_CONFLICT_GROUPS.findIndex((g) => g.test(tender));
  const itemGroup = SECTOR_CONFLICT_GROUPS.findIndex((g) => g.test(itemText));
  if (tenderGroup >= 0 && itemGroup >= 0 && tenderGroup !== itemGroup) return -0.30;

  const tenderWords = tender.split(/[\s/,;:&()+]+/).filter((w) => w.length >= 5);
  if (tenderWords.length > 0 && tenderWords.some((w) => new RegExp(`\\b${w}\\b`).test(itemText))) return 0.15;
  if (items.some((item) => {
    const iWords = item.toLowerCase().split(/[\s/,;:&()+]+/).filter((w) => w.length >= 5);
    return iWords.some((w) => new RegExp(`\\b${w}\\b`).test(tender));
  })) return 0.15;

  if (tenderGroup === -1 && tenderWords.some((w) => itemText.includes(w))) return 0.10;
  return 0;
}

export async function matchKnowledge(requirements: RequirementDraft[], knowledge: CompanyKnowledgeSnapshot, tenderSector?: string | null): Promise<MatchingResult[]> {
  const corpus = [
    ...requirements.map((r) => tokenize(r.requirement)),
    ...knowledge.experts.map((e) => tokenize([e.fullName, e.title, e.profile, ...parseArr(e.disciplines), ...parseArr(e.sectors), ...parseArr(e.certifications)].join(" "))),
    ...knowledge.projects.map((p) => tokenize([p.name, p.clientName, p.country, p.sector, p.summary, ...parseArr(p.serviceAreas)].join(" "))),
  ];
  const idf = buildIdf(corpus);

  const expertTexts = knowledge.experts.map((e) => [e.fullName, e.title, e.profile, ...parseArr(e.disciplines), ...parseArr(e.sectors), ...parseArr(e.certifications)].join(" "));
  const projectTexts = knowledge.projects.map((p) => [p.name, p.clientName, p.country, p.sector, p.summary, ...parseArr(p.serviceAreas)].join(" "));

  const results: MatchingResult[] = [];

  for (const req of requirements) {
    const query = req.requirement;
    const expertScores: { id: string; score: number; evidence: string; trustLevel: string | null }[] = [];
    const projectScores: { id: string; score: number; evidence: string; trustLevel: string | null }[] = [];

    for (let i = 0; i < knowledge.experts.length; i++) {
      const expert = knowledge.experts[i];
      const baseScore = scoreRequirementMatch(query, expertTexts[i], idf, tenderSector, expert.sectors ? parseArr(expert.sectors)[0] : null, parseArr(expert.disciplines));
      const sector = sectorBoost(tenderSector, parseArr(expert.sectors));
      const score = Math.max(0, Math.min(1, baseScore + sector));

      if (score >= SELECTION_THRESHOLD) {
        expertScores.push({
          id: expert.id,
          score,
          evidence: [expert.title, ...parseArr(expert.disciplines), ...parseArr(expert.sectors)].filter(Boolean).join(" · "),
          trustLevel: (expert as KnowledgeWithOptionalTrust).trustLevel ?? null,
        });
      }
    }

    for (let i = 0; i < knowledge.projects.length; i++) {
      const project = knowledge.projects[i];
      const baseScore = scoreRequirementMatch(query, projectTexts[i], idf, tenderSector, project.sector, parseArr(project.serviceAreas));
      const sector = sectorBoost(tenderSector, [project.sector ?? "", ...parseArr(project.serviceAreas)]);
      const score = Math.max(0, Math.min(1, baseScore + sector));

      if (score >= SELECTION_THRESHOLD) {
        projectScores.push({
          id: project.id,
          score,
          evidence: [project.sector, ...parseArr(project.serviceAreas)].filter(Boolean).join(" · "),
          trustLevel: (project as KnowledgeWithOptionalTrust).trustLevel ?? null,
        });
      }
    }

    expertScores.sort((a, b) => b.score - a.score);
    projectScores.sort((a, b) => b.score - a.score);

    results.push({
      requirementId: req.id,
      experts: expertScores.slice(0, exactSelectionLimit("experts")),
      projects: projectScores.slice(0, exactSelectionLimit("projects")),
    });
  }

  return results;
}

export async function matchRequirementToKnowledge(req: RequirementDraft, knowledge: CompanyKnowledgeSnapshot, tenderSector?: string | null): Promise<MatchingResult> {
  const res = await matchKnowledge([req], knowledge, tenderSector);
  return res[0];
}

export function filterSnapshotByRequirement(req: string, knowledge: CompanyKnowledgeSnapshot, idf: Map<string, number>, tenderSector?: string | null): CompanyKnowledgeSnapshot {
  const filteredExperts = knowledge.experts.filter((e) => {
    const recordText = e ? [e.fullName, e.title, e.profile, ...parseArr(e.disciplines), ...parseArr(e.sectors)].join(" ") : "";
    const disciplines = e ? [...parseArr(e.disciplines), ...parseArr(e.sectors)] : [];
    return scoreRequirementMatch(req, recordText, idf, tenderSector, null, disciplines) >= SELECTION_THRESHOLD;
  });

  const filteredProjects = knowledge.projects.filter((p) => {
    const recordText = p ? [p.name, p.clientName, p.country, p.sector, p.summary, ...parseArr(p.serviceAreas)].join(" ") : "";
    const disciplines = p ? [p.sector ?? "", ...parseArr(p.serviceAreas)].filter(Boolean) : [];
    return scoreRequirementMatch(req, recordText, idf, tenderSector, null, disciplines) >= SELECTION_THRESHOLD;
  });

  return { ...knowledge, experts: filteredExperts, projects: filteredProjects };
}
