/**
 * Multi-Perspective AI Matcher (PR #255).
 *
 * THE PROBLEM
 * The existing matcher (lib/engine/matching.ts) uses pure lexical
 * TF-IDF cosine similarity across 20 cycles + 21 hand-coded
 * capability families. It ranks candidates by token overlap.
 *
 * That misses fit:
 *   • Semantic equivalence: "hospital design" vs "healthcare
 *     facility planning" share zero distinctive tokens but mean
 *     the same thing. Lexical matching ignores them.
 *   • Role-fit reasoning: an expert with 10 years' structural
 *     engineering scores high on a tender for METHODOLOGY LEAD
 *     because the words overlap. But the role-fit is wrong.
 *   • Scale comparability: a USD 50K signage project scores high
 *     on a USD 50M hospital tender because both mention
 *     "construction supervision" — but the scale is incomparable.
 *   • Recency: a 2010 project scores the same as a 2024 project
 *     when their text content is similar. Real evaluators heavily
 *     weight recency.
 *
 * THE FIX
 * After the existing lexical matcher produces a top-N pre-filtered
 * pool, this module sends ALL of those candidates to Claude in
 * ONE structured prompt and asks it to score each candidate
 * across FOUR perspectives:
 *
 *   1. DISCIPLINE_FIT      — Does the candidate's discipline
 *                            match the tender's required scope?
 *   2. SENIORITY_OR_SCALE  — Experts: years of experience, license
 *                            level. Projects: contract value,
 *                            timeline, complexity.
 *   3. SECTOR_FIT          — Does the candidate's sector align
 *                            with the tender's sector or strongly
 *                            adjacent ones?
 *   4. RECENCY_OR_ROLE     — Experts: have they played a similar
 *                            role on a similar project recently?
 *                            Projects: how recent is the delivery,
 *                            and how comparable in client/scope?
 *
 * Each perspective scores 0-10. Final candidate score = weighted
 * average mapped to 0-1 range. Claude returns 1-line strength +
 * 1-line concern per candidate so the user sees WHY it's a match.
 *
 * COST
 * One Claude call per category (1 for experts, 1 for projects).
 * Each call evaluates up to 15 pre-filtered candidates. Input ~12K
 * chars, output ~3K. At Tier 2 rates: ~$0.03-0.04 per category,
 * ~$0.07 total per tender. User opts in by clicking "AI Rematch".
 *
 * NEVER FABRICATES
 * The prompt explicitly forbids hallucination. If the candidate
 * profile lacks information for a perspective, Claude returns a
 * neutral 5/10 with a note "INSUFFICIENT_INFO" rather than
 * inventing a score.
 */

import { generateWithFallback } from "../ai";

// ─── Per-candidate AI assessment ────────────────────────────────────────────

export type MatchPerspective = "DISCIPLINE_FIT" | "SENIORITY_OR_SCALE" | "SECTOR_FIT" | "RECENCY_OR_ROLE";

export interface CandidateAssessment {
  candidateId: string;
  overallScore: number;        // 0-1 (already scaled)
  perspectives: Record<MatchPerspective, number>; // 0-10 each
  strength: string;            // 1-line summary of why this is a strong match
  concern: string;             // 1-line summary of the strongest reason for caution
  recommendSelection: boolean; // Claude's go/no-go recommendation
}

export interface MatchAssessmentBatch {
  category: "EXPERT" | "PROJECT";
  assessments: CandidateAssessment[];
  durationMs: number;
}

// ─── System prompts (one per category) ──────────────────────────────────────

