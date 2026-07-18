import { logger } from "../observability";
/**
 * Multi-Perspective AI Matcher.
 * Scores experts/projects across twelve evaluator lenses. The route performs
 * the final 20-iteration best-available portfolio selection and persists the
 * selected rows into TenderExpertMatch / TenderProjectMatch.
 */

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


async function withRematchTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`AI rematch timed out after ${Math.round(REMATCH_TIMEOUT_MS / 1000)}s — reduce candidate pool or retry`)),
          REMATCH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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

const PERSPECTIVE_SPEC = `PERSPECTIVES (0-10 each):
1. DISCIPLINE_FIT — exact professional/service discipline match to the tender's technical scope.
2. SCOPE_COVERAGE — breadth of tender scope covered, not one keyword.
3. SENIORITY_OR_SCALE — responsibility level, complexity, value/scale, leadership weight.
4. SECTOR_FIT — same sector or strongly adjacent sector; unrelated sectors score low.
5. ROLE_RECENCY — similar role/reference delivered recently; vague/old claims score lower.
6. EVIDENCE_QUALITY — specificity and verifiability of evidence; named projects, client, value, dates, credentials.
7. COMPLIANCE_CRITICALITY — ability to satisfy mandatory personnel/reference/eligibility clauses.
8. PORTFOLIO_CONTRIBUTION — contribution to the whole selected set; fills a missing capability or sector gap.
9. MANDATORY_ELIGIBILITY — likelihood this candidate passes strict tender eligibility wording without manual rescue.
10. DELIVERY_RISK — delivery risk if selected; low risk scores high, high ambiguity/availability/fit risk scores low.
11. DIFFERENTIATION — whether this candidate improves win strategy beyond minimum compliance.
12. COMMERCIAL_VALUE — value-for-bid perspective: appropriate scale, cost/value credibility, and no obvious commercial mismatch.`;

const JSON_SHAPE = `OUTPUT STRICT JSON ARRAY ONLY:
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
      "PORTFOLIO_CONTRIBUTION": 0-10,
      "MANDATORY_ELIGIBILITY": 0-10,
      "DELIVERY_RISK": 0-10,
      "DIFFERENTIATION": 0-10,
      "COMMERCIAL_VALUE": 0-10
    },
    "strength": "short evaluator-style reason to use this candidate",
    "concern": "short evaluator-style weakness/evidence gap",
    "recommendSelection": true | false
  }
]`;

const UNIVERSAL_TENDER_RULES = `UNIVERSAL TENDER RULES:
- This app is for multidisciplinary consulting tenders, not one sector only. It must work for EOI, RFP, RFQ, ITT, prequalification, technical proposals, financial proposals, and framework bids.
- Treat design, interior design, engineering design, supervision, contract administration, geotechnical investigation, urban planning, asset management, feasibility, BOQ/costing, MEP, environmental/social, procurement advisory, and project management as first-class service capabilities.
- Match across service capability first, tender form second, sector third, and keyword overlap last.
- A project from a different sector can be relevant when the same service capability is strong, for example supervision/contract administration/geotechnical investigation/design/asset management. Do not reject good multidisciplinary evidence only because the sector is adjacent.
- But do not select unsafe sector mismatches where both service capability and sector are weak.
- Best-available below 90 can be selected only after unsafe sector mismatches and mandatory-ineligible records are excluded.`;

const HARD_SECTOR_RULES = `HARD SECTOR SAFETY RULES:
- For hospital / healthcare / clinic / medical tenders, projects that are only warehouse, logistics, freight, cargo, terminal, supply-chain, or industrial storage experience are NOT comparable references unless the record explicitly says hospital/healthcare/clinical/medical/biomedical/pharmacy/laboratory scope.
- A warehouse/logistics-only record for a hospital tender must receive SECTOR_FIT <= 2, DISCIPLINE_FIT <= 4, SCOPE_COVERAGE <= 4, MANDATORY_ELIGIBILITY <= 4, DELIVERY_RISK <= 3, and recommendSelection=false.
- Similar wording applies to other sectors: sector mismatch must be treated as a real evaluator risk, not a keyword match.`;

