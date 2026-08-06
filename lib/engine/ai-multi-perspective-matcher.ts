import { logger } from "../observability";
import { generateWithFallback } from "../ai";
import { REMATCH_TIMEOUT_MS } from "../timeout-config";
import {
  capabilityOverlapScore,
  classifyUniversalTender,
  isUnsafeSectorMismatch,
  sectorOverlapScore,
  universalProfileSummary,
  type UniversalTenderProfile,
} from "./universal-tender-taxonomy";

/** Hard upper bound for one provider request. */
export const MAX_CANDIDATES_PER_MATCHER_BATCH = 20;
const MAX_REQUIREMENT_CHARS = 8_000;
const MAX_METHODOLOGY_CHARS = 2_000;
const MAX_PROFILE_CHARS = 800;
const MAX_FALLBACK_PASSES = 3;

export type MatchPerspective =
  | "DISCIPLINE_FIT"
  | "SCOPE_COVERAGE"
  | "SENIORITY_OR_SCALE"
  | "SECTOR_FIT"
  | "ROLE_RECENCY"
  | "EVIDENCE_QUALITY"
  | "COMPLIANCE_CRITICALITY"
  | "PORTFOLIO_CONTRIBUTION"
  | "MANDATORY_ELIGIBILITY"
  | "DELIVERY_RISK"
  | "DIFFERENTIATION"
  | "COMMERCIAL_VALUE";

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

export const PERSPECTIVE_KEYS: MatchPerspective[] = [
  "DISCIPLINE_FIT",
  "SCOPE_COVERAGE",
  "SENIORITY_OR_SCALE",
  "SECTOR_FIT",
  "ROLE_RECENCY",
  "EVIDENCE_QUALITY",
  "COMPLIANCE_CRITICALITY",
  "PORTFOLIO_CONTRIBUTION",
  "MANDATORY_ELIGIBILITY",
  "DELIVERY_RISK",
  "DIFFERENTIATION",
  "COMMERCIAL_VALUE",
];

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

const PERSPECTIVE_WEIGHTS: Record<MatchPerspective, number> = {
  DISCIPLINE_FIT: 0.16,
  SCOPE_COVERAGE: 0.13,
  SENIORITY_OR_SCALE: 0.09,
  SECTOR_FIT: 0.11,
  ROLE_RECENCY: 0.08,
  EVIDENCE_QUALITY: 0.09,
  COMPLIANCE_CRITICALITY: 0.10,
  PORTFOLIO_CONTRIBUTION: 0.07,
  MANDATORY_ELIGIBILITY: 0.07,
  DELIVERY_RISK: 0.04,
  DIFFERENTIATION: 0.04,
  COMMERCIAL_VALUE: 0.02,
};

const PERSPECTIVE_SPEC = `Score each candidate 0-10 for: DISCIPLINE_FIT, SCOPE_COVERAGE, SENIORITY_OR_SCALE, SECTOR_FIT, ROLE_RECENCY, EVIDENCE_QUALITY, COMPLIANCE_CRITICALITY, PORTFOLIO_CONTRIBUTION, MANDATORY_ELIGIBILITY, DELIVERY_RISK (10 means low risk), DIFFERENTIATION, and COMMERCIAL_VALUE.`;

const JSON_SHAPE = `Return JSON array only. Each object must contain candidateId, perspectives with all twelve keys, strength, concern, and recommendSelection.`;

const SYSTEM_PROMPT = `You are a senior multidisciplinary tender evaluator. Use only supplied evidence. Never invent roles, clients, sectors, values, dates, certificates, or experience. Missing evidence scores 5 or lower and must be noted as INSUFFICIENT_INFO. Unsafe sector mismatches and mandatory-ineligible records must not be recommended. ${PERSPECTIVE_SPEC} ${JSON_SHAPE}`;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function withRematchTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`AI rematch timed out after ${Math.round(REMATCH_TIMEOUT_MS / 1000)}s`)),
          REMATCH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * generateWithFallback has a per-request attempt budget. A second bounded pass
 * is required when that budget is consumed: providers attempted in pass one
 * enter cooldown, so the next pass advances to remaining configured providers.
 */
