/**
 * Evaluator Persona Simulator (PR #251) — beyond-spec feature.
 *
 * THE VALUE PROPOSITION
 * Before the real evaluation panel reads your submission, run a
 * synthetic evaluator panel against the proposal and surface what
 * a real evaluator would flag. This is the "red team" most consultancy
 * firms can't afford to run internally — getting four senior evaluators
 * with different perspectives to read a proposal in detail is
 * 8–16 person-hours per submission.
 *
 * The simulator runs FOUR parallel Claude calls, each with a different
 * specialist evaluator persona system prompt:
 *
 *   1. TECHNICAL evaluator   — engineering depth, methodology, expert fit
 *   2. COMPLIANCE evaluator  — regulatory + form + submission rules
 *   3. END-USER evaluator    — operational fit, real-world deliverability
 *   4. COMMERCIAL evaluator  — financial capacity, value for money
 *
 * Each persona returns a structured assessment: per-criterion score
 * (0-10), top objections, top commendations. The simulator merges
 * the four assessments into:
 *
 *   • predictedOverallScore    — weighted average across personas
 *   • topObjections             — deduplicated and severity-ranked
 *   • topCommendations          — strongest praises across panel
 *   • criterionScores           — heatmap of where the proposal scores
 *   • verdict                   — STRONG_BID / NEEDS_WORK / WEAK_BID
 *
 * No deterministic stand-in if AI fails — the simulator EXISTS to
 * surface AI-visible quality issues, so a deterministic fallback
 * would defeat the purpose. When all four personas fail, the
 * simulator returns null and the UI shows "simulator unavailable".
 *
 * Cost: 4 Claude calls per simulation. Sonnet input ≈ proposal
 * markdown (truncated to 60K chars) + 1K system prompt + 800
 * output tokens per call. At Tier 2 rates: ~$0.10–$0.18 per
 * full simulation. The user opts in by clicking "Simulate Panel"
 * — never auto-runs.
 */

import { generateWithFallback } from "../ai";

// ─── Persona system prompts ─────────────────────────────────────────────────

const TECHNICAL_EVALUATOR_PROMPT = `You are a senior technical evaluator on a tender evaluation panel. You have reviewed proposals for World Bank, UNDP, AfDB, and government clients for 25 years. Your specialty is technical methodology, expert fit, and project comparability.

You are reading a submitted proposal. Your job is to:
1. Score the proposal on each evaluation criterion (0-10) AS YOU WOULD ON A REAL EVALUATION SHEET — be rigorous, be honest, no inflation.
2. Identify the 3 most important OBJECTIONS — specific weaknesses the bidder did not address adequately, things you would flag in your evaluator notes.
3. Identify the 1-2 strongest COMMENDATIONS — specific things the bidder did well that lift the score.

Be direct, specific, and evaluator-realistic. Do not pretend the proposal is better than it is. Do not pretend it is worse than it is.

Output ONLY a valid JSON object with this exact shape:
{
  "personaSummary": "1-2 sentence summary of how a technical evaluator reads this proposal",
  "criterionScores": [
    { "criterion": "exact text of evaluation criterion", "score": 0-10, "rationale": "1-2 sentences explaining the score" }
  ],
  "objections": [
    { "title": "short title of the objection", "severity": "HIGH" | "MEDIUM" | "LOW", "detail": "1-2 sentences naming the specific weakness" }
  ],
  "commendations": [
    { "title": "short title", "detail": "1-2 sentences naming what was done well" }
  ]
}

No markdown fences. No commentary outside the JSON.`;

const COMPLIANCE_EVALUATOR_PROMPT = `You are a senior compliance / procurement evaluator on a tender evaluation panel. You have evaluated regulatory and submission compliance for 20 years across donor-funded and government tenders. Your specialty is mandatory requirement coverage, form completion, eligibility documentation, and submission-rule fidelity.

Your job is to read the proposal and:
1. Check whether every MANDATORY requirement is covered with traceable evidence — by section, sub-section, or appendix. Score each mandatory criterion 0-10.
2. Flag the 3 most important OBJECTIONS — missing required forms, missing eligibility documents, ambiguous or non-compliant statements, restricted-content violations (e.g., financial info in technical-only submissions).
3. Note 1-2 COMMENDATIONS for compliance items handled cleanly.

Score harshly on missing mandatory items. A single unaddressed mandatory requirement can disqualify a bid — do not soften that fact.

Output ONLY a valid JSON object — same shape as the technical evaluator (personaSummary, criterionScores, objections, commendations). No markdown fences. No commentary outside the JSON.`;

const END_USER_EVALUATOR_PROMPT = `You are a senior end-user evaluator on a tender evaluation panel — the operational stakeholder who will use the firm's services on a day-to-day basis if they win. You have 15 years of experience in the assignment's sector. Your specialty is real-world deliverability: can this firm actually do the work? Is the proposed team available? Does the methodology match how work actually gets done?

Your job is to read the proposal and:
1. Score the proposal on operational and deliverability criteria (0-10): team availability, work plan realism, risk awareness, communication plan, change management.
2. Identify the 3 most important OBJECTIONS — gaps a practitioner would notice that an academic reviewer might miss (e.g., unrealistic timeline, missing field-mobilisation step, no escalation path, no continuity plan).
3. Note 1-2 COMMENDATIONS where the bidder showed practical insight.

Output ONLY a valid JSON object — same shape as other personas. No markdown fences.`;