const EXPERT_MATCHER_SYSTEM_PROMPT = `You are a senior bid director, technical evaluator, and red-team reviewer. You select expert teams for competitive tenders and think like a real evaluation panel, not a keyword search engine.

Score EVERY candidate from TWELVE perspectives using only evidence in the candidate record. Do not invent project roles, certificates, healthcare experience, dates, availability, or responsibilities.

${PERSPECTIVE_SPEC}

${UNIVERSAL_TENDER_RULES}

${HARD_SECTOR_RULES}

${JSON_SHAPE}

Rules:
- Think multi-dimensionally: technical fit, eligibility, evidence, delivery risk, strategy, and portfolio complement must all influence the score.
- A weak or below-threshold candidate must remain unselected; do not force 90% scores or promote weak evidence.
- If information is missing, score the affected perspective 5 and prefix the concern with INSUFFICIENT_INFO.
- DELIVERY_RISK is reverse-risk: 10 means low risk, 0 means unacceptable risk.
- recommendSelection means "would consider for the best-available team", not "perfect match".
- Output valid JSON only; no markdown fences.`;

const PROJECT_MATCHER_SYSTEM_PROMPT = `You are a senior bid director, technical evaluator, and red-team reviewer. You select comparable project references for competitive tenders and think like a real evaluation panel, not a keyword search engine.

Score EVERY project from TWELVE perspectives using only evidence in the project record. Do not invent clients, healthcare scopes, values, completion dates, certificates, or technical content.

${PERSPECTIVE_SPEC}

${UNIVERSAL_TENDER_RULES}

${HARD_SECTOR_RULES}

${JSON_SHAPE}

Rules:
- Think multi-dimensionally: technical fit, eligibility, evidence, scale, delivery risk, strategy, and portfolio complement must all influence the score.
- A weak or below-threshold reference must remain unselected; do not promote it merely because no perfect reference exists. Unsafe sector mismatches must not be selected.
- If information is missing, score the affected perspective 5 and prefix the concern with INSUFFICIENT_INFO.
- DELIVERY_RISK is reverse-risk: 10 means low risk, 0 means unacceptable risk.
- recommendSelection means "would consider for the best-available reference set", not "perfect match".
- Output valid JSON only; no markdown fences.`;

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

function tenderProfile(opts: { tenderTitle: string; tenderRequirementsText: string; tenderCategory?: string | null }): UniversalTenderProfile {
  return classifyUniversalTender([opts.tenderTitle, opts.tenderCategory ?? "", opts.tenderRequirementsText].join("\n"));
}

function expertText(candidate: ExpertCandidateInput): string {
  return [candidate.fullName, candidate.title, candidate.disciplines.join(" "), candidate.sectors.join(" "), candidate.certifications.join(" "), candidate.profile].filter(Boolean).join(" ");
}

function projectText(candidate: ProjectCandidateInput): string {
  return [candidate.name, candidate.clientName, candidate.country, candidate.sector, candidate.serviceAreas.join(" "), candidate.summary].filter(Boolean).join(" ");
}

function buildExpertUserPrompt(opts: { tenderTitle: string; tenderRequirementsText: string; evaluationMethodology: string; candidates: ExpertCandidateInput[] }): string {
  const tProfile = tenderProfile(opts);
  const candidateLines = opts.candidates.map((e) => {
    const profile = classifyUniversalTender(expertText(e));
    return [
      `id: ${e.id}`,
      `name: ${e.fullName}${e.title ? ` (${e.title})` : ""}`,
      `years_experience: ${e.yearsExperience ?? "unknown"}`,
      `disciplines: ${e.disciplines.length ? e.disciplines.join(", ") : "<not specified>"}`,
      `sectors: ${e.sectors.length ? e.sectors.join(", ") : "<not specified>"}`,
      `certifications: ${e.certifications.length ? e.certifications.join(", ") : "<none>"}`,
      `universal_candidate_profile: ${universalProfileSummary(profile)}`,
      `profile: ${(e.profile ?? "").replace(/\s+/g, " ").slice(0, 800)}`,
      `trustLevel: ${e.trustLevel ?? "unknown"}`,
    ].join("\n");
  }).join("\n---\n");

  return `## TENDER\nTITLE: ${opts.tenderTitle}\nUNIVERSAL_TENDER_PROFILE: ${universalProfileSummary(tProfile)}\n\n## TENDER REQUIREMENTS\n${opts.tenderRequirementsText.slice(0, 8_000)}\n\n## EVALUATION METHODOLOGY\n${opts.evaluationMethodology.slice(0, 4_000) || "(not provided — score against requirements)"}\n\n## CANDIDATE EXPERTS (${opts.candidates.length})\n${candidateLines}\n\nReturn one JSON object per candidate, scoring all twelve perspectives.`;
}

