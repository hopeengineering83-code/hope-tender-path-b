/**
 * Multi-Perspective AI Matcher.
 * Scores experts/projects across eight evaluator lenses. The route performs
 * the final 20-iteration best-available portfolio selection and persists the
 * selected rows into TenderExpertMatch / TenderProjectMatch.
 */

import { generateWithFallback } from "../ai";

export type MatchPerspective =
  | "DISCIPLINE_FIT"
  | "SCOPE_COVERAGE"
  | "SENIORITY_OR_SCALE"
  | "SECTOR_FIT"
  | "ROLE_RECENCY"
  | "EVIDENCE_QUALITY"
  | "COMPLIANCE_CRITICALITY"
  | "PORTFOLIO_CONTRIBUTION";

export interface CandidateAssessment {
  candidateId: string;
  overallScore: number;
  perspectives: Record<MatchPerspective, number>;
  strength: string;
  concern: string;
  recommendSelection: boolean;
}

export interface MatchAssessmentBatch {
  category: "EXPERT" | "PROJECT";
  assessments: CandidateAssessment[];
  durationMs: number;
}

const PERSPECTIVE_KEYS: MatchPerspective[] = [
  "DISCIPLINE_FIT",
  "SCOPE_COVERAGE",
  "SENIORITY_OR_SCALE",
  "SECTOR_FIT",
  "ROLE_RECENCY",
  "EVIDENCE_QUALITY",
  "COMPLIANCE_CRITICALITY",
  "PORTFOLIO_CONTRIBUTION",
];

const EXPERT_MATCHER_SYSTEM_PROMPT = `You are a senior bid director and red-team evaluator. You select expert teams for competitive tenders and think like a real evaluation panel, not a keyword search engine.

Score EVERY candidate from EIGHT perspectives using only evidence in the candidate record. Do not invent project roles, certificates, healthcare experience, dates, or responsibilities.

PERSPECTIVES (0-10):
1. DISCIPLINE_FIT — professional discipline match to the tender's technical scope.
2. SCOPE_COVERAGE — breadth of tender scope covered by the expert profile.
3. SENIORITY_OR_SCALE — years, licence level, leadership seniority, responsibility.
4. SECTOR_FIT — same sector or strong adjacent sector; penalize unrelated sectors.
5. ROLE_RECENCY — similar named role on similar work recently.
6. EVIDENCE_QUALITY — specificity: named projects, certificates, roles, client/sector details.
7. COMPLIANCE_CRITICALITY — helps satisfy mandatory personnel/CV eligibility.
8. PORTFOLIO_CONTRIBUTION — complements the likely team and fills missing capability.

OUTPUT STRICT JSON ARRAY ONLY:
[
  {
    "candidateId": "<exact id>",
    "perspectives": {
      "DISCIPLINE_FIT": 0-10,
      "SCOPE_COVERAGE": 0-10,
      "SENIORITY_OR_SCALE": 0-10,
      "SECTOR_FIT": 0-10,
      "ROLE_RECENCY": 0-10,
      "EVIDENCE_QUALITY": 0-10,
      "COMPLIANCE_CRITICALITY": 0-10,
      "PORTFOLIO_CONTRIBUTION": 0-10
    },
    "strength": "short evaluator-style reason to use this expert",
    "concern": "short evaluator-style weakness/evidence gap",
    "recommendSelection": true | false
  }
]

Rules: score honestly; a weak but best-available candidate can still be useful. Missing information scores 5 with concern prefix INSUFFICIENT_INFO. Output JSON only.`;

const PROJECT_MATCHER_SYSTEM_PROMPT = `You are a senior bid director and red-team evaluator. You select comparable project references for competitive tenders and think like a real evaluation panel, not a keyword search engine.

Score EVERY project from EIGHT perspectives using only evidence in the project record. Do not invent clients, healthcare scopes, values, completion dates, certificates, or technical content.

PERSPECTIVES (0-10):
1. DISCIPLINE_FIT — project services match the tender technical scope.
2. SCOPE_COVERAGE — breadth of tender scope covered by the reference.
3. SENIORITY_OR_SCALE — comparable value, size, complexity, delivery responsibility.
4. SECTOR_FIT — same sector or strong adjacent sector; unrelated sectors score low.
5. ROLE_RECENCY — recent and comparable delivery role.
6. EVIDENCE_QUALITY — specificity: client, value, dates, services, completion proof.
7. COMPLIANCE_CRITICALITY — helps satisfy mandatory similar-experience criteria.
8. PORTFOLIO_CONTRIBUTION — complements selected references and fills scope/sector/scale gaps.

OUTPUT STRICT JSON ARRAY ONLY:
[
  {
    "candidateId": "<exact id>",
    "perspectives": {
      "DISCIPLINE_FIT": 0-10,
      "SCOPE_COVERAGE": 0-10,
      "SENIORITY_OR_SCALE": 0-10,
      "SECTOR_FIT": 0-10,
      "ROLE_RECENCY": 0-10,
      "EVIDENCE_QUALITY": 0-10,
      "COMPLIANCE_CRITICALITY": 0-10,
      "PORTFOLIO_CONTRIBUTION": 0-10
    },
    "strength": "short evaluator-style reason to use this reference",
    "concern": "short evaluator-style weakness/evidence gap",
    "recommendSelection": true | false
  }
]

Rules: score honestly; a weak but best-available reference can still be selected when no perfect reference exists. Missing information scores 5 with concern prefix INSUFFICIENT_INFO. Output JSON only.`;

