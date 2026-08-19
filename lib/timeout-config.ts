/**
 * Centralized timeout configuration for all AI and async operations.
 * All timeouts are configurable via environment variables with sensible defaults.
 */

function readTimeoutMs(envVar: string, defaultMs: number, minMs = 1_000, maxMs = 600_000): number {
  const raw = Number(process.env[envVar]);
  if (Number.isFinite(raw) && raw >= minMs && raw <= maxMs) return raw;
  return defaultMs;
}

export const AI_ANALYSIS_TIMEOUT_MS = (() => {
  const raw = Number(process.env.AI_ANALYSIS_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 5_000 && raw <= 600_000) return raw;
  const tier = (process.env.ANTHROPIC_TIER || "").trim();
  return tier === "3" || tier === "4" ? 240_000 : 50_000;
})();

export const AI_PROPOSAL_TIMEOUT_MS = readTimeoutMs("AI_PROPOSAL_TIMEOUT_MS", 55_000, 10_000, 300_000);
export const POLISH_TIMEOUT_MS = readTimeoutMs("POLISH_TIMEOUT_MS", 18_000, 5_000, 60_000);
export const PROPOSAL_SECTION_TIMEOUT_MS = readTimeoutMs("PROPOSAL_SECTION_TIMEOUT_MS", 30_000, 5_000, 600_000);
export const REFINEMENT_CALL_TIMEOUT_MS = readTimeoutMs("REFINEMENT_CALL_TIMEOUT_MS", 25_000, 5_000, 120_000);

// Engine reranking must leave enough of Vercel's 60-second function budget for
// deterministic persistence and postconditions. Local/long-running workers keep
// the wider timeout; Vercel defaults to 8 seconds per bounded provider pass.
export const REMATCH_TIMEOUT_MS = (() => {
  const raw = Number(process.env.REMATCH_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 3_000 && raw <= 120_000) return raw;
  return process.env.VERCEL === "1" ? 8_000 : 40_000;
})();

export const SIMULATION_TIMEOUT_MS = readTimeoutMs("EVALUATOR_SIMULATION_TIMEOUT_MS", 50_000, 10_000, 300_000);
export const COPILOT_TIMEOUT_MS = readTimeoutMs("COPILOT_TIMEOUT_MS", 45_000, 5_000, 120_000);

export const PROPOSAL_AI_TIMEOUT_MS = (() => {
  const raw = Number(process.env.AI_PROPOSAL_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 5_000 && raw <= 600_000) return raw;
  const tier = (process.env.ANTHROPIC_TIER || "").trim();
  return tier === "1" ? 45_000 : 220_000;
})();

export const PER_PROVIDER_TIMEOUT_MS = readTimeoutMs("PER_PROVIDER_TIMEOUT_MS", 3_000, 1_000, 30_000);
export const ANTHROPIC_TIMEOUT_MS = readTimeoutMs("ANTHROPIC_TIMEOUT_MS", 10_000, 5_000, 60_000);
export const DEEPSEEK_DEFAULT_TIMEOUT_MS = readTimeoutMs("DEEPSEEK_TIMEOUT_MS", 20_000, 5_000, 120_000);
export const OPENAI_COMPAT_DEFAULT_TIMEOUT_MS = readTimeoutMs("OPENAI_COMPAT_TIMEOUT_MS", 20_000, 5_000, 120_000);
export const O1_O3_TIMEOUT_MS = readTimeoutMs("O1_O3_TIMEOUT_MS", 90_000, 30_000, 300_000);
export const GEMINI_TIMEOUT_MS = readTimeoutMs("GEMINI_TIMEOUT_MS", 28_000, 5_000, 120_000);