async function generateMatcherWithExpandedFallback(prompt: string): Promise<string> {
  const errors: string[] = [];
  for (let pass = 1; pass <= MAX_FALLBACK_PASSES; pass += 1) {
    try {
      return await withRematchTimeout(generateWithFallback(prompt, { systemPrompt: SYSTEM_PROMPT }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`pass ${pass}: ${message}`);
      const retryable = /ATTEMPT_BUDGET_EXHAUSTED|rate limit|429|413|timeout|timed out|fetch failed|network|cooldown/i.test(message);
      if (!retryable || pass === MAX_FALLBACK_PASSES) break;
      await sleep(250 * pass);
    }
  }
  throw new Error(`MATCHER_PROVIDER_FALLBACK_EXHAUSTED: ${errors.join(" | ").slice(0, 1_500)}`);
}

function tenderProfile(title: string, requirements: string, category?: string | null): UniversalTenderProfile {
  return classifyUniversalTender([title, category ?? "", requirements].join("\n"));
}

function expertText(candidate: ExpertCandidateInput): string {
  return [
    candidate.fullName,
    candidate.title,
    candidate.disciplines.join(" "),
    candidate.sectors.join(" "),
    candidate.certifications.join(" "),
    candidate.profile,
  ].filter(Boolean).join(" ");
}

function projectText(candidate: ProjectCandidateInput): string {
  return [
    candidate.name,
    candidate.clientName,
    candidate.country,
    candidate.sector,
    candidate.serviceAreas.join(" "),
    candidate.summary,
  ].filter(Boolean).join(" ");
}

export function buildExpertUserPrompt(opts: {
  tenderTitle: string;
  tenderRequirementsText: string;
  evaluationMethodology: string;
  candidates: ExpertCandidateInput[];
}): string {
  const required = tenderProfile(opts.tenderTitle, opts.tenderRequirementsText);
  const candidates = opts.candidates.map((candidate) => {
    const profile = classifyUniversalTender(expertText(candidate));
    return [
      `id=${candidate.id}`,
      `name=${candidate.fullName}`,
      `title=${candidate.title ?? "unknown"}`,
      `years=${candidate.yearsExperience ?? "unknown"}`,
      `disciplines=${candidate.disciplines.join(", ") || "unknown"}`,
      `sectors=${candidate.sectors.join(", ") || "unknown"}`,
      `certifications=${candidate.certifications.join(", ") || "none"}`,
      `universalProfile=${universalProfileSummary(profile)}`,
      `profile=${(candidate.profile ?? "").replace(/\s+/g, " ").slice(0, 800)}`,
      `trust=${candidate.trustLevel ?? "unknown"}`,
    ].join("\n");
  }).join("\n---\n");

  return `TENDER=${opts.tenderTitle}\nUNIVERSAL_PROFILE=${universalProfileSummary(required)}\nREQUIREMENTS:\n${opts.tenderRequirementsText.slice(0, 8_000)}\nMETHODOLOGY:\n${opts.evaluationMethodology.slice(0, MAX_METHODOLOGY_CHARS) || "not provided"}\nEXPERTS (${opts.candidates.length}):\n${candidates}`;
}

export function buildProjectUserPrompt(opts: {
  tenderTitle: string;
  tenderRequirementsText: string;
  tenderCategory?: string | null;
  candidates: ProjectCandidateInput[];
}): string {
  const required = tenderProfile(opts.tenderTitle, opts.tenderRequirementsText, opts.tenderCategory);
  const candidates = opts.candidates.map((candidate) => {
    const profile = classifyUniversalTender(projectText(candidate));
    const value = candidate.contractValue == null
      ? "unknown"
      : `${candidate.currency?.trim() || "currency unresolved"} ${candidate.contractValue}`;
    return [
      `id=${candidate.id}`,
      `name=${candidate.name}`,
      `client=${candidate.clientName ?? "unknown"}`,
      `country=${candidate.country ?? "unknown"}`,
      `sector=${candidate.sector ?? "unknown"}`,
      `services=${candidate.serviceAreas.join(", ") || "unknown"}`,
      `universalProfile=${universalProfileSummary(profile)}`,
      `value=${value}`,
      `period=${candidate.startDate ? new Date(candidate.startDate).getFullYear() : "?"}-${candidate.endDate ? new Date(candidate.endDate).getFullYear() : "ongoing"}`,
      `summary=${(candidate.summary ?? "").replace(/\s+/g, " ").slice(0, 800)}`,
      `trust=${candidate.trustLevel ?? "unknown"}`,
    ].join("\n");
  }).join("\n---\n");

  return `TENDER=${opts.tenderTitle}\nCATEGORY=${opts.tenderCategory ?? "unknown"}\nUNIVERSAL_PROFILE=${universalProfileSummary(required)}\nREQUIREMENTS:\n${opts.tenderRequirementsText.slice(0, 8_000)}\nPROJECTS (${opts.candidates.length}):\n${candidates}`;
}

function balancedArrays(value: string): string[] {
  const out: string[] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (char === "[") { if (depth === 0) start = index; depth += 1; }
    if (char === "]") {
      depth -= 1;
      if (depth === 0 && start >= 0) { out.push(value.slice(start, index + 1)); start = -1; }
    }
  }
  return out;
}

