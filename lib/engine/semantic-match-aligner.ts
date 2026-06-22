import { logger } from "../observability";
/**
 * Semantic match-to-criteria aligner.
 *
 * The legacy matcher (`lib/engine/matching.ts`) scores experts and
 * projects with lexical token overlap + capability-family keywords.
 * It produces credible rankings but cannot explain WHY a candidate
 * fits a specific evaluator criterion. Evaluators score on
 * criterion-by-criterion rationale, not on overall similarity, so a
 * proposal that names "Dr. Alemu" without explaining how Dr. Alemu's
 * 2022 Sebeta WASH project satisfies the tender's stated "detailed
 * hydraulic modelling" criterion leaves points on the table.
 *
 * This module runs a SINGLE Claude call per tender that receives:
 *   – the deep-comprehension evaluation criteria (with weights and
 *     mandatory flags)
 *   – the selected top experts and projects (already pre-filtered
 *     by the lexical matcher)
 *   – tender title and client name for context
 *
 * Claude returns a JSON alignment report:
 *   – per (record × criterion) alignment score 0–10 + rationale
 *   – per-criterion coverage summary
 *   – overall narrative
 *   – risk flags (license about to expire, expert overloaded, etc.)
 *
 * The formatter renders the report as a compact text block that is
 * injected into the proposal-generation prompt's `differentiators`
 * field. Claude reads it BEFORE writing the proposal so every expert
 * / project mention is anchored to a named criterion + rationale.
 *
 * Gated behind TENDER_DEEP_REASONING. Falls back silently to null
 * when AI is unavailable, when comprehension has no criteria, or
 * when the model returns malformed JSON — callers continue with the
 * legacy lexical match.
 */

import { generateWithFallback, isAIEnabled } from "../ai";
import type { DeepTenderComprehension } from "./evaluation-criteria-extractor";

export type AlignmentCandidate = {
  /** Stable id from the source record. */
  id: string;
  /** Name used in the proposal. */
  name: string;
  /** Profile/description text the matcher and scorer use. */
  profile: string;
  /** Optional supplementary text — sectors, certifications, contract value, country, etc. */
  extras?: Record<string, string | number | null | undefined>;
};

export type MatchAlignment = {
  recordType: "expert" | "project";
  recordId: string;
  recordName: string;
  criterionId: string;
  criterion: string;
  criterionWeight: number | null;
  /** 0–10 alignment score. */
  alignmentScore: number;
  /** Why this record supports this criterion. References specific facts from the record's profile. */
  rationale: string;
  /** Optional concern — license about to expire, expert overloaded, project value too small, etc. */
  riskFlag: string | null;
};

export type CriterionCoverage = {
  criterionId: string;
  criterion: string;
  weight: number | null;
  /** 0–10 aggregate coverage score across all records. */
  coverageScore: number;
  /** Names of the top 1–3 records that anchor this criterion. */
  topRecords: string[];
};

export type AlignmentReport = {
  alignments: MatchAlignment[];
  coverageByCriterion: CriterionCoverage[];
  /** 1–3 sentence narrative — overall fit story for the bid. */
  summary: string;
};

const ALIGNER_SYSTEM_PROMPT = `You are a senior bid director with 25 years of experience scoring competitive technical proposals. Your single job in this conversation is to map a firm's selected experts and projects to a tender's evaluation criteria, scoring each alignment 0–10 and writing a one-sentence rationale that an evaluator would find credible.

Operating principles, in priority order:

1. EVIDENCE-ANCHORED RATIONALES. Every rationale must cite SPECIFIC facts from the candidate's profile — project name, contract value, sector, client, year, certification, license number, role. "Dr. Alemu has water expertise" is forbidden. "Dr. Alemu's 2022 Sebeta WASH project (ETB 18M, World Bank) demonstrates EPANET-based hydraulic modelling" is required.

2. CRITERION LITERALISM. Use the tender's criterion names verbatim. Do not paraphrase to make them prettier. If the criterion is "Comprehension of TOR", score against that, not against "Understanding of Scope".

3. WEIGHT AWARENESS. A 30%-weighted criterion deserves more attention than a 5%-weighted one. Coverage gaps on heavy-weighted criteria are bigger risks; surface them in the summary.

4. HONEST SCORING. 10/10 means the candidate is a flawless fit with specific evidence. 7/10 is good with one minor gap. 4/10 means partial fit with a meaningful gap. 0/10 means no relevant evidence. Do NOT inflate scores to make the firm look better — over-confident self-scoring damages credibility.

5. RISK FLAGS, NOT EXCUSES. If a candidate's license expires before the project starts, the contract value is far below the tender size, or the candidate has not delivered the specific sub-skill demanded, flag it. The rewriter can mitigate; you must surface it.

6. NO INVENTION. Score and write rationale based ONLY on the candidate profiles supplied in the user message. Do NOT invent projects, license numbers, contract values, or experience years. If the candidate profile is thin, write a SHORT rationale and a LOW score — never pad with imagined facts.

7. STRICT JSON ONLY. Return exactly one JSON object matching the schema in the user prompt. No prose before or after. No markdown code fences. No commentary. Start with "{" and end with "}".`;