export interface ExpertCandidateInput {
  id: string;
  fullName: string;
  title?: string | null;
  yearsExperience?: number | null;
  disciplines: string[];
  sectors: string[];
  certifications: string[];
  profile?: string | null;
  trustLevel?: string | null;
}

export interface ProjectCandidateInput {
  id: string;
  name: string;
  clientName?: string | null;
  country?: string | null;
  sector?: string | null;
  serviceAreas: string[];
  summary?: string | null;
  contractValue?: number | null;
  currency?: string | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  trustLevel?: string | null;
}

function buildExpertUserPrompt(opts: { tenderTitle: string; tenderRequirementsText: string; evaluationMethodology: string; candidates: ExpertCandidateInput[] }): string {
  const candidateLines = opts.candidates.map((e) => [
    `id: ${e.id}`,
    `name: ${e.fullName}${e.title ? ` (${e.title})` : ""}`,
    `years_experience: ${e.yearsExperience ?? "unknown"}`,
    `disciplines: ${e.disciplines.length ? e.disciplines.join(", ") : "<not specified>"}`,
    `sectors: ${e.sectors.length ? e.sectors.join(", ") : "<not specified>"}`,
    `certifications: ${e.certifications.length ? e.certifications.join(", ") : "<none>"}`,
    `profile: ${(e.profile ?? "").replace(/\s+/g, " ").slice(0, 1_000)}`,
    `trustLevel: ${e.trustLevel ?? "unknown"}`,
  ].join("\n")).join("\n---\n");

  return `## TENDER\nTITLE: ${opts.tenderTitle}\n\n## TENDER REQUIREMENTS\n${opts.tenderRequirementsText.slice(0, 7_000)}\n\n## EVALUATION METHODOLOGY\n${opts.evaluationMethodology.slice(0, 3_500) || "(not provided — score against requirements)"}\n\n## CANDIDATE EXPERTS (${opts.candidates.length})\n${candidateLines}\n\nReturn one JSON object per candidate, scoring all eight perspectives.`;
}

function buildProjectUserPrompt(opts: { tenderTitle: string; tenderRequirementsText: string; tenderCategory?: string | null; candidates: ProjectCandidateInput[] }): string {
  const candidateLines = opts.candidates.map((p) => [
    `id: ${p.id}`,
    `name: ${p.name}`,
    `client: ${p.clientName ?? "<unknown>"}`,
    `country: ${p.country ?? "<unknown>"}`,
    `sector: ${p.sector ?? "<unknown>"}`,
    `service_areas: ${p.serviceAreas.length ? p.serviceAreas.join(", ") : "<not specified>"}`,
    `contract_value: ${p.contractValue ? `${p.currency || "USD"} ${p.contractValue.toLocaleString()}` : "<unknown value>"}`,
    `period: ${p.startDate ? new Date(p.startDate).getFullYear() : "?"}-${p.endDate ? new Date(p.endDate).getFullYear() : "ongoing"}`,
    `summary: ${(p.summary ?? "").replace(/\s+/g, " ").slice(0, 1_000)}`,
    `trustLevel: ${p.trustLevel ?? "unknown"}`,
  ].join("\n")).join("\n---\n");

  return `## TENDER\nTITLE: ${opts.tenderTitle}\nSECTOR: ${opts.tenderCategory ?? "<not specified>"}\n\n## TENDER REQUIREMENTS\n${opts.tenderRequirementsText.slice(0, 7_000)}\n\n## CANDIDATE PROJECTS (${opts.candidates.length})\n${candidateLines}\n\nReturn one JSON object per candidate, scoring all eight perspectives.`;
}

function parseAssessmentArray(raw: string): Array<Record<string, unknown>> | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return null;
  try {
    const parsed = JSON.parse(arrayMatch[0]);
    return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : null;
  } catch {
    return null;
  }
}

