/**
 * Centralized timeout configuration for all AI and async operations.
 * All timeouts are configurable via environment variables with sensible defaults.
 *
 * Pattern: Each timeout reads from its env var first, falls back to a default
 * if the env var is missing or invalid, and validates the range.
 */

function readTimeoutMs(envVar: string, defaultMs: number, minMs = 1_000, maxMs = 600_000): number {
  const raw = Number(process.env[envVar]);
  if (Number.isFinite(raw) && raw >= minMs && raw <= maxMs) return raw;
  return defaultMs;
}

// AI Analysis (tender content processing via chunked LLM calls)
export const AI_ANALYSIS_TIMEOUT_MS = (() => {
  const raw = Number(process.env.AI_ANALYSIS_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 5_000 && raw <= 600_000) return raw;
  // Scale by Vercel tier: tier 3/4 allow 300s, tier 1/2 are 60s hard limit
  const tier = (process.env.ANTHROPIC_TIER || "").trim();
  return tier === "3" || tier === "4" ? 240_000 : 50_000;
})();

// AI Proposal generation (entire proposal per tender)
export const AI_PROPOSAL_TIMEOUT_MS = readTimeoutMs("AI_PROPOSAL_TIMEOUT_MS", 55_000, 10_000, 300_000);

// AI document polishing (formatting and financial-hygiene rewriting)
export const POLISH_TIMEOUT_MS = readTimeoutMs("POLISH_TIMEOUT_MS", 18_000, 5_000, 60_000);

// AI proposal section generation (individual sections: requirements, risks, schedule, etc.)
export const PROPOSAL_SECTION_TIMEOUT_MS = readTimeoutMs("PROPOSAL_SECTION_TIMEOUT_MS", 30_000, 5_000, 600_000);

// Refinement call timeout (refining chunk results before merging)
export const REFINEMENT_CALL_TIMEOUT_MS = readTimeoutMs("REFINEMENT_CALL_TIMEOUT_MS", 25_000, 5_000, 120_000);

// Requirement rematch timeout (matching extracted requirements to tender content)
export const REMATCH_TIMEOUT_MS = readTimeoutMs("REMATCH_TIMEOUT_MS", 40_000, 10_000, 120_000);

// Evaluator simulation timeout (running evaluation criteria scenarios)
export const SIMULATION_TIMEOUT_MS = readTimeoutMs("EVALUATOR_SIMULATION_TIMEOUT_MS", 50_000, 10_000, 300_000);

// Copilot AI call timeout (interactive assistant responses)
export const COPILOT_TIMEOUT_MS = readTimeoutMs("COPILOT_TIMEOUT_MS", 45_000, 5_000, 120_000);

// Proposal AI timeout (used in generate-elite; tier-dependent: tier 1 = 45s, others = 220s)
export const PROPOSAL_AI_TIMEOUT_MS = (() => {
  const raw = Number(process.env.AI_PROPOSAL_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 5_000 && raw <= 600_000) return raw;
  const tier = (process.env.ANTHROPIC_TIER || "").trim();
  return tier === "1" ? 45_000 : 220_000;
})();

// Provider-specific timeouts (used in health checks and provider selection)
export const PER_PROVIDER_TIMEOUT_MS = readTimeoutMs("PER_PROVIDER_TIMEOUT_MS", 3_000, 1_000, 30_000);
export const ANTHROPIC_TIMEOUT_MS = readTimeoutMs("ANTHROPIC_TIMEOUT_MS", 10_000, 5_000, 60_000);
export const DEEPSEEK_DEFAULT_TIMEOUT_MS = readTimeoutMs("DEEPSEEK_TIMEOUT_MS", 20_000, 5_000, 120_000);
export const OPENAI_COMPAT_DEFAULT_TIMEOUT_MS = readTimeoutMs("OPENAI_COMPAT_TIMEOUT_MS", 20_000, 5_000, 120_000);

// Special timeout for o1/o3 models (reasoning models need more time)
export const O1_O3_TIMEOUT_MS = readTimeoutMs("O1_O3_TIMEOUT_MS", 90_000, 30_000, 300_000);

// Gemini provider timeout (configurable via GEMINI_TIMEOUT_MS)
export const GEMINI_TIMEOUT_MS = readTimeoutMs("GEMINI_TIMEOUT_MS", 28_000, 5_000, 120_000);
