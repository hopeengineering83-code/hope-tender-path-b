/**
 * Evaluator Persona Simulator.
 *
 * Runs a synthetic evaluator committee against the current tender package.
 * The upgraded v2 simulator does not read proposal text in isolation: it also
 * receives requirement, compliance, selected expert, selected project, and match
 * rationale context so each persona can judge the submission like a real panel.
 */

import { generateWithFallback } from "../ai";

const UNIVERSAL_EVALUATOR_RULES = `Universal evaluator rules:
- Score like a real evaluation panel, not a friendly writing assistant.
- Anchor objections to visible evidence, requirements, selected experts/projects, or compliance gaps.
- Do not invent facts, project values, expert credentials, or missing certificates.
- If evidence is missing, say exactly what the bid team must verify before submission.
- Treat mandatory eligibility/compliance issues as potential disqualification risks.
- Return JSON only.`;

const TECHNICAL_EVALUATOR_PROMPT = `You are a senior technical evaluator on a tender evaluation panel. You have reviewed proposals for World Bank, UNDP, AfDB, and government clients for 25 years. Your specialty is technical methodology, expert fit, technical scope coverage, project comparability, and delivery realism.

${UNIVERSAL_EVALUATOR_RULES}

Output ONLY a valid JSON object with this exact shape:
{
  "personaSummary": "1-2 sentence summary of how a technical evaluator reads this proposal",
  "criterionScores": [
    { "criterion": "exact criterion or inferred technical criterion", "score": 0-10, "rationale": "1-2 sentences explaining the score" }
  ],
  "objections": [
    { "title": "short title of the objection", "severity": "HIGH" | "MEDIUM" | "LOW", "detail": "specific weakness and why it matters" }
  ],
  "commendations": [
    { "title": "short title", "detail": "specific strength" }
  ],
  "actions": [
    { "title": "bid-team action", "owner": "TECHNICAL" | "COMPLIANCE" | "COMMERCIAL" | "PROPOSAL" | "MANAGEMENT", "priority": "HIGH" | "MEDIUM" | "LOW", "detail": "exact action to improve score" }
  ]
}`;

const COMPLIANCE_EVALUATOR_PROMPT = `You are a senior compliance / procurement evaluator on a tender evaluation panel. Your specialty is mandatory requirement coverage, eligibility documentation, form completion, exact file names, submission-rule fidelity, and disqualification risk.

${UNIVERSAL_EVALUATOR_RULES}

Score harshly on missing mandatory items. A single unaddressed mandatory requirement can disqualify a bid.

Output ONLY a valid JSON object with the same shape: personaSummary, criterionScores, objections, commendations, actions.`;

const END_USER_EVALUATOR_PROMPT = `You are a senior end-user evaluator on a tender evaluation panel — the operational stakeholder who will use the firm's services if they win. Your specialty is practical deliverability: mobilisation, workplan realism, communication, continuity, risk management, field execution, and whether the selected team can actually do the work.

${UNIVERSAL_EVALUATOR_RULES}

Output ONLY a valid JSON object with the same shape: personaSummary, criterionScores, objections, commendations, actions.`;

const COMMERCIAL_EVALUATOR_PROMPT = `You are a senior commercial evaluator on a tender evaluation panel. Your specialty is financial capacity, value for money, commercial risk, contract terms, price-envelope separation, validity period, guarantees, tax/legal proof, and whether the bid is commercially credible.

${UNIVERSAL_EVALUATOR_RULES}

If the proposal is technical-only, focus on financial capacity evidence and commercial compliance, not price.

Output ONLY a valid JSON object with the same shape: personaSummary, criterionScores, objections, commendations, actions.`;

export type EvaluatorPersona = "TECHNICAL" | "COMPLIANCE" | "END_USER" | "COMMERCIAL";

