export type ProposalRuntimeProfile = {
  anthropicTier: string | null;
  maxOutputTokens: number;
  proposalAiTimeoutMs: number;
  routeMaxDurationSeconds: number;
  safetyBufferSeconds: number;
  longRouteExplicitlyEnabled: boolean;
  canRunProposalGeneration: boolean;
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
    : longRouteExplicitlyEnabled && tier !== "1"
      ? 16_000
      : 8_000;
  const proposalAiTimeoutMs = explicitTimeout && explicitTimeout >= 5_000 && explicitTimeout <= 600_000
    ? explicitTimeout
    : longRouteExplicitlyEnabled && tier !== "1"
      ? 220_000
      : 45_000;
  const safetyBufferSeconds = routeMaxDurationSeconds >= 240 ? 30 : 15;
  const safeBudgetMs = Math.max(5_000, (routeMaxDurationSeconds - safetyBufferSeconds) * 1_000);
  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (!tier) {
    warnings.push("ANTHROPIC_TIER is not set. The app is using the deploy-safe 8K / 45s profile until long-route capacity is explicitly enabled.");
    recommendations.push("Set ANTHROPIC_TIER=2 and AI_PROPOSAL_LONG_ROUTE_ENABLED=true only on Vercel Pro/Enterprise or another runtime with a >=240s route budget.");
  }

  if (maxOutputTokens >= 16_000 && !longRouteExplicitlyEnabled) {
    warnings.push("16K output is configured without AI_PROPOSAL_LONG_ROUTE_ENABLED=true and a >=240s route budget.");
    recommendations.push("Enable long-route mode only after confirming the deployment supports long serverless functions, or lower ANTHROPIC_MAX_OUTPUT_TOKENS to 8000.");
  }

  if (proposalAiTimeoutMs > safeBudgetMs) {
    warnings.push(`AI proposal timeout ${Math.round(proposalAiTimeoutMs / 1000)}s exceeds safe route budget ${Math.round(safeBudgetMs / 1000)}s.`);
    recommendations.push(`Set AI_PROPOSAL_TIMEOUT_MS <= ${safeBudgetMs} or use a route/runtime that supports the requested timeout.`);
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
    canRunProposalGeneration: warnings.length === 0,
    warnings,
    recommendations,
  };
}
