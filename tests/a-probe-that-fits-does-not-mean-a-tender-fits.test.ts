import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { maxAcceptableInputTokens, preflightProvider, estimateInputTokens } from "../lib/ai-preflight";

/**
 * THE DEFECT, read off the owner's own run.
 * ------------------------------------------
 * On 2026-09-14 the tender page told the owner, in green:
 *
 *   2 of 4 tested provider(s) completed a real AI Analyze extraction —
 *   AI Analyze can run.
 *     ✓ Gemini  OK (10386ms) · gemini-3.5-flash
 *     ✓ Groq    OK (843ms)   · openai/gpt-oss-120b
 *
 * On that assurance the owner clicked Run AI Analyze. It failed, and the
 * durable AiJob recorded:
 *
 *   All configured AI providers exhausted for use-case "extraction"
 *   (tried: gemini, mistral, zai, cerebras, openrouter, openai, together,
 *    deepseek, anthropic).
 *   ... groq: Prompt exceeds the configured provider throughput budget
 *       (7242 input tokens).
 *
 * Groq is NOT in that `tried:` list. It never received the request: preflight
 * skipped it before contact, because 7242 input + 512 minimum output + a
 * 400-token margin is 8154 against openai/gpt-oss-120b's 8000 TPM ceiling.
 *
 * THE SKIP IS CORRECT AND IS NOT WHAT IS FIXED HERE. A real analysis genuinely
 * does not fit that window, and widening the check to "fit" it would send a
 * known-over-limit request and get a 429 instead — trading a clean skip for a
 * dirty failure, and recording provider ill-health for our own budgeting.
 *
 * What was wrong is the CLAIM. `usableForAiAnalyze` was `passed("analysis")`
 * and nothing more, and the analysis probe sends a tiny fixed payload. Passing
 * it proves the key, the route and the model's structured-output behaviour on
 * a payload no tender resembles. The report now also carries the input ceiling
 * the real run will enforce, measured from the same profile, constants and
 * margins preflight uses, so the two cannot drift apart.
 */

const NO_KEYS: NodeJS.ProcessEnv = { NODE_ENV: "test" };

describe("the measured ceiling is the one the real run enforces", () => {
  it("agrees with preflight at the boundary, for every provider in the chain", () => {
    // The invariant that matters: an input at the ceiling is accepted and one
    // token's worth above it is refused — by preflightProvider itself, not by
    // a second copy of the arithmetic.
    for (const provider of ["groq", "gemini", "zai", "cerebras", "openai", "deepseek"] as const) {
      const ceiling = maxAcceptableInputTokens(provider, "extraction", NO_KEYS);
      if (ceiling.tokens <= 0) continue;

      const atCeiling = "x".repeat(ceiling.tokens * 4);
      const overCeiling = "x".repeat((ceiling.tokens + 64) * 4);

      assert.equal(
        preflightProvider(provider, atCeiling, { useCase: "extraction", env: NO_KEYS }).eligible,
        true,
        `${provider}: an input at the measured ceiling (${ceiling.tokens}) must be accepted`,
      );
      assert.equal(
        preflightProvider(provider, overCeiling, { useCase: "extraction", env: NO_KEYS }).eligible,
        false,
        `${provider}: an input above the measured ceiling must be refused`,
      );
    }
  });

  it("names throughput, not context, when a TPM plan is the binding limit", () => {
    // Groq's gpt-oss-120b has a 131K context and an 8K TPM plan. Reporting the
    // context number would tell an operator they have 16x the headroom they
    // actually have.
    const groq = maxAcceptableInputTokens("groq", "extraction", { ...NO_KEYS, GROQ_ANALYSIS_MODEL: "openai/gpt-oss-120b" });
    assert.equal(groq.limitedBy, "throughput");
    assert.ok(groq.tokens < 8_000, `expected a sub-TPM ceiling, got ${groq.tokens}`);
    assert.ok(groq.tokens > 0);
  });

  it("names context when no throughput plan binds", () => {
    const gemini = maxAcceptableInputTokens("gemini", "extraction", { ...NO_KEYS, GEMINI_ANALYSIS_MODEL: "gemini-3.5-flash" });
    assert.equal(gemini.limitedBy, "context");
    assert.ok(gemini.tokens > 100_000, `a 1M-context flash model should report large headroom, got ${gemini.tokens}`);
  });

  it("reproduces the owner's exact refusal, and shows Gemini would have accepted it", () => {
    // 7242 input tokens — the number the durable AiJob recorded.
    const prompt = "x".repeat(7242 * 4);
    assert.equal(estimateInputTokens(prompt), 7242);

    const groq = preflightProvider("groq", prompt, {
      useCase: "extraction",
      env: { ...NO_KEYS, GROQ_ANALYSIS_MODEL: "openai/gpt-oss-120b" },
    });
    assert.equal(groq.eligible, false);
    assert.equal(groq.reason, "TPM_LIMIT");
    assert.match(groq.safeMessage, /7242 input tokens/);

    const gemini = preflightProvider("gemini", prompt, {
      useCase: "extraction",
      env: { ...NO_KEYS, GEMINI_ANALYSIS_MODEL: "gemini-3.5-flash" },
    });
    assert.equal(gemini.eligible, true, "the same payload must be acceptable to a 1M-context model");
  });

  it("a refused provider is never told it may send something", () => {
    // maxOutputTokens 0 on an ineligible verdict: a caller that ignored
    // `eligible` still cannot construct a request from it.
    const prompt = "x".repeat(7242 * 4);
    const groq = preflightProvider("groq", prompt, {
      useCase: "extraction",
      env: { ...NO_KEYS, GROQ_ANALYSIS_MODEL: "openai/gpt-oss-120b" },
    });
    assert.equal(groq.maxOutputTokens, 0);
  });

  it("reports a ceiling of zero rather than a negative allowance", () => {
    // A plan smaller than the minimum useful output must read as "accepts
    // nothing", never as a negative number that arithmetic elsewhere would
    // treat as room.
    for (const provider of ["groq", "gemini", "zai", "cerebras", "mistral", "openrouter", "openai", "together", "deepseek", "anthropic"] as const) {
      const ceiling = maxAcceptableInputTokens(provider, "extraction", NO_KEYS);
      assert.ok(ceiling.tokens >= 0, `${provider} reported a negative ceiling`);
      assert.ok(Number.isFinite(ceiling.tokens), `${provider} reported a non-finite ceiling`);
    }
  });
});