function parseAssessmentArray(raw: string): Array<Record<string, unknown>> | null {
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const candidates = [cleaned, ...balancedArrays(cleaned).sort((left, right) => right.length - left.length)];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
      if (parsed && typeof parsed === "object") {
        for (const key of ["assessments", "results", "candidates", "items", "data"]) {
          const nested = (parsed as Record<string, unknown>)[key];
          if (Array.isArray(nested)) return nested as Array<Record<string, unknown>>;
        }
      }
    } catch {
      // Try next balanced candidate.
    }
  }
  return null;
}

function clampScore(value: unknown): number {
  const score = typeof value === "number" ? value : Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(10, score)) : 5;
}

function legacyPerspectiveValue(values: Record<string, unknown>, key: MatchPerspective): unknown {
  if (key === "ROLE_RECENCY") return values.ROLE_RECENCY ?? values.RECENCY_OR_ROLE;
  if (key === "MANDATORY_ELIGIBILITY") return values.MANDATORY_ELIGIBILITY ?? values.COMPLIANCE_CRITICALITY;
  if (key === "DELIVERY_RISK") return values.DELIVERY_RISK ?? values.EVIDENCE_QUALITY;
  if (key === "DIFFERENTIATION") return values.DIFFERENTIATION ?? values.PORTFOLIO_CONTRIBUTION;
  if (key === "COMMERCIAL_VALUE") return values.COMMERCIAL_VALUE ?? values.SENIORITY_OR_SCALE;
  return values[key];
}

function computeOverallScore(perspectives: Record<MatchPerspective, number>): number {
  const weighted = PERSPECTIVE_KEYS.reduce(
    (total, key) => total + perspectives[key] * PERSPECTIVE_WEIGHTS[key],
    0,
  );
  const criticalFloor = Math.min(
    perspectives.DISCIPLINE_FIT,
    perspectives.SCOPE_COVERAGE,
    perspectives.EVIDENCE_QUALITY,
    perspectives.COMPLIANCE_CRITICALITY,
    perspectives.MANDATORY_ELIGIBILITY,
  );
  return Math.max(0, Math.min(1, weighted / 10 - (criticalFloor < 4 ? 0.07 : criticalFloor < 5 ? 0.035 : 0)));
}

function coerceAssessment(raw: Record<string, unknown>): CandidateAssessment | null {
  const candidateId = typeof raw.candidateId === "string" ? raw.candidateId : null;
  if (!candidateId) return null;
  const values = (raw.perspectives ?? {}) as Record<string, unknown>;
  const perspectives = Object.fromEntries(
    PERSPECTIVE_KEYS.map((key) => [key, clampScore(legacyPerspectiveValue(values, key))]),
  ) as Record<MatchPerspective, number>;
  const overallScore = computeOverallScore(perspectives);
  const criticalFloor = Math.min(
    perspectives.DISCIPLINE_FIT,
    perspectives.SCOPE_COVERAGE,
    perspectives.EVIDENCE_QUALITY,
    perspectives.COMPLIANCE_CRITICALITY,
    perspectives.MANDATORY_ELIGIBILITY,
  );
  return {
    candidateId,
    perspectives,
    overallScore,
    strength: typeof raw.strength === "string" ? raw.strength.slice(0, 360) : "",
    concern: typeof raw.concern === "string" ? raw.concern.slice(0, 360) : "",
    recommendSelection: raw.recommendSelection === true || (overallScore >= 0.60 && criticalFloor >= 3),
  };
}

