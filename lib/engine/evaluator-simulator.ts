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

export interface CalibrationNote {
  /** Canonical criterion name (lower-cased, trimmed) used as the join key. */
  criterion: string;
  /** Scores per persona for this criterion. */
  scoresByPersona: Array<{ persona: EvaluatorPersona; score: number; rationale: string }>;
  /** Maximum - minimum across personas. 0 means full agreement; 5+ means a calibration alarm. */
  spread: number;
  /** "agreed" | "moderate" | "alarm" — derived from spread for quick display. */
  level: "agreed" | "moderate" | "alarm";
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
  /**
   * Cross-persona calibration notes: lists criteria where personas
   * disagreed materially (closes gap #9 — no scoring calibration
   * across personas). Empty when every shared criterion was scored
   * within 2 points across all personas, or when no shared criteria
   * were supplied.
   */
  calibrationNotes: CalibrationNote[];
  computedAt: string;
}

export interface EvaluatorContext {
  requirements?: string[];
  complianceGaps?: string[];
  selectedExperts?: string[];
  selectedProjects?: string[];
  matchRationales?: string[];
  readinessSummary?: string;
  /**
   * Optional list of canonical criterion names that ALL personas
   * should score against (closes gap #9 — cross-persona scoring
   * calibration). When supplied, each persona is instructed to use
   * THESE exact criterion names, enabling spread-detection across
   * personas on the same criterion. Typically populated from the
   * deep-comprehension extractor when TENDER_DEEP_REASONING is on.
   */
  sharedCriteria?: Array<{ id: string; criterion: string; weight: number | null }>;
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

/**
 * Domain-focused proposal slicing (gap #9). Each persona scores
 * against different sections of the proposal in real evaluation
 * panels — TECHNICAL reads the methodology, COMPLIANCE reads the
 * matrix and requirements, END_USER reads the workplan and
 * experience, COMMERCIAL reads additional info and financial blocks.
 *
 * This function returns a per-persona "focused excerpt" that
 * concatenates the sections that persona genuinely cares about.
 * When the persona's domain sections are not findable in the
 * markdown (e.g., the proposal lacks Section E), the focused
 * excerpt falls back to the full proposal (truncated).
 *
 * Exported for unit tests.
 */
export function extractPersonaFocusedSlice(proposalMarkdown: string, persona: EvaluatorPersona): string {
  // Section patterns each persona focuses on, in priority order. The
  // patterns allow optional numbering prefixes (A.4, C.2 etc.) and an
  // optional "Section X:" prefix before the keyword block.
  const sectionPatterns: Record<EvaluatorPersona, RegExp[]> = {
    TECHNICAL: [
      // Top-level Section C or any C.N sub-section, plus methodology-style keywords
      /^#{1,3}\s+(?:section\s+c\b|c\.\d|.*?(?:technical approach|technical methodology|methodology|work plan|sector-specific))/im,
      // A.4 Proposed Project Team / Principal Qualifications — allow A.4 anywhere in the heading
      /^#{1,3}\s+(?:section\s+a\.4|a\.4\b|.*?(?:principal qualifications|team-to-project|proposed (?:project )?team))/im,
    ],
    COMPLIANCE: [
      /^#{1,3}\s+(?:section\s+e\b|e\.\d|.*?(?:compliance matrix|bid compliance|evaluation criteria response|evaluation response mirror))/im,
      /^#{1,3}\s+(?:section\s+d\.4|d\.4\b|d\.5\b|.*?(?:declaration|no conflict))/im,
    ],
    END_USER: [
      /^#{1,3}\s+(?:section\s+c\.6|c\.6\b|.*?(?:work plan and schedule|work plan|mobilisation|mobilization))/im,
      /^#{1,3}\s+(?:section\s+b\b|b\.\d|.*?(?:relevant experience|project portfolio))/im,
      /^#{1,3}\s+(?:section\s+c\.5|c\.5\b|.*?(?:risk register|risks))/im,
    ],
    COMMERCIAL: [
      /^#{1,3}\s+(?:section\s+d\b|d\.\d|.*?(?:value framework|value-added|additional information|certifications|financial|capacity))/im,
      /^#{1,3}\s+(?:section\s+a\.2|a\.2\b|.*?(?:corporate information|company background))/im,
    ],
  };

  const patterns = sectionPatterns[persona];
  const chunks: string[] = [];

  // Find the cover letter + executive summary opener (every persona benefits from this context).
  const openingMatch = proposalMarkdown.match(/^#{1,3}\s+(cover letter|executive summary)[\s\S]*?(?=^#{1,3}\s)/im);
  if (openingMatch) chunks.push(openingMatch[0].trim());

  // Then append each domain-relevant section.
  for (const pattern of patterns) {
    const match = proposalMarkdown.match(pattern);
    if (!match || match.index === undefined) continue;
    const fromHere = proposalMarkdown.slice(match.index);
    // Take this section until the next top-level heading of equal or higher level.
    const sectionHeadingLevel = (match[0].match(/^(#+)/)?.[1].length ?? 2);
    const nextSiblingPattern = new RegExp(`\\n#{1,${sectionHeadingLevel}}\\s+\\w`);
    const nextMatch = fromHere.slice(match[0].length).match(nextSiblingPattern);
    const sectionText = nextMatch
      ? fromHere.slice(0, match[0].length + (nextMatch.index ?? 0))
      : fromHere;
    chunks.push(sectionText.trim());
  }

  if (chunks.length === 0) {
    // No domain sections found — fall back to the first 30K chars of the whole proposal.
    return proposalMarkdown.slice(0, 30_000);
  }

  // Concatenate and truncate; per-persona budget of 30K chars keeps
  // each call comfortable on Anthropic Tier 2+ output budgets.
  return chunks.join("\n\n").slice(0, 30_000);
}

function sharedCriteriaBlock(context?: EvaluatorContext): string {
  if (!context?.sharedCriteria || context.sharedCriteria.length === 0) return "";
  const lines = context.sharedCriteria.map((c, i) => {
    const weight = c.weight !== null ? ` (${c.weight}%)` : "";
    return `${i + 1}. ${c.criterion}${weight}`;
  });
  return [
    "## CANONICAL EVALUATION CRITERIA (score against THESE exact criterion names so the panel's scores can be cross-compared)",
    ...lines,
    "",
    "Each entry in your criterionScores[].criterion MUST match one of these names verbatim. Score 0 for criteria you cannot assess given your domain.",
  ].join("\n");
}

function buildPersonaPrompt(
  persona: EvaluatorPersona,
  proposalMarkdown: string,
  evaluationCriteria: string,
  tenderTitle: string,
  context?: EvaluatorContext,
): string {
  const focusedExcerpt = extractPersonaFocusedSlice(proposalMarkdown, persona);
  const sharedBlock = sharedCriteriaBlock(context);
  return `Read the proposal sections most relevant to your evaluator role and the structured tender context below for tender: ${tenderTitle}

EVALUATION CRITERIA / METHODOLOGY:
${evaluationCriteria.slice(0, 5_000) || "No explicit criteria — infer from requirements and score against overall proposal quality and fit-for-purpose."}
${sharedBlock ? "\n" + sharedBlock + "\n" : ""}
${contextBlock(context)}

PROPOSAL EXCERPT (sections focused on your evaluator domain — ${persona}, truncated to 30K chars):
${focusedExcerpt}

Return your JSON assessment as instructed in the system prompt.`;
}

// Legacy single-prompt helper retained for backward compatibility. It
// is no longer used by simulateEvaluatorPanel (each persona now gets
// a domain-focused prompt via buildPersonaPrompt), but other callers
// may still depend on it.
function buildUserPrompt(proposalMarkdown: string, evaluationCriteria: string, tenderTitle: string, context?: EvaluatorContext): string {
  const sharedBlock = sharedCriteriaBlock(context);
  return `Read the proposal and structured tender context below for tender: ${tenderTitle}

EVALUATION CRITERIA / METHODOLOGY:
${evaluationCriteria.slice(0, 5_000) || "No explicit criteria — infer from requirements and score against overall proposal quality and fit-for-purpose."}
${sharedBlock ? "\n" + sharedBlock + "\n" : ""}
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

/**
 * Cross-persona calibration (gap #9). Groups criterion scores by
 * canonical criterion name and computes the spread (max - min) per
 * shared criterion. Returns notes for criteria where the spread is
 * material (>= 3 points). Pure function — exported for tests.
 */
export function computeCalibrationNotes(assessments: PersonaAssessment[]): CalibrationNote[] {
  // Group scores by lower-cased + trimmed criterion name. A criterion
  // that only one persona scored cannot be calibrated and is dropped.
  const map = new Map<string, Array<{ persona: EvaluatorPersona; score: number; rationale: string }>>();
  for (const a of assessments) {
    for (const c of a.criterionScores) {
      const key = c.criterion.trim().toLowerCase();
      if (key.length === 0) continue;
      const list = map.get(key) ?? [];
      list.push({ persona: a.persona, score: c.score, rationale: c.rationale });
      map.set(key, list);
    }
  }
  const notes: CalibrationNote[] = [];
  for (const [criterion, scoresByPersona] of map.entries()) {
    if (scoresByPersona.length < 2) continue;
    const scores = scoresByPersona.map((s) => s.score);
    const spread = Math.max(...scores) - Math.min(...scores);
    if (spread < 3) continue; // agreement — no calibration concern
    const level: CalibrationNote["level"] = spread >= 5 ? "alarm" : "moderate";
    notes.push({ criterion, scoresByPersona, spread, level });
  }
  // Sort highest-spread first.
  notes.sort((a, b) => b.spread - a.spread);
  return notes.slice(0, 10);
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

// Per-simulation wall-clock timeout. The route sets maxDuration=60; with 4
// concurrent persona calls each potentially taking ~15s, a single slow model
// could exceed Vercel's function limit. This guard races the entire panel
// against a timeout so the route can return a partial or null result rather
// than a 504. Override via EVALUATOR_SIMULATION_TIMEOUT_MS.
const SIMULATION_TIMEOUT_MS = (() => {
  const raw = Number(process.env.EVALUATOR_SIMULATION_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 10_000 && raw <= 300_000) return raw;
  return 50_000;
})();

export async function simulateEvaluatorPanel(input: {
  tenderTitle: string;
  proposalMarkdown: string;
  evaluationCriteria: string;
  context?: EvaluatorContext;
}): Promise<SimulationResult | null> {
  // Domain-focused prompts per persona (gap #9). Each persona reads
  // only the proposal sections their evaluator role would focus on
  // in a real panel — TECHNICAL → Section C + Team; COMPLIANCE →
  // Section E + Declarations; END_USER → Work Plan + Experience;
  // COMMERCIAL → Section D + Corporate. Falls back to the full
  // proposal when domain sections aren't found.
  const technicalPrompt = buildPersonaPrompt("TECHNICAL", input.proposalMarkdown, input.evaluationCriteria, input.tenderTitle, input.context);
  const compliancePrompt = buildPersonaPrompt("COMPLIANCE", input.proposalMarkdown, input.evaluationCriteria, input.tenderTitle, input.context);
  const endUserPrompt = buildPersonaPrompt("END_USER", input.proposalMarkdown, input.evaluationCriteria, input.tenderTitle, input.context);
  const commercialPrompt = buildPersonaPrompt("COMMERCIAL", input.proposalMarkdown, input.evaluationCriteria, input.tenderTitle, input.context);

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutHandle = setTimeout(() => {
      console.warn(`[evaluator-simulator] Simulation timed out after ${Math.round(SIMULATION_TIMEOUT_MS / 1000)}s — returning null.`);
      resolve(null);
    }, SIMULATION_TIMEOUT_MS);
  });

  const panelPromise = Promise.allSettled([
    runPersona("TECHNICAL", TECHNICAL_EVALUATOR_PROMPT, technicalPrompt),
    runPersona("COMPLIANCE", COMPLIANCE_EVALUATOR_PROMPT, compliancePrompt),
    runPersona("END_USER", END_USER_EVALUATOR_PROMPT, endUserPrompt),
    runPersona("COMMERCIAL", COMMERCIAL_EVALUATOR_PROMPT, commercialPrompt),
  ]);

  const settled = await Promise.race([
    panelPromise.then((results) => {
      clearTimeout(timeoutHandle);
      return results;
    }),
    timeoutPromise,
  ]);

  if (!settled) return null;

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
  const calibrationNotes = computeCalibrationNotes(assessments);
  const rationale = synthesizeRationale(predictedOverallScore, verdict, topObjections.length, actionPlan.length);

  const totalMs = assessments.reduce((s, a) => Math.max(s, a.durationMs), 0);
  console.info(`[evaluator-simulator] Evidence-aware panel of ${assessments.length}/4 personas completed in ${Math.round(totalMs / 100) / 10}s — verdict ${verdict} (${predictedOverallScore}/100), ${topObjections.length} objection(s), ${actionPlan.length} action(s), ${calibrationNotes.length} calibration alarm(s).`);

  return {
    predictedOverallScore,
    verdict,
    personaAssessments: assessments,
    topObjections,
    topCommendations,
    actionPlan,
    riskRegister,
    rationale,
    calibrationNotes,
    computedAt: new Date().toISOString(),
  };
}