export interface PersonaAssessment {
  persona: EvaluatorPersona;
  personaSummary: string;
  criterionScores: Array<{ criterion: string; score: number; rationale: string }>;
  objections: Array<{ title: string; severity: "HIGH" | "MEDIUM" | "LOW"; detail: string }>;
  commendations: Array<{ title: string; detail: string }>;
  actions: Array<{ title: string; owner: "TECHNICAL" | "COMPLIANCE" | "COMMERCIAL" | "PROPOSAL" | "MANAGEMENT"; priority: "HIGH" | "MEDIUM" | "LOW"; detail: string }>;
  durationMs: number;
}

export interface SimulationResult {
  predictedOverallScore: number;
  verdict: "STRONG_BID" | "NEEDS_WORK" | "WEAK_BID";
  personaAssessments: PersonaAssessment[];
  topObjections: Array<{ persona: EvaluatorPersona; title: string; severity: "HIGH" | "MEDIUM" | "LOW"; detail: string }>;
  topCommendations: Array<{ persona: EvaluatorPersona; title: string; detail: string }>;
  actionPlan: Array<{ persona: EvaluatorPersona; title: string; owner: "TECHNICAL" | "COMPLIANCE" | "COMMERCIAL" | "PROPOSAL" | "MANAGEMENT"; priority: "HIGH" | "MEDIUM" | "LOW"; detail: string }>;
  riskRegister: Array<{ title: string; severity: "HIGH" | "MEDIUM" | "LOW"; detail: string }>;
  rationale: string;
  computedAt: string;
}

export interface EvaluatorContext {
  requirements?: string[];
  complianceGaps?: string[];
  selectedExperts?: string[];
  selectedProjects?: string[];
  matchRationales?: string[];
  readinessSummary?: string;
}

function contextBlock(context?: EvaluatorContext): string {
  if (!context) return "No structured tender context supplied.";
  const lines = [
    "## STRUCTURED TENDER CONTEXT",
    context.readinessSummary ? `Readiness: ${context.readinessSummary}` : null,
    "\nMandatory / scored requirements:",
    ...(context.requirements ?? []).slice(0, 35).map((line) => `- ${line}`),
    "\nOpen compliance gaps:",
    ...((context.complianceGaps ?? []).length ? (context.complianceGaps ?? []).slice(0, 25).map((line) => `- ${line}`) : ["- None supplied"]),
    "\nSelected experts:",
    ...((context.selectedExperts ?? []).length ? (context.selectedExperts ?? []).slice(0, 18).map((line) => `- ${line}`) : ["- None selected"]),
    "\nSelected project references:",
    ...((context.selectedProjects ?? []).length ? (context.selectedProjects ?? []).slice(0, 18).map((line) => `- ${line}`) : ["- None selected"]),
    "\nCurrent match rationales:",
    ...((context.matchRationales ?? []).length ? (context.matchRationales ?? []).slice(0, 20).map((line) => `- ${line}`) : ["- None supplied"]),
  ].filter((line): line is string => line !== null);
  return lines.join("\n").slice(0, 18_000);
}