const EXPERT_MATCHER_SYSTEM_PROMPT = `You are a senior bid director with 25 years of experience selecting expert teams for competitive tenders. You have personally chosen team compositions for 800+ winning bids. You are pragmatic, evidence-led, and rigorous.

You are given:
  • A tender's scope, requirements, and evaluation criteria.
  • A pre-filtered pool of candidate experts from the firm's
    knowledge vault, with their disciplines, sectors, years of
    experience, certifications, and profile text.

Your job: score each candidate from FOUR perspectives, return a
JSON object per candidate with all four scores, an overall score,
a 1-line strength, and a 1-line concern.

PERSPECTIVES (each 0-10):

  1. DISCIPLINE_FIT — Does this expert's discipline directly match
     what the tender requires for their role? Be honest: a structural
     engineer scoring high on a methodology-lead requirement is
     mismatched even if some keywords overlap.

  2. SENIORITY_OR_SCALE — Does the expert's years of experience and
     licensing level match the seniority the tender requires? A
     20-year licensed engineer fits a Project Principal role; a
     5-year graduate does not.

  3. SECTOR_FIT — Has the expert worked in this tender's specific
     sector (healthcare, water, road, ICT, education, etc.)? Strong
     adjacent-sector experience can score 7-8; weak adjacency 4-5;
     irrelevant 0-2.

  4. RECENCY_OR_ROLE — Has this expert played a SIMILAR ROLE on a
     SIMILAR PROJECT recently? An expert listed as "Lead Architect
     on G+6 Hospital 2023" scores 10 for a hospital lead-architect
     tender. An expert with relevant skills but no comparable named
     role scores 4-6.

OUTPUT — STRICT JSON ARRAY:
[
  {
    "candidateId": "<exact id from input>",
    "perspectives": {
      "DISCIPLINE_FIT": 0-10,
      "SENIORITY_OR_SCALE": 0-10,
      "SECTOR_FIT": 0-10,
      "RECENCY_OR_ROLE": 0-10
    },
    "strength": "1 short sentence naming the strongest match dimension",
    "concern": "1 short sentence naming the most important caveat",
    "recommendSelection": true | false
  }
]

RULES:
- Score honestly. Do not inflate. Do not deflate.
- If the candidate profile lacks information for a perspective,
  score 5 and add "INSUFFICIENT_INFO" prefix to the concern field.
- recommendSelection = true ONLY when overall fit is strong (avg 7+)
  AND no perspective is below 4.
- Output ONLY the JSON array — no markdown fences, no preamble.`;

const PROJECT_MATCHER_SYSTEM_PROMPT = `You are a senior bid director with 25 years of experience selecting comparable project references for competitive tenders. You have evaluated thousands of project portfolios for fit-to-tender. You are pragmatic, evidence-led, and rigorous.

You are given:
  • A tender's scope, requirements, sector, and (where available)
    contract value / timeline.
  • A pre-filtered pool of candidate projects from the firm's
    knowledge vault, with their names, clients, sectors, contract
    values, currencies, durations, and summary text.

Your job: score each project from FOUR perspectives.

PERSPECTIVES (each 0-10):

  1. DISCIPLINE_FIT — Does the project's scope of services match
     the tender's required scope? "Construction supervision" of a
     hospital matches a hospital tender; not all infrastructure
     projects match every infrastructure tender.

  2. SENIORITY_OR_SCALE — Is the project's contract value and
     timeline COMPARABLE to what the tender will require? A
     10-million-dollar project is a comparable reference for a
     10-million-dollar tender; a 50K signage project is not.

  3. SECTOR_FIT — Same sector as tender? Strongly adjacent? Or
     unrelated? Score 9-10 for same sector, 6-8 for adjacent
     (e.g., school project on healthcare tender = facility design
     adjacency), 0-3 for unrelated.

  4. RECENCY_OR_ROLE — When was the project completed? More recent
     = more credible (current methods, current team, current
     standards). A 2024 project scores 9-10; a 2018 project 6-7;
     a pre-2015 project 3-5 unless extraordinary scope.

OUTPUT — STRICT JSON ARRAY:
[
  {
    "candidateId": "<exact id from input>",
    "perspectives": {
      "DISCIPLINE_FIT": 0-10,
      "SENIORITY_OR_SCALE": 0-10,
      "SECTOR_FIT": 0-10,
      "RECENCY_OR_ROLE": 0-10
    },
    "strength": "1 short sentence naming the strongest match dimension",
    "concern": "1 short sentence naming the most important caveat",
    "recommendSelection": true | false
  }
]

RULES:
- Score honestly. Do not inflate. Do not deflate.
- If the project record lacks information for a perspective, score
  5 and add "INSUFFICIENT_INFO" prefix to the concern field.
- recommendSelection = true ONLY when overall fit is strong (avg 7+)
  AND no perspective is below 4.
- Output ONLY the JSON array — no markdown fences.`;

// ─── Per-candidate prompt input shapes ─────────────────────────────────────

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

// ─── Prompt builders ───────────────────────────────────────────────────────

