export type ProposalRuntimeProfile = {
  anthropicTier: string | null;
  maxOutputTokens: number;
  proposalAiTimeoutMs: number;
  routeMaxDurationSeconds: number;
  safetyBufferSeconds: number;
  longRouteExplicitlyEnabled: boolean;
  /**
   * Seconds withheld from the execution ceiling for the work that happens
   * AFTER the model returns: enrichers, DOCX assembly, PDF finalization and
   * persistence. Larger on a long execution context because a long context is
   * used for a bigger document, not merely a slower one.
   */
  generationPostWorkReserveSeconds: number;
  /**
   * The budget generation is actually allowed to spend waiting on the model.
   *
   * `proposalAiTimeoutMs` above is advisory — what the configuration ASKS for.
   * This is what the execution context can AFFORD, and it is the number the
   * writer must use. It is derived from the platform execution ceiling, never
   * from ANTHROPIC_TIER: the tier is an Anthropic account property (rate
   * limits, output tokens) and says nothing about how long this runtime may
   * run. Conflating the two is what capped the durable worker — which declares
   * maxDuration 300 and was observed running 99s — at the 45s calibrated for a
   * 60s request route, so every proposal fell back to the deterministic draft
   * while Gemini, Groq and Z.ai were all GENERATION_VERIFIED and eligible.
   *
   * An explicit AI_PROPOSAL_TIMEOUT_MS may LOWER this. It can never raise it
   * above what the context can afford, because exceeding the ceiling trades a
   * clean in-pipeline fallback for a hard platform kill.
   */
  effectiveProposalBudgetMs: number;
  canRunLongProposalGeneration: boolean;
  warnings: string[];
  recommendations: string[];
};

