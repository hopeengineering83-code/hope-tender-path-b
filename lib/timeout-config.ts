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
// Structured extraction is materially slower than the basic connectivity
// probe. Keep Mistral's normal OpenAI-compatible budget unchanged, but give the
// durable extraction worker a small, bounded allowance before it falls through
// to the remaining providers. The worker's absolute deadline still clamps this
// value via resolveEffectiveTimeoutMs.
export const MISTRAL_EXTRACTION_TIMEOUT_MS = readTimeoutMs("MISTRAL_EXTRACTION_TIMEOUT_MS", 35_000, 20_000, 60_000);
export const O1_O3_TIMEOUT_MS = readTimeoutMs("O1_O3_TIMEOUT_MS", 90_000, 30_000, 300_000);
// Gemini is rank 1 of the canonical chain, so when its budget is too small
// every real workload silently becomes some other provider's problem.
//
// Measured against the live API, not estimated: a real tender extraction
// (8,010-character prompt, gemini-2.5-flash) returns 15,277 characters of
// good output in 38,488ms. The previous 28,000ms default aborted that call at
// exactly 28s, every time, and surfaced as
//
//   Gemini model unavailable … Request aborted … This operation was aborted
//
// which reads like the model is missing rather than like we cancelled our own
// request. The chain then fell through to providers that were out of credit,
// so all four proposal sections came back from the deterministic fallback.
//
// 60s leaves roughly 55% headroom over the measured latency for longer
// tenders without being unbounded. This is a ceiling, not a reservation: the
// worker's absolute deadline still clamps it through resolveEffectiveTimeoutMs
// — the same reasoning as MISTRAL_EXTRACTION_TIMEOUT_MS above — so a request
// with less remaining budget still gets only what is left, and nothing here
// lets a hung provider outlive its parent.
export const GEMINI_TIMEOUT_MS = readTimeoutMs("GEMINI_TIMEOUT_MS", 60_000, 5_000, 120_000);
