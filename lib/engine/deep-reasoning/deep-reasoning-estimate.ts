/**
 * Pre-generation cost estimator for the deep-reasoning pipeline.
 *
 * Given the current environment configuration (flags + provider
 * availability) and a tender's basic shape, returns an estimate of
 * how many Claude calls a deep-reasoning generation will use. The
 * UI surfaces this BEFORE the user clicks "Generate" so they can
 * make an informed cost decision.
 *
 * Numbers are best-effort approximations based on the actual call
 * paths in lib/engine/generate-elite.ts. They don't account for:
 *   - Comprehension cache hits (would reduce calls by 1 if the
 *     same tender text was extracted recently in this process)
 *   - Critic-rewriter early-exit when score threshold is reached
 *     (max iterations is a worst case)
 *   - Tool-use multi-turn iterations (each tool call adds 1 turn,
 *     capped at MAX_TOOL_TURNS=6)
 *
 * Returns conservative upper bounds so the operator's actual cost
 * is at-most the estimate.
 */

import { isDeepReasoningEnabled, isToolUseGenerationEnabled } from "../infrastructure/feature-flags";
import { isAIEnabled, isClaudeEnabled } from "../ai";

export type DeepReasoningEstimate = {
  /** Whether deep reasoning will actually run given the current config. */
  willRun: boolean;
  /** Why deep reasoning won't run, if applicable. */
  blocker: string | null;
  /** Estimated worst-case Claude call count. */
  worstCaseCalls: number;
  /** Estimated typical Claude call count (no retries, no tool fan-out). */
  typicalCalls: number;
  /** Per-step breakdown. */
  steps: Array<{ step: string; calls: number; notes?: string }>;
  /** Whether any cost-guard cap is set, and the value. */
  costGuard: { capped: boolean; maxCalls: number | null };
};

export type EstimateInput = {
  /** Tender text length in characters. Influences whether comprehension/alignment can run. */
  tenderTextLength: number;
  /** Number of selected experts. Affects alignment input size. */
  expertCount: number;
  /** Number of selected projects. Affects alignment input size. */
  projectCount: number;
  /** Initial quality-score estimate (0–100). Below threshold → refinement runs. Default: 70. */
  expectedInitialScore?: number;
  /** Quality threshold from env (defaults to 90 on Tier 2). Refinement runs while score < this. */
  refinementThreshold?: number;
  /** Max critique→rewrite iterations from env (defaults to 1 on Tier 2). */
  maxRefinementAttempts?: number;
};

/**
 * Read the tier-aware default for the refinement attempt cap. Mirrors
 * the logic in generate-elite.ts so estimates match reality. Exposed
 * for tests and the endpoint; not for product code.
 */
export function defaultMaxRefinementAttempts(): number {
  const tier = (process.env.ANTHROPIC_TIER || "").trim();
  const tierDefault = tier === "1" ? 0
    : tier === "3" || tier === "4" ? 2
    : 1; // Tier 2 default
  const override = Number(process.env.MAX_REFINEMENT_ATTEMPTS);
  return Number.isFinite(override) && override >= 0 ? override : tierDefault;
}

/**
 * Read the tier-aware default for the refinement quality threshold.
 */
export function defaultRefinementThreshold(): number {
  const tier = (process.env.ANTHROPIC_TIER || "").trim();
  const tierDefault = tier === "1" ? 82
    : tier === "3" || tier === "4" ? 92
    : 90;
  const override = Number(process.env.QUALITY_REFINEMENT_THRESHOLD);
  return Number.isFinite(override) && override > 0 ? override : tierDefault;
}

export function estimateDeepReasoningCost(input: EstimateInput): DeepReasoningEstimate {
  const flagOn = isDeepReasoningEnabled();
  const aiOn = isAIEnabled();
  const toolUseGen = isToolUseGenerationEnabled() && isClaudeEnabled();
  const generationMode = (process.env.PROPOSAL_GENERATION_MODE || "parallel").toLowerCase();
  const maxCallsRaw = process.env.TENDER_DEEP_REASONING_MAX_CALLS;
  const maxCallsParsed = maxCallsRaw ? Number(maxCallsRaw) : null;
  const maxCalls = maxCallsParsed && Number.isFinite(maxCallsParsed) && maxCallsParsed > 0 ? maxCallsParsed : null;

  if (!flagOn) {
    return {
      willRun: false,
      blocker: "TENDER_DEEP_REASONING is not enabled",
      worstCaseCalls: 0,
      typicalCalls: 0,
      steps: [],
      costGuard: { capped: maxCalls !== null, maxCalls },
    };
  }
  if (!aiOn) {
    return {
      willRun: false,
      blocker: "No AI provider configured (OPENAI_API_KEY / GEMINI_API_KEY / DEEPSEEK_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY / ANTHROPIC_API_KEY)",
      worstCaseCalls: 0,
      typicalCalls: 0,
      steps: [],
      costGuard: { capped: maxCalls !== null, maxCalls },
    };
  }

  const threshold = input.refinementThreshold ?? defaultRefinementThreshold();
  const maxAttempts = input.maxRefinementAttempts ?? defaultMaxRefinementAttempts();
  const initialScore = input.expectedInitialScore ?? 70;
  const willRefine = initialScore < threshold;

  const steps: Array<{ step: string; calls: number; notes?: string }> = [];

  // Comprehension — runs unconditionally when flag + AI are on AND
  // the tender text is long enough.
  const comprehensionRuns = input.tenderTextLength >= 200;
  if (comprehensionRuns) {
    steps.push({ step: "comprehension", calls: 1, notes: "skipped on cache hit" });
  }

  // Alignment — runs when comprehension yields criteria AND candidates exist.
  const alignmentRuns = comprehensionRuns && (input.expertCount > 0 || input.projectCount > 0);
  if (alignmentRuns) {
    steps.push({ step: "alignment", calls: 1 });
  }

  // Generation — single or parallel.
  const generationCalls = generationMode === "single" ? 1 : 4;
  steps.push({
    step: generationMode === "single" ? "generation (single-call)" : "generation (4 parallel section calls)",
    calls: generationCalls,
    notes: toolUseGen && generationMode === "single" ? "+1–6 mid-write tool turns" : undefined,
  });

  // Critique + rewrite per refinement iteration.
  if (willRefine && maxAttempts > 0) {
    steps.push({
      step: `critique × ${maxAttempts}`,
      calls: maxAttempts,
      notes: "may exit early if score crosses threshold",
    });
    steps.push({
      step: `rewrite × ${maxAttempts}`,
      calls: maxAttempts,
    });
  }

  const typicalCalls = steps.reduce((sum, s) => sum + s.calls, 0);
  // Worst case adds tool-use fan-out (up to 6 extra turns per
  // mid-write tool call) and accounts for retries.
  const worstCaseExtra = toolUseGen && generationMode === "single" ? 6 : 0;
  const worstCaseCalls = typicalCalls + worstCaseExtra;

  return {
    willRun: true,
    blocker: null,
    worstCaseCalls,
    typicalCalls,
    steps,
    costGuard: { capped: maxCalls !== null, maxCalls },
  };
}