function buildExpertUserPrompt(opts: {
  tenderTitle: string;
  tenderRequirementsText: string;
  evaluationMethodology: string;
  candidates: ExpertCandidateInput[];
}): string {
  const candidateLines = opts.candidates.map((e) => {
    const disciplines = e.disciplines.length > 0 ? e.disciplines.join(", ") : "<not specified>";
    const sectors = e.sectors.length > 0 ? e.sectors.join(", ") : "<not specified>";
    const certs = e.certifications.length > 0 ? e.certifications.join(", ") : "<none>";
    return [
      `id: ${e.id}`,
      `name: ${e.fullName}${e.title ? ` (${e.title})` : ""}`,
      `years_experience: ${e.yearsExperience ?? "unknown"}`,
      `disciplines: ${disciplines}`,
      `sectors: ${sectors}`,
      `certifications: ${certs}`,
      `profile: ${(e.profile ?? "").replace(/\s+/g, " ").slice(0, 700)}`,
      `trustLevel: ${e.trustLevel ?? "unknown"}`,
    ].join("\n");
  }).join("\n---\n");

  return `## TENDER
TITLE: ${opts.tenderTitle}

## TENDER REQUIREMENTS
${opts.tenderRequirementsText.slice(0, 4_000)}

## EVALUATION METHODOLOGY
${(opts.evaluationMethodology ?? "").slice(0, 2_500) || "(not provided — score against requirements)"}

## CANDIDATE EXPERTS (${opts.candidates.length} pre-filtered by lexical matcher)
${candidateLines}

Return the JSON array as specified in the system prompt — one object per candidate, scoring all four perspectives.`;
}

function buildProjectUserPrompt(opts: {
  tenderTitle: string;
  tenderRequirementsText: string;
  tenderCategory?: string | null;
  candidates: ProjectCandidateInput[];
}): string {
  const candidateLines = opts.candidates.map((p) => {
    const services = p.serviceAreas.length > 0 ? p.serviceAreas.join(", ") : "<not specified>";
    const value = p.contractValue ? `${p.currency || "USD"} ${p.contractValue.toLocaleString()}` : "<unknown value>";
    const dates = `${p.startDate ? new Date(p.startDate).getFullYear() : "?"}-${p.endDate ? new Date(p.endDate).getFullYear() : "ongoing"}`;
    return [
      `id: ${p.id}`,
      `name: ${p.name}`,
      `client: ${p.clientName ?? "<unknown>"}`,
      `country: ${p.country ?? "<unknown>"}`,
      `sector: ${p.sector ?? "<unknown>"}`,
      `service_areas: ${services}`,
      `contract_value: ${value}`,
      `period: ${dates}`,
      `summary: ${(p.summary ?? "").replace(/\s+/g, " ").slice(0, 700)}`,
      `trustLevel: ${p.trustLevel ?? "unknown"}`,
    ].join("\n");
  }).join("\n---\n");

  return `## TENDER
TITLE: ${opts.tenderTitle}
SECTOR: ${opts.tenderCategory ?? "<not specified>"}

## TENDER REQUIREMENTS (use to assess scope match)
${opts.tenderRequirementsText.slice(0, 4_000)}

## CANDIDATE PROJECTS (${opts.candidates.length} pre-filtered by lexical matcher)
${candidateLines}

Return the JSON array as specified in the system prompt — one object per candidate, scoring all four perspectives.`;
}

// ─── JSON parsing (defensive) ──────────────────────────────────────────────

function parseAssessmentArray(raw: string): Array<Record<string, unknown>> | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return null;
  try {
    const parsed = JSON.parse(arrayMatch[0]);
    if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
  } catch {
    // Fallback: largest [...] block
    const matches = [...cleaned.matchAll(/\[[\s\S]*?\]/g)].sort((a, b) => b[0].length - a[0].length);
    for (const m of matches) {
      try {
        const parsed = JSON.parse(m[0]);
        if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
      } catch { /* continue */ }
    }
  }
  return null;
}

// ─── Per-perspective weights ───────────────────────────────────────────────
// All four perspectives weighted equally — domain experts in the firm
// can tune these via env vars later if some perspectives matter more
// for their specific tender mix.

const PERSPECTIVE_WEIGHTS: Record<MatchPerspective, number> = {
  DISCIPLINE_FIT: 0.30,
  SENIORITY_OR_SCALE: 0.25,
  SECTOR_FIT: 0.25,
  RECENCY_OR_ROLE: 0.20,
};

function computeOverallScore(perspectives: Record<MatchPerspective, number>): number {
  const weighted =
    perspectives.DISCIPLINE_FIT * PERSPECTIVE_WEIGHTS.DISCIPLINE_FIT +
    perspectives.SENIORITY_OR_SCALE * PERSPECTIVE_WEIGHTS.SENIORITY_OR_SCALE +
    perspectives.SECTOR_FIT * PERSPECTIVE_WEIGHTS.SECTOR_FIT +
    perspectives.RECENCY_OR_ROLE * PERSPECTIVE_WEIGHTS.RECENCY_OR_ROLE;
  return Math.max(0, Math.min(1, weighted / 10));
}