function buildProjectUserPrompt(opts: { tenderTitle: string; tenderRequirementsText: string; tenderCategory?: string | null; candidates: ProjectCandidateInput[] }): string {
  const tProfile = tenderProfile(opts);
  const candidateLines = opts.candidates.map((p) => {
    const profile = classifyUniversalTender(projectText(p));
    return [
      `id: ${p.id}`,
      `name: ${p.name}`,
      `client: ${p.clientName ?? "<unknown>"}`,
      `country: ${p.country ?? "<unknown>"}`,
      `sector: ${p.sector ?? "<unknown>"}`,
      `service_areas: ${p.serviceAreas.length ? p.serviceAreas.join(", ") : "<not specified>"}`,
      `universal_candidate_profile: ${universalProfileSummary(profile)}`,
      `contract_value: ${p.contractValue ? `${p.currency?.trim() ? p.currency : "Currency unresolved"} ${p.contractValue.toLocaleString()}` : "<unknown value>"}`,
      `period: ${p.startDate ? new Date(p.startDate).getFullYear() : "?"}-${p.endDate ? new Date(p.endDate).getFullYear() : "ongoing"}`,
      `summary: ${(p.summary ?? "").replace(/\s+/g, " ").slice(0, 800)}`,
      `trustLevel: ${p.trustLevel ?? "unknown"}`,
    ].join("\n");
  }).join("\n---\n");

  return `## TENDER\nTITLE: ${opts.tenderTitle}\nSECTOR: ${opts.tenderCategory ?? "<not specified>"}\nUNIVERSAL_TENDER_PROFILE: ${universalProfileSummary(tProfile)}\n\n## TENDER REQUIREMENTS\n${opts.tenderRequirementsText.slice(0, 8_000)}\n\n## CANDIDATE PROJECTS (${opts.candidates.length})\n${candidateLines}\n\nReturn one JSON object per candidate, scoring all twelve perspectives.`;
}

function parseAssessmentArray(raw: string): Array<Record<string, unknown>> | null {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.replace(/^[\s\S]*?```(?:json)?\s*/i, (m) => m.includes("```") ? "" : m).replace(/```[\s\S]*$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
    if (parsed && typeof parsed === "object") {
      for (const key of ["candidates", "assessments", "data", "results", "items", "scores"]) {
        const inner = (parsed as Record<string, unknown>)[key];
        if (Array.isArray(inner)) return inner as Array<Record<string, unknown>>;
      }
    }
  } catch { /* continue */ }

  const findBalancedArrays = (s: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i];
      if (ch === "[") { if (depth === 0) start = i; depth += 1; }
      else if (ch === "]") { depth -= 1; if (depth === 0 && start >= 0) { out.push(s.slice(start, i + 1)); start = -1; } }
    }
    return out;
  };
  const candidates = findBalancedArrays(cleaned).sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as Array<Record<string, unknown>>;
    } catch { /* continue */ }
  }
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c.replace(/,(\s*])/g, "$1").replace(/,(\s*})/g, "$1"));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as Array<Record<string, unknown>>;
    } catch { /* continue */ }
  }
  const firstBracket = cleaned.indexOf("[");
  if (firstBracket >= 0) {
    const tail = cleaned.slice(firstBracket);
    const lastObjEnd = tail.lastIndexOf("}");
    if (lastObjEnd > 0) {
      const truncated = tail.slice(0, lastObjEnd + 1).replace(/,\s*$/, "") + "]";
      try {
        const parsed = JSON.parse(truncated);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as Array<Record<string, unknown>>;
      } catch { /* fall through */ }
      try {
        const parsed = JSON.parse(truncated.replace(/,(\s*])/g, "$1").replace(/,(\s*})/g, "$1"));
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as Array<Record<string, unknown>>;
      } catch { /* fall through */ }
    }
  }
  return null;
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

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 5;
}