const MAX_INPUT_CANDIDATES = 12; // 6 experts + 6 projects keeps the prompt under ~12K tokens
const MAX_INPUT_CRITERIA = 8;    // top 8 by weight; less-weighted criteria are scored deterministically downstream
const PROFILE_TRUNCATE_CHARS = 1200;
const RESULT_RATIONALE_CHARS = 400;
const MAX_OUTPUT_ALIGNMENTS = 200; // cap defensively — 12 candidates × 8 criteria = 96 in practice
const MAX_OUTPUT_COVERAGES = 30;

function unwrapJson(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  return text;
}

function clamp(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function trimProfile(profile: string): string {
  return profile.replace(/\s+/g, " ").trim().slice(0, PROFILE_TRUNCATE_CHARS);
}

function formatExtras(extras: Record<string, string | number | null | undefined> | undefined): string {
  if (!extras) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(extras)) {
    if (value === null || value === undefined || value === "") continue;
    parts.push(`${key}=${String(value).slice(0, 120)}`);
  }
  return parts.length > 0 ? ` (${parts.join("; ")})` : "";
}

function buildAlignmentPrompt(input: {
  tenderTitle: string;
  clientName: string;
  comprehension: DeepTenderComprehension;
  experts: AlignmentCandidate[];
  projects: AlignmentCandidate[];
}): string {
  // Take the top-weighted criteria; if none have weights, take in order.
  const sortedCriteria = [...input.comprehension.criteria].sort((a, b) => {
    const aw = a.weight ?? 0;
    const bw = b.weight ?? 0;
    if (aw !== bw) return bw - aw;
    return Number(b.mandatory) - Number(a.mandatory);
  }).slice(0, MAX_INPUT_CRITERIA);

  const criteriaBlock = sortedCriteria.map((c, i) => {
    const weight = c.weight !== null ? `${c.weight}%` : "no weight stated";
    const mandatory = c.mandatory ? " — MANDATORY" : "";
    return `${i + 1}. [${c.id}] ${c.criterion} (${weight})${mandatory}`;
  }).join("\n");

  const experts = input.experts.slice(0, MAX_INPUT_CANDIDATES / 2);
  const projects = input.projects.slice(0, MAX_INPUT_CANDIDATES / 2);

  const expertBlock = experts.length === 0
    ? "(no experts supplied)"
    : experts.map((e, i) => `${i + 1}. [${e.id}] ${e.name}${formatExtras(e.extras)}\n   ${trimProfile(e.profile)}`).join("\n\n");

  const projectBlock = projects.length === 0
    ? "(no projects supplied)"
    : projects.map((p, i) => `${i + 1}. [${p.id}] ${p.name}${formatExtras(p.extras)}\n   ${trimProfile(p.profile)}`).join("\n\n");

  return `# Match-to-criteria alignment request

Tender: "${input.tenderTitle}"
Client: ${input.clientName}

## Evaluation criteria (top ${sortedCriteria.length} by weight)

${criteriaBlock || "(no criteria supplied)"}

## Candidate experts

${expertBlock}

## Candidate projects

${projectBlock}

## Output schema (strict JSON, no markdown, no commentary)

\`\`\`
{
  "summary": "1–3 sentence narrative of the firm's overall fit, calling out the strongest evidence and the biggest risks",
  "alignments": [
    {
      "recordType": "expert" | "project",
      "recordId": "<id from the candidate block>",
      "recordName": "<name from the candidate block>",
      "criterionId": "<id from the criteria block>",
      "alignmentScore": <number 0–10>,
      "rationale": "1 sentence citing SPECIFIC facts from the candidate profile",
      "riskFlag": "<short string or null>"
    }
  ],
  "coverageByCriterion": [
    {
      "criterionId": "<id from the criteria block>",
      "coverageScore": <number 0–10, aggregate across all candidates>,
      "topRecords": ["<name>", "<name>"]
    }
  ]
}
\`\`\`

Rules:
- Score every (expert × criterion) and (project × criterion) pair. Skip a pair only if it makes no sense (e.g. an HR-only criterion against a project).
- For each criterion you score, return AT LEAST one alignment for at least one candidate. Empty criteria coverage is a red flag — surface it in the summary.
- Rationales MUST cite specific facts. If a candidate's profile lacks the evidence to score a criterion, give a LOW score and a SHORT rationale explaining what's missing.
- topRecords lists the 1–3 candidates with the strongest evidence for that criterion, BY NAME.

Return ONLY the JSON object.
`;
}