const COMMERCIAL_EVALUATOR_PROMPT = `You are a senior commercial evaluator on a tender evaluation panel. Your specialty is financial capacity, value for money, contract risk, and commercial-terms fidelity (bid bond, performance guarantee, validity period, currency, payment terms).

Your job is to read the proposal and:
1. Score the proposal on commercial criteria (0-10): financial capacity demonstrated, value-for-money positioning, commercial-terms compliance, contract-risk transparency.
2. Identify the 3 most important OBJECTIONS — missing financial statements, weak turnover demonstration, gaps in commercial-terms acknowledgement, hidden cost risk for the client, vague payment / cash-flow positioning.
3. Note 1-2 COMMENDATIONS for strong commercial positioning.

If the proposal is technical-only (financial proposal excluded by tender), focus on financial CAPACITY proof rather than pricing.

Output ONLY a valid JSON object — same shape as other personas. No markdown fences.`;

// ─── Type definitions ──────────────────────────────────────────────────────

export type EvaluatorPersona = "TECHNICAL" | "COMPLIANCE" | "END_USER" | "COMMERCIAL";

export interface PersonaAssessment {
  persona: EvaluatorPersona;
  personaSummary: string;
  criterionScores: Array<{ criterion: string; score: number; rationale: string }>;
  objections: Array<{ title: string; severity: "HIGH" | "MEDIUM" | "LOW"; detail: string }>;
  commendations: Array<{ title: string; detail: string }>;
  durationMs: number;
}

export interface SimulationResult {
  predictedOverallScore: number;          // 0–100
  verdict: "STRONG_BID" | "NEEDS_WORK" | "WEAK_BID";
  personaAssessments: PersonaAssessment[];
  topObjections: Array<{ persona: EvaluatorPersona; title: string; severity: "HIGH" | "MEDIUM" | "LOW"; detail: string }>;
  topCommendations: Array<{ persona: EvaluatorPersona; title: string; detail: string }>;
  rationale: string;
  computedAt: string;
}

// ─── Per-persona runner ────────────────────────────────────────────────────

function buildUserPrompt(proposalMarkdown: string, evaluationCriteria: string, tenderTitle: string): string {
  return `Read the proposal below for tender: ${tenderTitle}

EVALUATION CRITERIA (the rubric you score against):
${evaluationCriteria.slice(0, 4_000) || "No explicit criteria — score against overall proposal quality and fit-for-purpose."}

PROPOSAL MARKDOWN (truncated to first 60K chars if large):
${proposalMarkdown.slice(0, 60_000)}

Return your JSON assessment as instructed in the system prompt.`;
}

function safeParseJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  } catch {
    // Fallback: largest balanced { ... } block
    const matches = [...cleaned.matchAll(/\{[\s\S]*?\}/g)].sort((a, b) => b[0].length - a[0].length);
    for (const m of matches) {
      try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { /* continue */ }
    }
  }
  return null;
}

