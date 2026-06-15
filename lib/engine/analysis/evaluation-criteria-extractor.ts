/**
 * Semantic evaluation-criteria extractor.
 *
 * The legacy analyzer (`lib/engine/analysis.ts`) infers requirement
 * priority via keyword regex ("must" → MANDATORY, "score" → SCORED).
 * That gets the spine right but cannot decode:
 *
 *   • numeric evaluation weights ("Technical 30%, Experience 25%, …")
 *   • disqualifying clauses ("submissions without ISO certification
 *     shall be deemed non-responsive")
 *   • structural prohibitions ("no joint ventures permitted", "lead
 *     firm must have been incorporated for ≥ 5 years")
 *   • evidence-shape expectations ("each reference must include client
 *     contact, contract value, completion date")
 *
 * This module asks Claude to read the tender text and emit a JSON
 * structure that captures all four. The structure is consumed by
 *   – the proposal generator's AI input (so the prompt knows weights)
 *   – the deep-reasoning critic (so the critique step can verify
 *     prohibitions and disqualifiers are addressed)
 *
 * Falls back to `null` when no AI provider is configured, when the
 * tender text is too short to extract anything useful, or when the
 * AI returns malformed JSON — callers MUST tolerate `null` and fall
 * through to the legacy regex path.
 *
 * Hard limits:
 *   – input truncated to 60K chars (Claude context budget + cost)
 *   – output truncated to 30 criteria + 30 disqualifiers + 30
 *     prohibitions (defensive cap; real tenders have ≤ 12)
 */

import { generateWithFallback, isAIEnabled } from "../ai";
import { getComprehensionCache } from "../infrastructure/comprehension-cache";

export type EvaluationCriterion = {
  /** Stable slug derived from the criterion name. Used for prompt cross-references. */
  id: string;
  /** Criterion name as it appears in the tender (verbatim where possible). */
  criterion: string;
  /** Numeric weight as a percentage of the total technical score (0–100). Null when not stated. */
  weight: number | null;
  /** True when failure to meet this criterion disqualifies the bid. */
  mandatory: boolean;
  /** How the criterion is scored. */
  scoringMethod: "pass-fail" | "weighted" | "binary" | "narrative" | "unknown";
  /** Specific evidence types the evaluator expects (e.g. "CVs", "audited statements"). */
  evidenceExpected: string[];
  /** The exact tender sentence(s) this criterion was derived from. Empty when synthesised. */
  sourceQuote: string;
};

export type DisqualifyingCondition = {
  id: string;
  /** Human-readable rule statement ("Lead firm must have ≥ 5 years of operating history"). */
  rule: string;
  /** Verbatim language from the tender that triggers this rule. */
  triggerLanguage: string;
};

export type DeepTenderComprehension = {
  criteria: EvaluationCriterion[];
  disqualifiers: DisqualifyingCondition[];
  /** Hard structural prohibitions ("no JVs", "no sub-contracting of core services"). */
  prohibitions: string[];
  /** Sum of weights across criteria. ≈ 100 when fully accounted; lower when weights are partial; null when no weights are stated. */
  totalWeightAccountedFor: number | null;
  /** Claude's short chain-of-thought summary explaining how it parsed the tender. Used for transparency in the UI. */
  reasoning: string;
};

const TRUNCATE_INPUT_CHARS = 60_000;
const MAX_CRITERIA = 30;
const MAX_DISQUALIFIERS = 30;
const MAX_PROHIBITIONS = 30;