function readNumberEnv(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function longRouteEnabled(routeMaxDurationSeconds: number): boolean {
  const explicit = (process.env.AI_PROPOSAL_LONG_ROUTE_ENABLED || "").trim().toLowerCase();
  return ["1", "true", "yes"].includes(explicit) && routeMaxDurationSeconds >= 240;
}

export function getProposalRuntimeProfile(routeMaxDurationSeconds = 60): ProposalRuntimeProfile {
  const tier = (process.env.ANTHROPIC_TIER || "").trim() || null;
  const longRouteExplicitlyEnabled = longRouteEnabled(routeMaxDurationSeconds);
  const explicitTokens = readNumberEnv("ANTHROPIC_MAX_OUTPUT_TOKENS");
  const explicitTimeout = readNumberEnv("AI_PROPOSAL_TIMEOUT_MS");

  const maxOutputTokens = explicitTokens && explicitTokens > 0
    ? Math.min(explicitTokens, 64_000)
    : tier === "1"
      ? 8_000
      : 16_000;

  const proposalAiTimeoutMs = explicitTimeout && explicitTimeout >= 5_000 && explicitTimeout <= 600_000
    ? explicitTimeout
    : tier === "1"
      ? 45_000
      : 220_000;

  const safetyBufferSeconds = routeMaxDurationSeconds >= 240 ? 30 : 15;
  const safeBudgetMs = Math.max(5_000, (routeMaxDurationSeconds - safetyBufferSeconds) * 1_000);

  // Post-model work scales with the document, so a long context reserves more
  // than the advisory safety buffer above. 60s - 15s = 45s and 300s - 80s =
  // 220s are the two figures this codebase already documents as correct for
  // those ceilings; they are applied here on the basis of the CEILING rather
  // than the Anthropic tier.
  const generationPostWorkReserveSeconds = routeMaxDurationSeconds >= 240 ? 80 : 15;
  const contextAffordableMs = Math.max(
    5_000,
    (routeMaxDurationSeconds - generationPostWorkReserveSeconds) * 1_000,
  );
  const effectiveProposalBudgetMs = explicitTimeout && explicitTimeout >= 5_000 && explicitTimeout <= 600_000
    ? Math.min(explicitTimeout, contextAffordableMs)
    : contextAffordableMs;
  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (!tier) {
    warnings.push("ANTHROPIC_TIER is not set.");
    recommendations.push("Set ANTHROPIC_TIER=1 for Vercel Hobby / low Anthropic rate limits, or ANTHROPIC_TIER=2 only where long-route capacity is available.");
  }

  if (maxOutputTokens >= 16_000 && !longRouteExplicitlyEnabled) {
    warnings.push("16K Claude output is configured, but long-route mode is not explicitly enabled with AI_PROPOSAL_LONG_ROUTE_ENABLED=true and a >=240s route budget.");
    recommendations.push("Either lower ANTHROPIC_MAX_OUTPUT_TOKENS to 8000, set ANTHROPIC_TIER=1, or deploy on a runtime that supports long serverless functions before enabling long-route mode.");
  }

  if (proposalAiTimeoutMs > safeBudgetMs) {
    warnings.push(`AI proposal timeout ${Math.round(proposalAiTimeoutMs / 1000)}s exceeds safe route budget ${Math.round(safeBudgetMs / 1000)}s.`);
    recommendations.push(`Set AI_PROPOSAL_TIMEOUT_MS <= ${safeBudgetMs}, or use a route/runtime that supports the requested timeout.`);
  }

  if (tier === "1" && maxOutputTokens > 8_000) {
    warnings.push("ANTHROPIC_TIER=1 is configured but output tokens exceed 8000.");
    recommendations.push("Lower ANTHROPIC_MAX_OUTPUT_TOKENS to 8000 or upgrade tier settings.");
  }

  return {
    anthropicTier: tier,
    maxOutputTokens,
    proposalAiTimeoutMs,
    routeMaxDurationSeconds,
    safetyBufferSeconds,
    longRouteExplicitlyEnabled,
    generationPostWorkReserveSeconds,
    effectiveProposalBudgetMs,
    canRunLongProposalGeneration: warnings.length === 0,
    warnings,
    recommendations,
  };
}

// ─── Execution-context budget contract ───────────────────────────────────────
//
// Proposal generation runs in two places with very different platform
// ceilings, and before this contract existed they shared one module-level
// constant:
//
//   sync-route     app/api/tenders/[id]/generate/route.ts   maxDuration = 60
//   durable-worker app/api/ai-jobs/run-next/route.ts        maxDuration = 300
//                  app/api/ai-jobs/dispatch/route.ts        maxDuration = 300
//
// A single constant cannot be right for both. Calibrated for the route it
// starves the worker (the observed defect: every proposal fell back after 45s
// inside a worker that had run 99s); calibrated for the worker it would let the
// route overrun its own ceiling and be hard-killed with a 504 instead of
// falling back cleanly.
//
// The ceilings below are duplicated from the route files because Next.js needs
// `maxDuration` to be a literal in the route module. `tests/a-generation-budget-
// belongs-to-its-execution-context.test.ts` asserts the two stay in step, so the
// duplication cannot drift silently.

export type ProposalExecutionContext = "sync-route" | "durable-worker";

export const PROPOSAL_EXECUTION_CEILING_SECONDS: Record<ProposalExecutionContext, number> = {
  "sync-route": 60,
  "durable-worker": 300,
};

export type ProposalExecutionBudget = {
  context: ProposalExecutionContext;
  ceilingSeconds: number;
  reserveSeconds: number;
  /** What configuration asked for; advisory only. */
  requestedMs: number;
  /** What this context can afford, and what the writer must actually use. */
  budgetMs: number;
};

/**
 * The execution budget for proposal generation in a given context.
 *
 * Callers pass the context they are actually running in. There is deliberately
 * no default: a caller that does not know which context it is in cannot know
 * which budget is safe, and silently guessing is the defect this replaces.
 */
export function resolveProposalExecutionBudget(context: ProposalExecutionContext): ProposalExecutionBudget {
  const ceilingSeconds = PROPOSAL_EXECUTION_CEILING_SECONDS[context];
  const profile = getProposalRuntimeProfile(ceilingSeconds);
  return {
    context,
    ceilingSeconds,
    reserveSeconds: profile.generationPostWorkReserveSeconds,
    requestedMs: profile.proposalAiTimeoutMs,
    budgetMs: profile.effectiveProposalBudgetMs,
  };
}