function coerceAssessment(raw: Record<string, unknown>): CandidateAssessment | null {
  const candidateId = typeof raw.candidateId === "string" ? raw.candidateId : null;
  if (!candidateId) return null;

  const p = (raw.perspectives ?? {}) as Record<string, unknown>;
  const perspectives: Record<MatchPerspective, number> = {
    DISCIPLINE_FIT: clampScore(p.DISCIPLINE_FIT),
    SENIORITY_OR_SCALE: clampScore(p.SENIORITY_OR_SCALE),
    SECTOR_FIT: clampScore(p.SECTOR_FIT),
    RECENCY_OR_ROLE: clampScore(p.RECENCY_OR_ROLE),
  };

  return {
    candidateId,
    perspectives,
    overallScore: computeOverallScore(perspectives),
    strength: typeof raw.strength === "string" ? raw.strength.slice(0, 280) : "",
    concern: typeof raw.concern === "string" ? raw.concern.slice(0, 280) : "",
    recommendSelection: raw.recommendSelection === true,
  };
}

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 5; // neutral default
  return Math.max(0, Math.min(10, n));
}

// ─── Main entry points ─────────────────────────────────────────────────────

export async function aiRematchExperts(opts: {
  tenderTitle: string;
  tenderRequirementsText: string;
  evaluationMethodology: string;
  candidates: ExpertCandidateInput[];
}): Promise<MatchAssessmentBatch | null> {
  if (opts.candidates.length === 0) return null;

  const t0 = Date.now();
  const userPrompt = buildExpertUserPrompt(opts);

  let raw: string;
  try {
    raw = await generateWithFallback(userPrompt, { systemPrompt: EXPERT_MATCHER_SYSTEM_PROMPT });
  } catch (err) {
    console.warn(`[ai-multi-perspective-matcher] Expert rematch AI call failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  const parsed = parseAssessmentArray(raw);
  if (!parsed) {
    console.warn("[ai-multi-perspective-matcher] Expert rematch — Claude returned malformed JSON.");
    return null;
  }

  const assessments = parsed.map(coerceAssessment).filter((a): a is CandidateAssessment => a !== null);
  return {
    category: "EXPERT",
    assessments,
    durationMs: Date.now() - t0,
  };
}

export async function aiRematchProjects(opts: {
  tenderTitle: string;
  tenderRequirementsText: string;
  tenderCategory?: string | null;
  candidates: ProjectCandidateInput[];
}): Promise<MatchAssessmentBatch | null> {
  if (opts.candidates.length === 0) return null;

  const t0 = Date.now();
  const userPrompt = buildProjectUserPrompt(opts);

  let raw: string;
  try {
    raw = await generateWithFallback(userPrompt, { systemPrompt: PROJECT_MATCHER_SYSTEM_PROMPT });
  } catch (err) {
    console.warn(`[ai-multi-perspective-matcher] Project rematch AI call failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  const parsed = parseAssessmentArray(raw);
  if (!parsed) {
    console.warn("[ai-multi-perspective-matcher] Project rematch — Claude returned malformed JSON.");
    return null;
  }

  const assessments = parsed.map(coerceAssessment).filter((a): a is CandidateAssessment => a !== null);
  return {
    category: "PROJECT",
    assessments,
    durationMs: Date.now() - t0,
  };
}

/**
 * Format a multi-perspective assessment as a human-readable
 * rationale string for storage in the existing
 * TenderExpertMatch.rationale / TenderProjectMatch.rationale field.
 *
 * Format (single line, easy to render in UI):
 *
 *   "[AI Multi-Perspective] Score 87% — Discipline 9/10, Scale 8/10,
 *   Sector 9/10, Role 8/10. ✓ Strong methodology-lead fit on hospital
 *   sector. ⚠ Limited international donor experience."
 */
export function formatAssessmentRationale(assessment: CandidateAssessment): string {
  const pct = Math.round(assessment.overallScore * 100);
  const p = assessment.perspectives;
  const breakdown = `Discipline ${p.DISCIPLINE_FIT}/10, Scale ${p.SENIORITY_OR_SCALE}/10, Sector ${p.SECTOR_FIT}/10, Role ${p.RECENCY_OR_ROLE}/10`;
  const parts = [`[AI Multi-Perspective] Score ${pct}% — ${breakdown}.`];
  if (assessment.strength) parts.push(`✓ ${assessment.strength}`);
  if (assessment.concern) parts.push(`⚠ ${assessment.concern}`);
  return parts.join(" ");
}