const ANALYST_SYSTEM_PROMPT = `You are a senior bid analyst with 25 years of experience reading public-sector and donor tender documents. Your single job in this conversation is to decode the evaluation rules from a tender text and emit them as STRICT JSON.

Operating principles:

1. EVALUATOR LITERALISM. Use the tender's exact criterion names where stated. Do not paraphrase to make them prettier — evaluators score against their own wording. Where the tender uses awkward phrasing ("Comprehension of TOR"), keep it.

2. NUMERIC HONESTY. Extract weights only when the tender states them numerically (30%, 25 points, ratio 70:30). Never invent or estimate weights. Use null when no weight is stated.

3. MANDATORY DETECTION. A criterion is mandatory ONLY when failure to meet it is explicitly disqualifying (language like "shall be non-responsive", "will be rejected", "mandatory pre-qualification", "minimum threshold"). "Required" alone is NOT enough — that just means it must be supplied, not that the bid fails without it.

4. PROHIBITIONS, NOT REQUIREMENTS. Prohibitions are NEGATIVE constraints ("no joint ventures", "sub-contracting of core services is not permitted", "the lead firm must not have been blacklisted"). Do NOT list positive requirements ("must submit audited accounts") as prohibitions.

5. EVIDENCE SHAPE. For each criterion, list the SPECIFIC evidence types the evaluator expects to see — "CVs of key experts", "audited financial statements for last 3 years", "completion certificates", "client reference letters". Use the evidence vocabulary the tender itself uses.

6. NO INVENTION. If the tender does not state criteria explicitly (e.g. the tender body is mostly scope-of-work with no evaluation section), return an empty criteria array. Do not invent generic criteria like "Technical Approach 40%".

7. STRICT JSON ONLY. Return exactly one JSON object matching the schema in the user prompt. No prose before or after. No markdown code fences. No commentary. Start with "{" and end with "}".`;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function buildExtractionPrompt(tenderText: string): string {
  const truncated = tenderText.length > TRUNCATE_INPUT_CHARS
    ? tenderText.slice(0, TRUNCATE_INPUT_CHARS) + "\n\n[…tender text truncated at " + TRUNCATE_INPUT_CHARS + " chars]"
    : tenderText;

  return `Read the tender text below and extract the evaluation rules. Think step by step BEFORE you emit the JSON, then emit the JSON only.

## Output schema (strict)

\`\`\`
{
  "reasoning": "1–3 sentence chain-of-thought summary of how you parsed the evaluation section. State whether the tender contained an explicit scoring matrix or whether weights were inferred from headings.",
  "criteria": [
    {
      "criterion": "verbatim criterion name from the tender",
      "weight": <number 0–100 or null>,
      "mandatory": <true | false>,
      "scoringMethod": "pass-fail" | "weighted" | "binary" | "narrative" | "unknown",
      "evidenceExpected": ["CVs of key experts", "audited financial statements", …],
      "sourceQuote": "the exact tender sentence(s) this criterion was drawn from, verbatim, ≤ 400 chars"
    }
  ],
  "disqualifiers": [
    {
      "rule": "Lead firm must have ≥ 5 years of operating history",
      "triggerLanguage": "verbatim tender sentence that defines this disqualifier, ≤ 300 chars"
    }
  ],
  "prohibitions": [
    "No joint ventures permitted",
    "Sub-contracting of core services is not allowed"
  ],
  "totalWeightAccountedFor": <sum of criterion weights, or null when no weights were stated>
}
\`\`\`

## Rules

- Return empty arrays where a category does not apply. Do NOT invent placeholders.
- Caps: at most ${MAX_CRITERIA} criteria, ${MAX_DISQUALIFIERS} disqualifiers, ${MAX_PROHIBITIONS} prohibitions.
- If the tender body contains no explicit evaluation section, return \`"criteria": []\` and explain in the reasoning field.
- \`sourceQuote\` MUST be a substring (or near-substring with normalised whitespace) of the tender text. If you cannot find a quote, return an empty string — never fabricate one.

## Tender text

${truncated}

## JSON OUTPUT (return the object only — no markdown, no commentary)
`;
}

/**
 * Strip code fences and trim — Claude occasionally wraps JSON in
 * ```json … ``` even when told not to. We strip defensively.
 */
function unwrapJson(raw: string): string {
  let text = raw.trim();
  if (text.startsWith("```")) {
    // Drop the opening fence (with or without "json" language tag).
    text = text.replace(/^```(?:json)?\s*/i, "");
    // Drop the closing fence.
    text = text.replace(/```\s*$/i, "");
    text = text.trim();
  }
  return text;
}

function clampWeight(weight: unknown): number | null {
  if (typeof weight !== "number" || !Number.isFinite(weight)) return null;
  if (weight < 0) return 0;
  if (weight > 100) return 100;
  return weight;
}

function asStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed.slice(0, 300));
    if (out.length >= max) break;
  }
  return out;
}

function isScoringMethod(value: unknown): value is EvaluationCriterion["scoringMethod"] {
  return value === "pass-fail" || value === "weighted" || value === "binary" || value === "narrative" || value === "unknown";
}

function parseCriterion(raw: unknown, index: number): EvaluationCriterion | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const criterion = typeof obj.criterion === "string" ? obj.criterion.trim() : "";
  if (criterion.length === 0) return null;
  const weight = clampWeight(obj.weight);
  const mandatory = obj.mandatory === true;
  const scoringMethod = isScoringMethod(obj.scoringMethod) ? obj.scoringMethod : "unknown";
  const evidenceExpected = asStringArray(obj.evidenceExpected, 12);
  const sourceQuote = typeof obj.sourceQuote === "string" ? obj.sourceQuote.trim().slice(0, 400) : "";
  return {
    id: `${slugify(criterion) || `criterion-${index + 1}`}`,
    criterion: criterion.slice(0, 200),
    weight,
    mandatory,
    scoringMethod,
    evidenceExpected,
    sourceQuote,
  };
}

function parseDisqualifier(raw: unknown, index: number): DisqualifyingCondition | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const rule = typeof obj.rule === "string" ? obj.rule.trim() : "";
  if (rule.length === 0) return null;
  const triggerLanguage = typeof obj.triggerLanguage === "string" ? obj.triggerLanguage.trim().slice(0, 300) : "";
  return {
    id: `${slugify(rule) || `disqualifier-${index + 1}`}`,
    rule: rule.slice(0, 300),
    triggerLanguage,
  };
}

/**
 * Parse and validate the raw Claude JSON output. Returns null if the
 * structure is unrecoverable (e.g. not an object, parser threw); the
 * caller falls back to legacy regex.
 *
 * Exported for unit testing — pure function, no AI call.
 */
