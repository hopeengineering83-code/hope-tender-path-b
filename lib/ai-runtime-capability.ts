export type ProposalRuntimeProfile = {
  anthropicTier: string | null;
  maxOutputTokens: number;
  proposalAiTimeoutMs: number;
  routeMaxDurationSeconds: number;
  safetyBufferSeconds: number;
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

function configuredMaxOutputTokens(tier: string | null): number {
  const explicit = readNumberEnv("ANTHROPIC_MAX_OUTPUT_TOKENS");
  if (explicit && explicit > 0) return Math.min(explicit, 64_000);
  return tier === "1" ? 8_000 : 16_000;
}

function configuredProposalTimeoutMs(tier: string | null): number {
  const explicit = readNumberEnv("AI_PROPOSAL_TIMEOUT_MS");
  if (explicit && explicit >= 5_000 && explicit <= 600_000) return explicit;
  return tier === "1" ? 45_000 : 220_000;
}

export function getProposalRuntimeProfile(routeMaxDurationSeconds = 300): ProposalRuntimeProfile {
  const tier = (process.env.ANTHROPIC_TIER || "").trim() || null;
  const maxOutputTokens = configuredMaxOutputTokens(tier);
  const proposalAiTimeoutMs = configuredProposalTimeoutMs(tier);
  const safetyBufferSeconds = 30;
  const safeBudgetMs = Math.max(5_000, (routeMaxDurationSeconds - safetyBufferSeconds) * 1_000);
  const warnings: string[] = [];
  const recommendations: string[] = [];

  if (!tier) {
    warnings.push("ANTHROPIC_TIER is not set. The app defaults to Tier 2-style 16K output and 220s proposal timeout.");
    recommendations.push("Set ANTHROPIC_TIER=1 for Vercel Hobby / low Anthropic rate limits, or ANTHROPIC_TIER=2 for Vercel Pro + Anthropic Tier 2.");
  }

  if (maxOutputTokens >= 16_000 && routeMaxDurationSeconds < 240) {
    warnings.push(`Configured output budget is ${maxOutputTokens} tokens but route maxDuration is only ${routeMaxDurationSeconds}s.`);
    recommendations.push("Use a 300s route cap for 16K proposal generation, or lower ANTHROPIC_MAX_OUTPUT_TOKENS to 8000.");
  }

  if (proposalAiTimeoutMs > safeBudgetMs) {
    warnings.push(`AI proposal timeout ${Math.round(proposalAiTimeoutMs / 1000)}s exceeds safe route budget ${Math.round(safeBudgetMs / 1000)}s.`);
    recommendations.push(`Set AI_PROPOSAL_TIMEOUT_MS <= ${safeBudgetMs} or increase the route maxDuration.`);
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
    canRunProposalGeneration: warnings.length === 0,
    warnings,
    recommendations,
  };
}