function buildUserPrompt(proposalMarkdown: string, evaluationCriteria: string, tenderTitle: string, context?: EvaluatorContext): string {
  return `Read the proposal and structured tender context below for tender: ${tenderTitle}

EVALUATION CRITERIA / METHODOLOGY:
${evaluationCriteria.slice(0, 5_000) || "No explicit criteria — infer from requirements and score against overall proposal quality and fit-for-purpose."}

${contextBlock(context)}

PROPOSAL MARKDOWN / PACKAGE TEXT (truncated to first 60K chars if large):
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
    const matches = [...cleaned.matchAll(/\{[\s\S]*?\}/g)].sort((a, b) => b[0].length - a[0].length);
    for (const m of matches) {
      try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { /* continue */ }
    }
  }
  return null;
}

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0;
}

function severity(value: unknown): "HIGH" | "MEDIUM" | "LOW" {
  return (["HIGH", "MEDIUM", "LOW"].includes(value as string) ? value : "MEDIUM") as "HIGH" | "MEDIUM" | "LOW";
}

function owner(value: unknown): "TECHNICAL" | "COMPLIANCE" | "COMMERCIAL" | "PROPOSAL" | "MANAGEMENT" {
  return (["TECHNICAL", "COMPLIANCE", "COMMERCIAL", "PROPOSAL", "MANAGEMENT"].includes(value as string) ? value : "PROPOSAL") as "TECHNICAL" | "COMPLIANCE" | "COMMERCIAL" | "PROPOSAL" | "MANAGEMENT";
}

async function runPersona(persona: EvaluatorPersona, systemPrompt: string, userPrompt: string): Promise<PersonaAssessment | null> {
  const t0 = Date.now();
  try {
    const raw = await generateWithFallback(userPrompt, { systemPrompt });
    const parsed = safeParseJson(raw);
    if (!parsed) {
      console.warn(`[evaluator-simulator] Persona ${persona} returned malformed JSON.`);
      return null;
    }

    const personaSummary = typeof parsed.personaSummary === "string" ? parsed.personaSummary.slice(0, 500) : "";
    const criterionScores = Array.isArray(parsed.criterionScores)
      ? (parsed.criterionScores as Array<Record<string, unknown>>).map((c) => ({
          criterion: typeof c.criterion === "string" ? c.criterion.slice(0, 180) : "",
          score: clampScore(c.score),
          rationale: typeof c.rationale === "string" ? c.rationale.slice(0, 360) : "",
        })).filter((c) => c.criterion.length > 0)
      : [];
    const objections = Array.isArray(parsed.objections)
      ? (parsed.objections as Array<Record<string, unknown>>).map((o) => ({
          title: typeof o.title === "string" ? o.title.slice(0, 120) : "",
          severity: severity(o.severity),
          detail: typeof o.detail === "string" ? o.detail.slice(0, 420) : "",
        })).filter((o) => o.title.length > 0)
      : [];
    const commendations = Array.isArray(parsed.commendations)
      ? (parsed.commendations as Array<Record<string, unknown>>).map((c) => ({
          title: typeof c.title === "string" ? c.title.slice(0, 120) : "",
          detail: typeof c.detail === "string" ? c.detail.slice(0, 360) : "",
        })).filter((c) => c.title.length > 0)
      : [];
    const actions = Array.isArray(parsed.actions)
      ? (parsed.actions as Array<Record<string, unknown>>).map((a) => ({
          title: typeof a.title === "string" ? a.title.slice(0, 140) : "",
          owner: owner(a.owner),
          priority: severity(a.priority),
          detail: typeof a.detail === "string" ? a.detail.slice(0, 500) : "",
        })).filter((a) => a.title.length > 0)
      : [];

    return { persona, personaSummary, criterionScores, objections, commendations, actions, durationMs: Date.now() - t0 };
  } catch (err) {
    console.warn(`[evaluator-simulator] Persona ${persona} call failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

function synthesizeOverallScore(assessments: PersonaAssessment[]): number {
  if (assessments.length === 0) return 0;
  const personaAverages = assessments.map((a) => {
    if (a.criterionScores.length === 0) return 50;
    const sum = a.criterionScores.reduce((s, c) => s + c.score, 0);
    return (sum / a.criterionScores.length) * 10;
  });
  const avg = personaAverages.reduce((s, v) => s + v, 0) / personaAverages.length;
  const highObjectionPenalty = assessments.flatMap((a) => a.objections).filter((o) => o.severity === "HIGH").length * 3;
  return Math.max(0, Math.min(100, Math.round(avg - highObjectionPenalty)));
}

function synthesizeVerdict(score: number): SimulationResult["verdict"] {
  if (score >= 75) return "STRONG_BID";
  if (score >= 55) return "NEEDS_WORK";
  return "WEAK_BID";
}

function synthesizeTopObjections(assessments: PersonaAssessment[]): SimulationResult["topObjections"] {
  const all = assessments.flatMap((a) => a.objections.map((o) => ({ persona: a.persona, ...o })));
  const severityRank: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  all.sort((a, b) => (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0));
  return all.slice(0, 8);
}

function synthesizeTopCommendations(assessments: PersonaAssessment[]): SimulationResult["topCommendations"] {
  return assessments.flatMap((a) => a.commendations.map((c) => ({ persona: a.persona, ...c }))).slice(0, 5);
}

function synthesizeActionPlan(assessments: PersonaAssessment[]): SimulationResult["actionPlan"] {
  const severityRank: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const all = assessments.flatMap((a) => a.actions.map((action) => ({ persona: a.persona, ...action })));
  all.sort((a, b) => (severityRank[b.priority] ?? 0) - (severityRank[a.priority] ?? 0));
  return all.slice(0, 10);
}

function synthesizeRiskRegister(objections: SimulationResult["topObjections"]): SimulationResult["riskRegister"] {
  return objections.slice(0, 8).map((o) => ({ title: o.title, severity: o.severity, detail: `${o.persona}: ${o.detail}` }));
}

function synthesizeRationale(score: number, verdict: SimulationResult["verdict"], objectionCount: number, actionCount: number): string {
  if (verdict === "STRONG_BID") {
    return `Predicted overall score ${score}/100 — STRONG BID. The evidence-aware panel sees this as competitive. Resolve the remaining ${actionCount} action(s) to reduce evaluator objections before submission.`;
  }
  if (verdict === "WEAK_BID") {
    return `Predicted overall score ${score}/100 — WEAK BID. The panel found high-risk technical/compliance/commercial weaknesses. Address high-priority actions before submission or reconsider bid/no-bid if mitigation is not feasible.`;
  }
  return `Predicted overall score ${score}/100 — NEEDS WORK. The proposal has usable strengths, but ${objectionCount} objection(s) and ${actionCount} action(s) should be closed before final export.`;
}

export async function simulateEvaluatorPanel(input: {
  tenderTitle: string;
  proposalMarkdown: string;
  evaluationCriteria: string;
  context?: EvaluatorContext;
}): Promise<SimulationResult | null> {
  const userPrompt = buildUserPrompt(input.proposalMarkdown, input.evaluationCriteria, input.tenderTitle, input.context);
  const settled = await Promise.allSettled([
    runPersona("TECHNICAL", TECHNICAL_EVALUATOR_PROMPT, userPrompt),
    runPersona("COMPLIANCE", COMPLIANCE_EVALUATOR_PROMPT, userPrompt),
    runPersona("END_USER", END_USER_EVALUATOR_PROMPT, userPrompt),
    runPersona("COMMERCIAL", COMMERCIAL_EVALUATOR_PROMPT, userPrompt),
  ]);

  const assessments = settled.flatMap((s) => (s.status === "fulfilled" && s.value ? [s.value] : []));
  if (assessments.length === 0) {
    console.warn("[evaluator-simulator] All personas failed — simulation returning null.");
    return null;
  }

  const predictedOverallScore = synthesizeOverallScore(assessments);
  const verdict = synthesizeVerdict(predictedOverallScore);
  const topObjections = synthesizeTopObjections(assessments);
  const topCommendations = synthesizeTopCommendations(assessments);
  const actionPlan = synthesizeActionPlan(assessments);
  const riskRegister = synthesizeRiskRegister(topObjections);
  const rationale = synthesizeRationale(predictedOverallScore, verdict, topObjections.length, actionPlan.length);

  const totalMs = assessments.reduce((s, a) => Math.max(s, a.durationMs), 0);
  console.info(`[evaluator-simulator] Evidence-aware panel of ${assessments.length}/4 personas completed in ${Math.round(totalMs / 100) / 10}s — verdict ${verdict} (${predictedOverallScore}/100), ${topObjections.length} objection(s), ${actionPlan.length} action(s).`);

  return {
    predictedOverallScore,
    verdict,
    personaAssessments: assessments,
    topObjections,
    topCommendations,
    actionPlan,
    riskRegister,
    rationale,
    computedAt: new Date().toISOString(),
  };
}