function legacyPerspectiveValue(p: Record<string, unknown>, key: MatchPerspective): unknown {
  if (key === "ROLE_RECENCY") return p.ROLE_RECENCY ?? p.RECENCY_OR_ROLE;
  if (key === "MANDATORY_ELIGIBILITY") return p.MANDATORY_ELIGIBILITY ?? p.COMPLIANCE_CRITICALITY;
  if (key === "DELIVERY_RISK") return p.DELIVERY_RISK ?? p.EVIDENCE_QUALITY;
  if (key === "DIFFERENTIATION") return p.DIFFERENTIATION ?? p.PORTFOLIO_CONTRIBUTION;
  if (key === "COMMERCIAL_VALUE") return p.COMMERCIAL_VALUE ?? p.SENIORITY_OR_SCALE;
  return p[key];
}

function computeOverallScore(perspectives: Record<MatchPerspective, number>): number {
  const weighted = PERSPECTIVE_KEYS.reduce((sum, key) => sum + perspectives[key] * PERSPECTIVE_WEIGHTS[key], 0);
  const criticalFloor = Math.min(perspectives.DISCIPLINE_FIT, perspectives.SCOPE_COVERAGE, perspectives.EVIDENCE_QUALITY, perspectives.COMPLIANCE_CRITICALITY, perspectives.MANDATORY_ELIGIBILITY);
  const riskPenalty = criticalFloor < 4 ? 0.07 : criticalFloor < 5 ? 0.035 : 0;
  return Math.max(0, Math.min(1, weighted / 10 - riskPenalty));
}

const HEALTHCARE_RE = /\b(health|healthcare|hospital|medical|clinic|clinical|opd|ward|surgical|radiology|pharmacy|laboratory|biomedical|patient|maternity|emergency|icu|infection|ipc)\b/i;
const LOGISTICS_RE = /\b(warehouse|logistics|freight|cargo|terminal|supply\s*chain|storage|depot|distribution\s+center|distribution\s+centre)\b/i;

function isHospitalTender(opts: { tenderTitle: string; tenderRequirementsText: string; tenderCategory?: string | null }): boolean {
  return HEALTHCARE_RE.test([opts.tenderTitle, opts.tenderRequirementsText, opts.tenderCategory ?? ""].join(" "));
}

function applyUniversalSafety(
  requiredProfile: UniversalTenderProfile,
  candidateProfile: UniversalTenderProfile,
  assessment: CandidateAssessment,
  reason: string,
): CandidateAssessment {
  if (!isUnsafeSectorMismatch(requiredProfile, candidateProfile)) return assessment;
  const perspectives: Record<MatchPerspective, number> = {
    ...assessment.perspectives,
    DISCIPLINE_FIT: Math.min(assessment.perspectives.DISCIPLINE_FIT, 4),
    SCOPE_COVERAGE: Math.min(assessment.perspectives.SCOPE_COVERAGE, 4),
    SECTOR_FIT: Math.min(assessment.perspectives.SECTOR_FIT, 2),
    COMPLIANCE_CRITICALITY: Math.min(assessment.perspectives.COMPLIANCE_CRITICALITY, 4),
    MANDATORY_ELIGIBILITY: Math.min(assessment.perspectives.MANDATORY_ELIGIBILITY, 4),
    DELIVERY_RISK: Math.min(assessment.perspectives.DELIVERY_RISK, 3),
    PORTFOLIO_CONTRIBUTION: Math.min(assessment.perspectives.PORTFOLIO_CONTRIBUTION, 3),
  };
  const concern = `UNSAFE_SECTOR_MISMATCH: ${reason}. Tender profile ${universalProfileSummary(requiredProfile)}; candidate profile ${universalProfileSummary(candidateProfile)}.`;
  return { ...assessment, perspectives, overallScore: computeOverallScore(perspectives), recommendSelection: false, concern: assessment.concern ? `${concern} ${assessment.concern}`.slice(0, 360) : concern.slice(0, 360) };
}

