export type ProposalRuntimeProfile = {
  anthropicTier: string | null;
  maxOutputTokens: number;
  proposalAiTimeoutMs: number;
  routeMaxDurationSeconds: number;
  safetyBufferSeconds: number;
  longRouteExplicitlyEnabled: boolean;
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
    canRunLongProposalGeneration: warnings.length === 0,
    warnings,
    recommendations,
  };
}