function parseAlignment(raw: unknown): MatchAlignment | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const recordType = obj.recordType === "expert" ? "expert" : obj.recordType === "project" ? "project" : null;
  if (!recordType) return null;
  const recordId = typeof obj.recordId === "string" ? obj.recordId.trim() : "";
  const recordName = typeof obj.recordName === "string" ? obj.recordName.trim() : "";
  const criterionId = typeof obj.criterionId === "string" ? obj.criterionId.trim() : "";
  if (!recordId || !criterionId || !recordName) return null;
  const score = clamp(obj.alignmentScore, 0, 10);
  if (score === null) return null;
  const rationale = typeof obj.rationale === "string" ? obj.rationale.trim().slice(0, RESULT_RATIONALE_CHARS) : "";
  const riskFlag = typeof obj.riskFlag === "string" && obj.riskFlag.trim().length > 0 ? obj.riskFlag.trim().slice(0, 200) : null;
  return {
    recordType,
    recordId,
    recordName,
    criterionId,
    criterion: "", // filled in below from the comprehension lookup
    criterionWeight: null,
    alignmentScore: score,
    rationale,
    riskFlag,
  };
}

function parseCoverage(raw: unknown): { criterionId: string; coverageScore: number; topRecords: string[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const criterionId = typeof obj.criterionId === "string" ? obj.criterionId.trim() : "";
  if (!criterionId) return null;
  const score = clamp(obj.coverageScore, 0, 10);
  if (score === null) return null;
  const topRecords: string[] = Array.isArray(obj.topRecords)
    ? obj.topRecords.filter((r): r is string => typeof r === "string" && r.trim().length > 0).map((r) => r.trim().slice(0, 200)).slice(0, 5)
    : [];
  return { criterionId, coverageScore: score, topRecords };
}

/**
 * Parse + validate the raw JSON output. Pure function — exported for
 * unit tests so we can exercise edge cases without making AI calls.
 */
export function parseAlignmentReport(raw: string, comprehension: DeepTenderComprehension): AlignmentReport | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJson(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const summary = typeof obj.summary === "string" ? obj.summary.trim().slice(0, 800) : "";

  const criterionLookup = new Map(comprehension.criteria.map((c) => [c.id, c]));

  const alignments: MatchAlignment[] = [];
  if (Array.isArray(obj.alignments)) {
    for (const item of obj.alignments) {
      if (alignments.length >= MAX_OUTPUT_ALIGNMENTS) break;
      const parsedItem = parseAlignment(item);
      if (!parsedItem) continue;
      const criterion = criterionLookup.get(parsedItem.criterionId);
      if (!criterion) continue; // ignore unknown criterion ids
      parsedItem.criterion = criterion.criterion;
      parsedItem.criterionWeight = criterion.weight;
      alignments.push(parsedItem);
    }
  }

  const coverageByCriterion: CriterionCoverage[] = [];
  if (Array.isArray(obj.coverageByCriterion)) {
    for (const item of obj.coverageByCriterion) {
      if (coverageByCriterion.length >= MAX_OUTPUT_COVERAGES) break;
      const parsedItem = parseCoverage(item);
      if (!parsedItem) continue;
      const criterion = criterionLookup.get(parsedItem.criterionId);
      if (!criterion) continue;
      coverageByCriterion.push({
        criterionId: parsedItem.criterionId,
        criterion: criterion.criterion,
        weight: criterion.weight,
        coverageScore: parsedItem.coverageScore,
        topRecords: parsedItem.topRecords,
      });
    }
  }

  if (alignments.length === 0 && coverageByCriterion.length === 0 && summary.length === 0) {
    return null;
  }

  return { alignments, coverageByCriterion, summary };
}

/**
 * Render the alignment report as a compact prompt-friendly text
 * block. Designed to be light on tokens — one bullet per alignment.
 */
export function formatAlignmentForPrompt(report: AlignmentReport): string {
  const lines: string[] = [];
  lines.push("## SEMANTIC MATCH-TO-CRITERIA ALIGNMENT (Claude-driven, scored 0–10)");
  if (report.summary) lines.push(`Summary: ${report.summary}`);

  if (report.coverageByCriterion.length > 0) {
    lines.push("");
    lines.push("### Coverage by criterion");
    for (const c of report.coverageByCriterion) {
      const weight = c.weight !== null ? ` (${c.weight}%)` : "";
      const top = c.topRecords.length > 0 ? ` — anchors: ${c.topRecords.join(", ")}` : "";
      lines.push(`- **${c.criterion}**${weight}: ${c.coverageScore}/10${top}`);
    }
  }

  if (report.alignments.length > 0) {
    lines.push("");
    lines.push("### Per-candidate alignment (cite these rationales when naming the candidate)");
    for (const a of report.alignments) {
      const weight = a.criterionWeight !== null ? ` (${a.criterionWeight}%)` : "";
      const risk = a.riskFlag ? ` [RISK: ${a.riskFlag}]` : "";
      lines.push(`- ${a.recordType === "expert" ? "Expert" : "Project"} *${a.recordName}* → "${a.criterion}"${weight}: ${a.alignmentScore}/10. ${a.rationale}${risk}`);
    }
  }

  return lines.join("\n");
}

/**
 * Run the alignment call. Returns null when:
 *   – AI provider is not configured
 *   – comprehension has no criteria
 *   – no experts AND no projects were supplied
 *   – the AI call failed or returned malformed JSON
 *
 * Callers MUST tolerate null and continue with legacy lexical
 * matching.
 */
export async function alignMatchesToEvaluatorCriteria(input: {
  tenderTitle: string;
  clientName: string;
  comprehension: DeepTenderComprehension | null;
  experts: AlignmentCandidate[];
  projects: AlignmentCandidate[];
}): Promise<AlignmentReport | null> {
  if (!isAIEnabled()) return null;
  if (!input.comprehension || input.comprehension.criteria.length === 0) return null;
  if (input.experts.length === 0 && input.projects.length === 0) return null;

  const prompt = buildAlignmentPrompt({
    tenderTitle: input.tenderTitle,
    clientName: input.clientName,
    comprehension: input.comprehension,
    experts: input.experts,
    projects: input.projects,
  });

  let raw: string;
  try {
    raw = await generateWithFallback(prompt, { systemPrompt: ALIGNER_SYSTEM_PROMPT });
  } catch (err) {
    logger.warn(`[semantic-match-aligner] AI call failed: ${err instanceof Error ? err.message : String(err)} — alignment skipped.`);
    return null;
  }

  const report = parseAlignmentReport(raw, input.comprehension);
  if (!report) {
    logger.warn("[semantic-match-aligner] AI returned malformed JSON — alignment skipped.");
    return null;
  }
  return report;
}

/**
 * Exposed for unit tests — exercise the prompt-builder without an AI
 * call.
 */
export const __testing__ = { buildAlignmentPrompt };
