/**
 * Engine feature flags.
 *
 * Single source of truth for env-driven feature gates so the on/off
 * semantics are consistent across modules. Each flag accepts the
 * truthy set {"1", "true", "yes", "on"} (case-insensitive); everything
 * else (including unset) is OFF.
 *
 * Why a tiny helper module: previously each call site re-implemented
 * `process.env.FOO === "true"` style checks, which drifted (some
 * accepted "1", some "true", some both). A central truthy-set keeps
 * configuration predictable.
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return TRUTHY.has(value.trim().toLowerCase());
}

/**
 * Deep-reasoning mode: when ON, the engine runs two additional Claude-
 * powered passes that bring the generator closer to interactive-LLM
 * thinking quality:
 *
 *  1. SEMANTIC TENDER COMPREHENSION (replaces regex-only criteria
 *     detection): a structured Claude call extracts evaluation
 *     criteria with weights, mandatory flags, disqualifying clauses,
 *     and prohibitions, returning a JSON schema downstream prompts
 *     consume. See `lib/engine/evaluation-criteria-extractor.ts`.
 *
 *  2. CRITIC-REWRITER REFINEMENT (replaces single-pass directive
 *     refinement): instead of one Claude call that fixes weak axes
 *     directly, the engine runs CRITIQUE → REWRITE per iteration —
 *     Claude first analyses what is missing and why, then a separate
 *     call rewrites with that critique as input. See
 *     `lib/engine/deep-reasoning-refiner.ts`.
 *
 * Both paths require an AI provider from the configured chain; they no-op
 * silently when no provider is configured.
 *
 * Default OFF: feature is additive; existing generation behaviour is
 * unchanged when the flag is unset.
 */
export function isDeepReasoningEnabled(): boolean {
  return isTruthy(process.env.TENDER_DEEP_REASONING);
}

/**
 * Tool-use during proposal GENERATION (round 5). When ON AND
 * TENDER_DEEP_REASONING is ON AND the proposal generation mode is
 * "single", Claude is given access to `search_company_knowledge`,
 * `inspect_expert`, and `inspect_project` while writing the proposal
 * (not just during critique). This closes the original audit gap #10
 * — until round 5 the tools were only wired into the critic loop.
 *
 * Wired separately from TENDER_DEEP_REASONING because it adds 1–6
 * extra mid-write Claude turns per generation (one per tool call,
 * capped at MAX_TOOL_TURNS=6). Operators on tight budgets can keep
 * deep reasoning ON but tool-use OFF.
 *
 * Default OFF. Requires TENDER_DEEP_REASONING=true to take effect.
 */
export function isToolUseGenerationEnabled(): boolean {
  return isTruthy(process.env.TENDER_TOOL_USE_GENERATION);
}

/**
 * Exposed for tests and diagnostics — never call directly from product
 * code. Use the named accessor above so feature usage is greppable.
 */
export const __testing__ = { isTruthy };