function calibrate(
  required: UniversalTenderProfile,
  candidate: UniversalTenderProfile,
  assessment: CandidateAssessment,
): CandidateAssessment {
  const capability = capabilityOverlapScore(required.serviceCapabilities, candidate.serviceCapabilities);
  const sector = sectorOverlapScore(required.sectorDomains, candidate.sectorDomains);
  let perspectives = { ...assessment.perspectives };

  if (capability >= 0.5) {
    perspectives.DISCIPLINE_FIT = Math.max(perspectives.DISCIPLINE_FIT, Math.min(10, 6 + Math.round(capability * 4)));
    perspectives.SCOPE_COVERAGE = Math.max(perspectives.SCOPE_COVERAGE, Math.min(10, 6 + Math.round(capability * 4)));
    if (sector > 0) perspectives.SECTOR_FIT = Math.max(perspectives.SECTOR_FIT, Math.min(10, 6 + Math.round(sector * 4)));
  } else if (required.serviceCapabilities.length > 0) {
    perspectives.DISCIPLINE_FIT = Math.min(perspectives.DISCIPLINE_FIT, 5);
    perspectives.SCOPE_COVERAGE = Math.min(perspectives.SCOPE_COVERAGE, 5);
  }

  let concern = assessment.concern;
  let recommendSelection = assessment.recommendSelection;
  if (isUnsafeSectorMismatch(required, candidate)) {
    perspectives = {
      ...perspectives,
      DISCIPLINE_FIT: Math.min(perspectives.DISCIPLINE_FIT, 4),
      SCOPE_COVERAGE: Math.min(perspectives.SCOPE_COVERAGE, 4),
      SECTOR_FIT: Math.min(perspectives.SECTOR_FIT, 2),
      COMPLIANCE_CRITICALITY: Math.min(perspectives.COMPLIANCE_CRITICALITY, 4),
      MANDATORY_ELIGIBILITY: Math.min(perspectives.MANDATORY_ELIGIBILITY, 4),
      DELIVERY_RISK: Math.min(perspectives.DELIVERY_RISK, 3),
    };
    concern = `UNSAFE_SECTOR_MISMATCH: ${concern || "candidate sector and service capability do not support this tender"}`.slice(0, 360);
    recommendSelection = false;
  }

  const overallScore = computeOverallScore(perspectives);
  return { ...assessment, perspectives, overallScore, concern, recommendSelection };
}

async function assessBatches<T>(
  category: "EXPERT" | "PROJECT",
  candidates: T[],
  buildPrompt: (batch: T[]) => string,
  calibrateCandidate: (candidate: T, assessment: CandidateAssessment) => CandidateAssessment,
): Promise<MatchAssessmentBatch | null> {
  if (candidates.length === 0) return null;
  const startedAt = Date.now();
  const assessments: CandidateAssessment[] = [];

  for (let index = 0; index < candidates.length; index += MAX_CANDIDATES_PER_MATCHER_BATCH) {
    const batch = candidates.slice(index, index + MAX_CANDIDATES_PER_MATCHER_BATCH);
    try {
      const raw = await generateMatcherWithExpandedFallback(buildPrompt(batch));
      const parsed = parseAssessmentArray(raw);
      if (!parsed) continue;
      const byId = new Map(batch.map((candidate) => [(candidate as { id: string }).id, candidate]));
      for (const item of parsed) {
        const assessment = coerceAssessment(item);
        if (!assessment) continue;
        const candidate = byId.get(assessment.candidateId);
        if (candidate) assessments.push(calibrateCandidate(candidate, assessment));
      }
    } catch (error) {
      logger.warn(`[ai-multi-perspective-matcher] ${category} batch failed: ${error instanceof Error ? error.message : String(error)}`);
      if (assessments.length > 0) break;
      return null;
    }
  }

  return assessments.length > 0
    ? { category, assessments, durationMs: Date.now() - startedAt }
    : null;
}