const PERSPECTIVE_WEIGHTS: Record<MatchPerspective, number> = {
  DISCIPLINE_FIT: 0.20,
  SCOPE_COVERAGE: 0.15,
  SENIORITY_OR_SCALE: 0.12,
  SECTOR_FIT: 0.16,
  ROLE_RECENCY: 0.12,
  EVIDENCE_QUALITY: 0.10,
  COMPLIANCE_CRITICALITY: 0.10,
  PORTFOLIO_CONTRIBUTION: 0.05,
};

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 5;
}

function computeOverallScore(perspectives: Record<MatchPerspective, number>): number {
  const weighted = PERSPECTIVE_KEYS.reduce((sum, key) => sum + perspectives[key] * PERSPECTIVE_WEIGHTS[key], 0);
  return Math.max(0, Math.min(1, weighted / 10));
}

function coerceAssessment(raw: Record<string, unknown>): CandidateAssessment | null {
  const candidateId = typeof raw.candidateId === "string" ? raw.candidateId : null;
  if (!candidateId) return null;
  const p = (raw.perspectives ?? {}) as Record<string, unknown>;
  const perspectives = Object.fromEntries(PERSPECTIVE_KEYS.map((key) => [key, clampScore(p[key])])) as Record<MatchPerspective, number>;
  const overallScore = computeOverallScore(perspectives);
  const minPerspective = Math.min(...Object.values(perspectives));
  return {
    candidateId,
    perspectives,
    overallScore,
    strength: typeof raw.strength === "string" ? raw.strength.slice(0, 320) : "",
    concern: typeof raw.concern === "string" ? raw.concern.slice(0, 320) : "",
    recommendSelection: raw.recommendSelection === true || (overallScore >= 0.62 && minPerspective >= 3),
  };
}

export async function aiRematchExperts(opts: { tenderTitle: string; tenderRequirementsText: string; evaluationMethodology: string; candidates: ExpertCandidateInput[] }): Promise<MatchAssessmentBatch | null> {
  if (opts.candidates.length === 0) return null;
  const t0 = Date.now();
  let raw: string;
  try {
    raw = await generateWithFallback(buildExpertUserPrompt(opts), { systemPrompt: EXPERT_MATCHER_SYSTEM_PROMPT });
  } catch (err) {
    console.warn(`[ai-multi-perspective-matcher] Expert rematch AI call failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const parsed = parseAssessmentArray(raw);
  if (!parsed) return null;
  return { category: "EXPERT", assessments: parsed.map(coerceAssessment).filter((a): a is CandidateAssessment => a !== null), durationMs: Date.now() - t0 };
}

export async function aiRematchProjects(opts: { tenderTitle: string; tenderRequirementsText: string; tenderCategory?: string | null; candidates: ProjectCandidateInput[] }): Promise<MatchAssessmentBatch | null> {
  if (opts.candidates.length === 0) return null;
  const t0 = Date.now();
  let raw: string;
  try {
    raw = await generateWithFallback(buildProjectUserPrompt(opts), { systemPrompt: PROJECT_MATCHER_SYSTEM_PROMPT });
  } catch (err) {
    console.warn(`[ai-multi-perspective-matcher] Project rematch AI call failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const parsed = parseAssessmentArray(raw);
  if (!parsed) return null;
  return { category: "PROJECT", assessments: parsed.map(coerceAssessment).filter((a): a is CandidateAssessment => a !== null), durationMs: Date.now() - t0 };
}

export function formatAssessmentRationale(assessment: CandidateAssessment): string {
  const pct = Math.round(assessment.overallScore * 100);
  const p = assessment.perspectives;
  const breakdown = [
    `Discipline ${p.DISCIPLINE_FIT}/10`,
    `Scope ${p.SCOPE_COVERAGE}/10`,
    `Scale ${p.SENIORITY_OR_SCALE}/10`,
    `Sector ${p.SECTOR_FIT}/10`,
    `Role/Recency ${p.ROLE_RECENCY}/10`,
    `Evidence ${p.EVIDENCE_QUALITY}/10`,
    `Compliance ${p.COMPLIANCE_CRITICALITY}/10`,
    `Portfolio ${p.PORTFOLIO_CONTRIBUTION}/10`,
  ].join(", ");
  const parts = [`[AI Multi-Perspective v2] Score ${pct}% — ${breakdown}.`];
  if (assessment.strength) parts.push(`✓ ${assessment.strength}`);
  if (assessment.concern) parts.push(`⚠ ${assessment.concern}`);
  if (assessment.recommendSelection) parts.push("Selected by 20-iteration best-available portfolio pass.");
  return parts.join(" ");
}