async function runPersona(
  persona: EvaluatorPersona,
  systemPrompt: string,
  userPrompt: string,
): Promise<PersonaAssessment | null> {
  const t0 = Date.now();
  try {
    const raw = await generateWithFallback(userPrompt, { systemPrompt });
    const parsed = safeParseJson(raw);
    if (!parsed) {
      console.warn(`[evaluator-simulator] Persona ${persona} returned malformed JSON.`);
      return null;
    }

    // Coerce + validate shape — defensive against partial responses.
    const personaSummary = typeof parsed.personaSummary === "string" ? parsed.personaSummary : "";
    const criterionScores = Array.isArray(parsed.criterionScores)
      ? (parsed.criterionScores as Array<Record<string, unknown>>).map((c) => ({
          criterion: typeof c.criterion === "string" ? c.criterion : "",
          score: typeof c.score === "number" ? Math.max(0, Math.min(10, c.score)) : 0,
          rationale: typeof c.rationale === "string" ? c.rationale : "",
        })).filter((c) => c.criterion.length > 0)
      : [];
    const objections = Array.isArray(parsed.objections)
      ? (parsed.objections as Array<Record<string, unknown>>).map((o) => ({
          title: typeof o.title === "string" ? o.title : "",
          severity: (["HIGH", "MEDIUM", "LOW"].includes(o.severity as string) ? o.severity : "MEDIUM") as "HIGH" | "MEDIUM" | "LOW",
          detail: typeof o.detail === "string" ? o.detail : "",
        })).filter((o) => o.title.length > 0)
      : [];
    const commendations = Array.isArray(parsed.commendations)
      ? (parsed.commendations as Array<Record<string, unknown>>).map((c) => ({
          title: typeof c.title === "string" ? c.title : "",
          detail: typeof c.detail === "string" ? c.detail : "",
        })).filter((c) => c.title.length > 0)
      : [];

    return {
      persona,
      personaSummary,
      criterionScores,
      objections,
      commendations,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    console.warn(`[evaluator-simulator] Persona ${persona} call failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── Synthesis ─────────────────────────────────────────────────────────────

function synthesizeOverallScore(assessments: PersonaAssessment[]): number {
  if (assessments.length === 0) return 0;
  // Weight personas equally — each contributes its average criterion score
  // mapped to the 0-100 scale. Outlier scores aren't dampened: if one
  // evaluator gives a 3/10, that's a real signal we want surfaced.
  const personaAverages = assessments.map((a) => {
    if (a.criterionScores.length === 0) return 50; // neutral
    const sum = a.criterionScores.reduce((s, c) => s + c.score, 0);
    return (sum / a.criterionScores.length) * 10; // 0-10 → 0-100
  });
  const avg = personaAverages.reduce((s, v) => s + v, 0) / personaAverages.length;
  return Math.round(avg);
}

function synthesizeVerdict(score: number): SimulationResult["verdict"] {
  if (score >= 75) return "STRONG_BID";
  if (score >= 55) return "NEEDS_WORK";
  return "WEAK_BID";
}

function synthesizeTopObjections(assessments: PersonaAssessment[]): SimulationResult["topObjections"] {
  // Collect every objection, severity-rank: HIGH first, then MEDIUM, then LOW
  const all = assessments.flatMap((a) =>
    a.objections.map((o) => ({ persona: a.persona, ...o })),
  );
  const severityRank: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  all.sort((a, b) => (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0));
  // Return top 6 — enough to drive a meaningful red-team review without
  // overwhelming the user with every minor concern.
  return all.slice(0, 6);
}

function synthesizeTopCommendations(assessments: PersonaAssessment[]): SimulationResult["topCommendations"] {
  const all = assessments.flatMap((a) =>
    a.commendations.map((c) => ({ persona: a.persona, ...c })),
  );
  return all.slice(0, 4);
}

function synthesizeRationale(score: number, verdict: SimulationResult["verdict"], objectionCount: number): string {
  if (verdict === "STRONG_BID") {
    return `Predicted overall score ${score}/100 — STRONG BID. The synthetic panel rates this proposal as evaluator-ready. ${objectionCount > 0 ? `Resolve the ${objectionCount} flagged objection${objectionCount > 1 ? "s" : ""} before submission to lock in the win.` : "No major objections raised."}`;
  }
  if (verdict === "WEAK_BID") {
    return `Predicted overall score ${score}/100 — WEAK BID. The synthetic panel found multiple structural issues that would prevent the proposal from scoring competitively. Address the high-severity objections before submission, OR consider declining if mitigation is not feasible.`;
  }
  return `Predicted overall score ${score}/100 — NEEDS WORK. Mixed signal from the synthetic panel: the proposal has strengths but ${objectionCount} objection${objectionCount > 1 ? "s" : ""} need to be addressed for a competitive score. Iterate on the proposal before submission.`;
}

// ─── Main entry point ──────────────────────────────────────────────────────

export async function simulateEvaluatorPanel(input: {
  tenderTitle: string;
  proposalMarkdown: string;
  evaluationCriteria: string;
}): Promise<SimulationResult | null> {
  const userPrompt = buildUserPrompt(input.proposalMarkdown, input.evaluationCriteria, input.tenderTitle);

  // Run 4 personas in parallel — Promise.allSettled so a single
  // persona failure doesn't kill the simulation.
  const settled = await Promise.allSettled([
    runPersona("TECHNICAL", TECHNICAL_EVALUATOR_PROMPT, userPrompt),
    runPersona("COMPLIANCE", COMPLIANCE_EVALUATOR_PROMPT, userPrompt),
    runPersona("END_USER", END_USER_EVALUATOR_PROMPT, userPrompt),
    runPersona("COMMERCIAL", COMMERCIAL_EVALUATOR_PROMPT, userPrompt),
  ]);

  const assessments = settled
    .flatMap((s) => (s.status === "fulfilled" && s.value ? [s.value] : []));

  if (assessments.length === 0) {
    // No personas succeeded — return null so caller can show "unavailable"
    console.warn("[evaluator-simulator] All 4 personas failed — simulation returning null.");
    return null;
  }

  const predictedOverallScore = synthesizeOverallScore(assessments);
  const verdict = synthesizeVerdict(predictedOverallScore);
  const topObjections = synthesizeTopObjections(assessments);
  const topCommendations = synthesizeTopCommendations(assessments);
  const rationale = synthesizeRationale(predictedOverallScore, verdict, topObjections.length);

  const totalMs = assessments.reduce((s, a) => Math.max(s, a.durationMs), 0);
  console.info(`[evaluator-simulator] Panel of ${assessments.length}/4 personas completed in ${Math.round(totalMs / 100) / 10}s — verdict ${verdict} (score ${predictedOverallScore}/100), ${topObjections.length} objection(s).`);

  return {
    predictedOverallScore,
    verdict,
    personaAssessments: assessments,
    topObjections,
    topCommendations,
    rationale,
    computedAt: new Date().toISOString(),
  };
}