export async function aiRematchExperts(opts: {
  tenderTitle: string;
  tenderRequirementsText: string;
  evaluationMethodology: string;
  candidates: ExpertCandidateInput[];
}): Promise<MatchAssessmentBatch | null> {
  const required = tenderProfile(opts.tenderTitle, opts.tenderRequirementsText);
  if (opts.candidates.length === 0) return null;
  const startedAt = Date.now();
  const allAssessments: CandidateAssessment[] = [];

  for (let i = 0; i < opts.candidates.length; i += MAX_CANDIDATES_PER_MATCHER_BATCH) {
    const batch = opts.candidates.slice(i, i + MAX_CANDIDATES_PER_MATCHER_BATCH);
    const batchOpts = { ...opts, candidates: batch };
    try {
      const raw = await generateWithFallback(buildExpertUserPrompt(batchOpts), { systemPrompt: SYSTEM_PROMPT });
      const parsed = parseAssessmentArray(raw);
      if (!parsed) continue;
      const byId = new Map(batch.map((c) => [c.id, c]));
      for (const item of parsed) {
        const assessment = coerceAssessment(item);
        if (!assessment) continue;
        const candidate = byId.get(assessment.candidateId);
        if (candidate) allAssessments.push(calibrate(required, classifyUniversalTender(expertText(candidate)), assessment));
      }
    } catch (error) {
      logger.warn(`[ai-multi-perspective-matcher] EXPERT batch failed: ${error instanceof Error ? error.message : String(error)}`);
      if (allAssessments.length > 0) break;
      return null;
    }
  }

  return allAssessments.length > 0
    ? { category: "EXPERT", assessments: allAssessments, durationMs: Date.now() - startedAt }
    : null;
}

export async function aiRematchProjects(opts: {
  tenderTitle: string;
  tenderRequirementsText: string;
  tenderCategory?: string | null;
  candidates: ProjectCandidateInput[];
}): Promise<MatchAssessmentBatch | null> {
  const required = tenderProfile(opts.tenderTitle, opts.tenderRequirementsText, opts.tenderCategory);
  if (opts.candidates.length === 0) return null;
  const startedAt = Date.now();
  const allAssessments: CandidateAssessment[] = [];

  for (let i = 0; i < opts.candidates.length; i += MAX_CANDIDATES_PER_MATCHER_BATCH) {
    const batch = opts.candidates.slice(i, i + MAX_CANDIDATES_PER_MATCHER_BATCH);
    const batchOpts = { ...opts, candidates: batch };
    try {
      const raw = await generateWithFallback(buildProjectUserPrompt(batchOpts), { systemPrompt: SYSTEM_PROMPT });
      const parsed = parseAssessmentArray(raw);
      if (!parsed) continue;
      const byId = new Map(batch.map((c) => [c.id, c]));
      for (const item of parsed) {
        const assessment = coerceAssessment(item);
        if (!assessment) continue;
        const candidate = byId.get(assessment.candidateId);
        if (candidate) allAssessments.push(calibrate(required, classifyUniversalTender(projectText(candidate)), assessment));
      }
    } catch (error) {
      logger.warn(`[ai-multi-perspective-matcher] PROJECT batch failed: ${error instanceof Error ? error.message : String(error)}`);
      if (allAssessments.length > 0) break;
      return null;
    }
  }

  return allAssessments.length > 0
    ? { category: "PROJECT", assessments: allAssessments, durationMs: Date.now() - startedAt }
    : null;
}

export function formatAssessmentRationale(assessment: CandidateAssessment): string {
  const perspectives = assessment.perspectives;
  const breakdown = [
    `Discipline ${perspectives.DISCIPLINE_FIT}/10`,
    `Scope ${perspectives.SCOPE_COVERAGE}/10`,
    `Scale ${perspectives.SENIORITY_OR_SCALE}/10`,
    `Sector ${perspectives.SECTOR_FIT}/10`,
    `Role/Recency ${perspectives.ROLE_RECENCY}/10`,
    `Evidence ${perspectives.EVIDENCE_QUALITY}/10`,
    `Compliance ${perspectives.COMPLIANCE_CRITICALITY}/10`,
    `Portfolio ${perspectives.PORTFOLIO_CONTRIBUTION}/10`,
    `Eligibility ${perspectives.MANDATORY_ELIGIBILITY}/10`,
    `Low-risk delivery ${perspectives.DELIVERY_RISK}/10`,
    `Differentiation ${perspectives.DIFFERENTIATION}/10`,
    `Commercial value ${perspectives.COMMERCIAL_VALUE}/10`,
  ].join(", ");
  const parts = [`[AI Multi-Perspective v6 Bounded] Score ${Math.round(assessment.overallScore * 100)}% — ${breakdown}.`];
  if (assessment.strength) parts.push(`Strength: ${assessment.strength}`);
  if (assessment.concern) parts.push(`Concern: ${assessment.concern}`);
  if (assessment.recommendSelection) parts.push("Selected by bounded best-available portfolio evaluation.");
  return parts.join(" ");
}