export function parseComprehensionJson(raw: string): DeepTenderComprehension | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unwrapJson(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const criteria: EvaluationCriterion[] = [];
  if (Array.isArray(obj.criteria)) {
    obj.criteria.forEach((item, index) => {
      if (criteria.length >= MAX_CRITERIA) return;
      const c = parseCriterion(item, index);
      if (c) criteria.push(c);
    });
  }

  const disqualifiers: DisqualifyingCondition[] = [];
  if (Array.isArray(obj.disqualifiers)) {
    obj.disqualifiers.forEach((item, index) => {
      if (disqualifiers.length >= MAX_DISQUALIFIERS) return;
      const d = parseDisqualifier(item, index);
      if (d) disqualifiers.push(d);
    });
  }

  const prohibitions = asStringArray(obj.prohibitions, MAX_PROHIBITIONS);
  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning.trim().slice(0, 800) : "";

  let totalWeightAccountedFor: number | null = null;
  if (typeof obj.totalWeightAccountedFor === "number" && Number.isFinite(obj.totalWeightAccountedFor)) {
    totalWeightAccountedFor = obj.totalWeightAccountedFor;
  } else if (criteria.some((c) => c.weight !== null)) {
    // Derive when the model omitted it but criteria carry weights.
    totalWeightAccountedFor = criteria.reduce((sum, c) => sum + (c.weight ?? 0), 0);
  }

  if (criteria.length === 0 && disqualifiers.length === 0 && prohibitions.length === 0 && reasoning.length === 0) {
    return null;
  }

  return { criteria, disqualifiers, prohibitions, totalWeightAccountedFor, reasoning };
}

/**
 * Render a comprehension object back to a compact text block suitable
 * for injection into a generation prompt. Designed to be cheap on
 * tokens — one bullet per criterion, weight inline.
 */
export function formatComprehensionForPrompt(comp: DeepTenderComprehension): string {
  const lines: string[] = [];
  lines.push("## DEEP TENDER COMPREHENSION (Claude-extracted, semantic)");
  if (comp.reasoning) lines.push(`Reasoning: ${comp.reasoning}`);
  if (comp.criteria.length > 0) {
    const weightNote = comp.totalWeightAccountedFor !== null
      ? ` (total weight accounted for: ${comp.totalWeightAccountedFor}%)`
      : " (no numeric weights stated)";
    lines.push("");
    lines.push(`### Evaluation criteria${weightNote}`);
    comp.criteria.forEach((c) => {
      const weight = c.weight !== null ? `${c.weight}%` : "no weight stated";
      const mandatory = c.mandatory ? " — MANDATORY (disqualifying if not met)" : "";
      const evidence = c.evidenceExpected.length > 0 ? ` Evidence expected: ${c.evidenceExpected.join("; ")}.` : "";
      lines.push(`- **${c.criterion}** (${weight}, scoring: ${c.scoringMethod})${mandatory}.${evidence}`);
    });
  }
  if (comp.disqualifiers.length > 0) {
    lines.push("");
    lines.push("### Disqualifying conditions (failure to satisfy = automatic rejection)");
    comp.disqualifiers.forEach((d) => {
      lines.push(`- ${d.rule}`);
    });
  }
  if (comp.prohibitions.length > 0) {
    lines.push("");
    lines.push("### Structural prohibitions (these arrangements are not permitted)");
    comp.prohibitions.forEach((p) => {
      lines.push(`- ${p}`);
    });
  }
  return lines.join("\n");
}

/**
 * Run the semantic extractor. Returns null on any failure — caller
 * MUST tolerate null and fall through to the regex analyzer.
 *
 * AI provider selection follows the rest of the engine fallback chain.
 * The shared `generateWithFallback` implementation keeps Claude/Anthropic
 * last so Anthropic rate limits do not block earlier providers.
 */
export async function extractDeepTenderComprehension(tenderText: string): Promise<DeepTenderComprehension | null> {
  if (!isAIEnabled()) return null;
  const text = (tenderText ?? "").trim();
  if (text.length < 200) {
    // Not enough material to extract anything meaningful — return null
    // so the caller can show "comprehension not run" rather than an
    // empty-but-present block.
    return null;
  }

  // In-memory cache: same tender text → same comprehension. Skip the
  // AI call entirely on a hit. See lib/engine/comprehension-cache.ts.
  const cache = getComprehensionCache<DeepTenderComprehension>();
  const cached = cache.get(text);
  if (cached) {
    console.info(`[evaluation-criteria-extractor] Comprehension cache HIT — skipping AI call.`);
    return cached;
  }

  const prompt = buildExtractionPrompt(text);
  let raw: string;
  try {
    raw = await generateWithFallback(prompt, { systemPrompt: ANALYST_SYSTEM_PROMPT });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[evaluation-criteria-extractor] AI call failed: ${msg} — comprehension skipped, falling through to regex analyzer.`);
    return null;
  }

  const parsed = parseComprehensionJson(raw);
  if (!parsed) {
    console.warn("[evaluation-criteria-extractor] AI returned malformed JSON — comprehension skipped.");
    return null;
  }
  cache.set(text, parsed);
  return parsed;
}