function applyCapabilityCalibration(requiredProfile: UniversalTenderProfile, candidateProfile: UniversalTenderProfile, assessment: CandidateAssessment): CandidateAssessment {
  const capabilityScore = capabilityOverlapScore(requiredProfile.serviceCapabilities, candidateProfile.serviceCapabilities);
  const sectorScore = sectorOverlapScore(requiredProfile.sectorDomains, candidateProfile.sectorDomains);
  let perspectives = assessment.perspectives;

  if (capabilityScore >= 0.5) {
    perspectives = {
      ...perspectives,
      DISCIPLINE_FIT: Math.max(perspectives.DISCIPLINE_FIT, Math.min(10, 6 + Math.round(capabilityScore * 4))),
      SCOPE_COVERAGE: Math.max(perspectives.SCOPE_COVERAGE, Math.min(10, 6 + Math.round(capabilityScore * 4))),
      SECTOR_FIT: sectorScore === 0 ? Math.min(perspectives.SECTOR_FIT, 6) : Math.max(perspectives.SECTOR_FIT, Math.min(10, 6 + Math.round(sectorScore * 4))),
    };
  } else if (requiredProfile.serviceCapabilities.length > 0) {
    perspectives = {
      ...perspectives,
      DISCIPLINE_FIT: Math.min(perspectives.DISCIPLINE_FIT, 5),
      SCOPE_COVERAGE: Math.min(perspectives.SCOPE_COVERAGE, 5),
    };
  }

  const overallScore = computeOverallScore(perspectives);
  const criticalFloor = Math.min(perspectives.DISCIPLINE_FIT, perspectives.SCOPE_COVERAGE, perspectives.EVIDENCE_QUALITY, perspectives.COMPLIANCE_CRITICALITY, perspectives.MANDATORY_ELIGIBILITY);
  return {
    ...assessment,
    perspectives,
    overallScore,
    recommendSelection: assessment.recommendSelection || (overallScore >= 0.60 && criticalFloor >= 3 && capabilityScore >= 0.34),
  };
}

function applyProjectSectorSafety(opts: { tenderTitle: string; tenderRequirementsText: string; tenderCategory?: string | null }, candidate: ProjectCandidateInput, assessment: CandidateAssessment): CandidateAssessment {
  const requiredProfile = tenderProfile(opts);
  const candidateProfile = classifyUniversalTender(projectText(candidate));
  const candidateText = projectText(candidate);
  const hospitalTender = isHospitalTender(opts);
  const candidateHasHealthcare = HEALTHCARE_RE.test(candidateText);
  const logisticsOnlyCandidate = LOGISTICS_RE.test(candidateText) && !candidateHasHealthcare;

  const calibrated = applyCapabilityCalibration(requiredProfile, candidateProfile, assessment);
  if (hospitalTender && logisticsOnlyCandidate) {
    return applyUniversalSafety(requiredProfile, candidateProfile, calibrated, "hospital/healthcare tender but this project is warehouse/logistics-only with no explicit healthcare scope");
  }
  return applyUniversalSafety(requiredProfile, candidateProfile, calibrated, "sector and service capability overlap are both weak");
}

function applyExpertSafety(opts: { tenderTitle: string; tenderRequirementsText: string; tenderCategory?: string | null }, candidate: ExpertCandidateInput, assessment: CandidateAssessment): CandidateAssessment {
  const requiredProfile = tenderProfile(opts);
  const candidateProfile = classifyUniversalTender(expertText(candidate));
  const calibrated = applyCapabilityCalibration(requiredProfile, candidateProfile, assessment);
  return applyUniversalSafety(requiredProfile, candidateProfile, calibrated, "expert sector and service capability overlap are both weak");
}

function coerceAssessment(raw: Record<string, unknown>): CandidateAssessment | null {
  const candidateId = typeof raw.candidateId === "string" ? raw.candidateId : null;
  if (!candidateId) return null;
  const p = (raw.perspectives ?? {}) as Record<string, unknown>;
  const perspectives = Object.fromEntries(PERSPECTIVE_KEYS.map((key) => [key, clampScore(legacyPerspectiveValue(p, key))])) as Record<MatchPerspective, number>;
  const overallScore = computeOverallScore(perspectives);
  const criticalFloor = Math.min(perspectives.DISCIPLINE_FIT, perspectives.SCOPE_COVERAGE, perspectives.EVIDENCE_QUALITY, perspectives.COMPLIANCE_CRITICALITY, perspectives.MANDATORY_ELIGIBILITY);
  return {
    candidateId,
    perspectives,
    overallScore,
    strength: typeof raw.strength === "string" ? raw.strength.slice(0, 360) : "",
    concern: typeof raw.concern === "string" ? raw.concern.slice(0, 360) : "",
    recommendSelection: raw.recommendSelection === true || (overallScore >= 0.60 && criticalFloor >= 3),
  };
}

