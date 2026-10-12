import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  perProviderFailureCategories,
  summarizeAIAnalyzeFailure,
} from "../components/ai-analyze-panel";

/**
 * THE DEFECT, read off the owner's screen.
 * ----------------------------------------
 * The tender page reported an AI Analyze failure as:
 *
 *   AI Analyze could not complete after the configured provider chain.
 *   Observed categories: BILLING, AUTH_OR_CONFIGURATION_INVALID, RATE_LIMITED,
 *   TEMPORARILY_UNAVAILABLE, MALFORMED_RESPONSE. Open Provider diagnostics for
 *   unique-provider results, then retry AI Analyze.
 *
 * Every one of those categories was true of SOME provider and none of them said
 * which. The owner was then sent to Provider diagnostics — a separate live test
 * that spends real provider round-trips — to learn what the durable job had
 * already recorded. The pairing was in the message the whole time: the server
 * writes `Provider errors: gemini: <msg> | groq: <msg> | ...` and the summary
 * discarded it before reading it.
 *
 * It is not a cosmetic loss. A union cannot separate the one provider the owner
 * can fix in a minute — a model their subscription tier does not allow — from
 * the eight that are externally blocked and need nothing from them.
 */

/** The owner's real durable AiJob 4a678bf3, verbatim apart from truncation. */
const REAL_FAILURE = [
  'All 2 chunked analysis calls failed. Errors: chunk 1: All configured AI providers',
  'exhausted for use-case "extraction" (tried: gemini, groq, mistral, zai, cerebras,',
  'openrouter, openai, together, deepseek, anthropic). Provider errors:',
  'gemini: Gemini model unavailable. Tried: gemini-3.5-flash. Errors: gemini-3.5-flash:',
  '[GoogleGenerativeAI Error]: [503 Service Unavailable] This model is currently',
  'experiencing high demand.',
  '| groq: Groq openai/gpt-oss-120b hit the output token budget before producing any',
  'content (max_tokens=1335) — raise the budget',
  '| mistral: Mistral auth error HTTP 403: {"message":"This model is not available in',
  'your subscription tier","type":"tier_not_allowed","code":"1910"}',
  '| zai: Z.ai GLM rate limit HTTP 429 on glm-4.7-flash: {"error":{"code":"1305"}}',
  '| cerebras: Cerebras HTTP 402 on qwen-3.8-27b: {"message":"Payment required"}',
  '| anthropic: empty response.',
  '| chunk 2: All configured AI providers exhausted for use-case "extraction"',
  '(tried: groq). Provider errors: gemini: in cooldown',
  '| groq: Groq rate limit HTTP 429 on openai/gpt-oss-120b: {"message":"Limit 8000"}',
].join(" ");

describe("a failure summary must say which provider failed how", () => {
  it("recovers the provider pairing the server already wrote", () => {
    const rows = perProviderFailureCategories(REAL_FAILURE);
    const byName = new Map(rows.map((r) => [r.provider, r.categories]));

    assert.deepEqual(byName.get("gemini"), ["TEMPORARILY_UNAVAILABLE", "SKIPPED_COOLING_DOWN"]);
    assert.ok(byName.get("mistral")?.includes("AUTH_OR_CONFIGURATION_INVALID"));
    assert.ok(byName.get("zai")?.includes("RATE_LIMITED"));
    assert.ok(byName.get("cerebras")?.includes("BILLING"));
    assert.ok(byName.get("anthropic")?.includes("MALFORMED_RESPONSE"));
  });

  it("merges a provider that failed differently on different chunks", () => {
    const rows = perProviderFailureCategories(REAL_FAILURE);
    const groq = rows.find((r) => r.provider === "groq")?.categories ?? [];
    // Chunk 1 exhausted the output budget; chunk 2 was rate-limited. Both are
    // true of Groq and reporting only one would misdescribe the run.
    assert.ok(groq.includes("OUTPUT_BUDGET_TOO_SMALL"), `expected the output-budget cause, got ${groq.join(",")}`);
    assert.ok(groq.includes("RATE_LIMITED"), `expected the rate-limit cause, got ${groq.join(",")}`);
  });

  it("reports in canonical chain order, not discovery order", () => {
    const order = perProviderFailureCategories(REAL_FAILURE).map((r) => r.provider);
    const canonical = ["gemini", "groq", "mistral", "zai", "cerebras", "anthropic"];
    assert.deepEqual(order, canonical);
  });

  it("does not treat a chunk separator as a provider", () => {
    const names = perProviderFailureCategories(REAL_FAILURE).map((r) => r.provider);
    assert.ok(!names.includes("chunk"), "the `chunk 2:` separator is not a provider");
    assert.ok(!names.some((n) => /^\d/.test(n)));
  });

  it("names providers in the summary instead of a union of categories", () => {
    const summary = summarizeAIAnalyzeFailure(REAL_FAILURE);
    assert.match(summary, /Gemini:/);
    assert.match(summary, /Mistral:/);
    assert.match(summary, /Z\.ai:/);
    // The old union phrasing must not come back for a message that HAS pairing.
    assert.doesNotMatch(summary, /Observed categories: BILLING, AUTH_OR_CONFIGURATION_INVALID/);
  });

  it("says what the owner can act on, in words rather than an enum", () => {
    const summary = summarizeAIAnalyzeFailure(REAL_FAILURE);
    // The tier-blocked model is the one thing here the owner can fix for free,
    // so the summary has to say so rather than print a constant name at them.
    assert.match(summary, /Mistral: [^·]*plan includes the model/);
    assert.match(summary, /Cerebras: [^·]*no credit/);
    assert.doesNotMatch(summary, /AUTH_OR_CONFIGURATION_INVALID/, "raw enum names are for the code and the diagnostics, not the tender page");
    assert.doesNotMatch(summary, /OUTPUT_BUDGET_TOO_SMALL/);
  });

  it("never echoes a provider payload into the workflow UI", () => {
    const summary = summarizeAIAnalyzeFailure(REAL_FAILURE);
    for (const leak of ["gpt-oss-120b", "glm-4.7-flash", "qwen-3.8-27b", "max_tokens", "GoogleGenerativeAI", "tier_not_allowed"]) {
      assert.ok(!summary.includes(leak), `summary leaked provider payload: ${leak}`);
    }
  });

  it("falls back to an explicitly unattributed union when there is no pairing", () => {
    const summary = summarizeAIAnalyzeFailure("provider chain failed: HTTP 429 rate limit and a 402 billing refusal");
    assert.match(summary, /not attributed to a provider/);
    assert.match(summary, /rate limited/);
    assert.match(summary, /no credit/);
  });

  it("leaves a non-provider failure exactly as it was", () => {
    assert.equal(
      summarizeAIAnalyzeFailure("SOURCE_SNAPSHOT_UNCERTAIN_FRESH_ANALYSIS_REQUIRED"),
      "SOURCE_SNAPSHOT_UNCERTAIN_FRESH_ANALYSIS_REQUIRED",
    );
  });
});