export async function aiRematchExperts(opts: { tenderTitle: string; tenderRequirementsText: string; evaluationMethodology: string; candidates: ExpertCandidateInput[] }): Promise<MatchAssessmentBatch | null> {
  if (opts.candidates.length === 0) return null;
  const t0 = Date.now();
  let raw: string;
  try {
    raw = await withRematchTimeout(generateWithFallback(buildExpertUserPrompt(opts), { systemPrompt: EXPERT_MATCHER_SYSTEM_PROMPT }));
  } catch (err) {
    logger.warn(`[ai-multi-perspective-matcher] Expert rematch AI call failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const parsed = parseAssessmentArray(raw);
  if (!parsed) return null;
  const byId = new Map(opts.candidates.map((candidate) => [candidate.id, candidate]));
  const assessments = parsed
    .map(coerceAssessment)
    .filter((a): a is CandidateAssessment => a !== null)
    .map((assessment) => {
      const candidate = byId.get(assessment.candidateId);
      return candidate ? applyExpertSafety({ ...opts, tenderCategory: null }, candidate, assessment) : assessment;
    });
  return { category: "EXPERT", assessments, durationMs: Date.now() - t0 };
}

export async function aiRematchProjects(opts: { tenderTitle: string; tenderRequirementsText: string; tenderCategory?: string | null; candidates: ProjectCandidateInput[] }): Promise<MatchAssessmentBatch | null> {
  if (opts.candidates.length === 0) return null;
  const t0 = Date.now();
  let raw: string;
  try {
    raw = await withRematchTimeout(generateWithFallback(buildProjectUserPrompt(opts), { systemPrompt: PROJECT_MATCHER_SYSTEM_PROMPT }));
  } catch (err) {
    logger.warn(`[ai-multi-perspective-matcher] Project rematch AI call failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const parsed = parseAssessmentArray(raw);
  if (!parsed) return null;
  const byId = new Map(opts.candidates.map((candidate) => [candidate.id, candidate]));
  const assessments = parsed
    .map(coerceAssessment)
    .filter((a): a is CandidateAssessment => a !== null)
    .map((assessment) => {
      const candidate = byId.get(assessment.candidateId);
      return candidate ? applyProjectSectorSafety(opts, candidate, assessment) : assessment;
    });
  return { category: "PROJECT", assessments, durationMs: Date.now() - t0 };
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
    `Eligibility ${p.MANDATORY_ELIGIBILITY}/10`,
    `Low-risk delivery ${p.DELIVERY_RISK}/10`,
    `Differentiation ${p.DIFFERENTIATION}/10`,
    `Commercial value ${p.COMMERCIAL_VALUE}/10`,
  ].join(", ");
  const criticalFloor = Math.min(p.DISCIPLINE_FIT, p.SCOPE_COVERAGE, p.EVIDENCE_QUALITY, p.COMPLIANCE_CRITICALITY, p.MANDATORY_ELIGIBILITY);
  const parts = [`[AI Multi-Perspective v5 Universal] Score ${pct}% — ${breakdown}. Critical-floor ${criticalFloor}/10.`];
  // Plain text only — flows into the rationale string rendered as raw text
  // in the UI (app/dashboard/matching/matching-dashboard.tsx), which cannot
  // render an inline SVG icon.
  if (assessment.strength) parts.push(`Strength: ${assessment.strength}`);
  if (assessment.concern) parts.push(`Concern: ${assessment.concern}`);
  if (assessment.recommendSelection) parts.push("Selected by 20-iteration best-available portfolio pass with universal service-capability calibration and critical-floor risk control.");
  return parts.join(" ");
}
