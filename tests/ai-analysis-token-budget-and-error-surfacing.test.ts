// Regression guard for the "providers pass health PING but AI Analyze always
// falls back to regex" production bug.
//
// Two root causes were fixed in lib/ai.ts:
//   1. The analysis/extraction path inherited the 16000-token proposal output
//      budget. Against models whose completion cap is lower (commonly the model
//      `openrouter/auto` routes to, and some Groq/Mistral models) a 16K request
//      returns HTTP 400, and the oversized reservation inflates free-tier
//      tokens-per-minute usage causing 429s — so every provider failed the real
//      analysis even though the tiny PING (max_tokens: 10) passed.
//   2. The OpenAI-compatible caller swallowed the real HTTP error to null, so
//      diagnostics could only ever report a generic "all providers exhausted".
//
// These are source-shape assertions (no network) so they stay deterministic and
// fast while preventing a regression of either fix.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/ai.ts", "utf8");

describe("AI analysis output-token budget", () => {
  it("defines a per-use-case output budget helper", () => {
    assert.match(source, /function maxOutputTokensForUseCase/);
  });

  it("requests a bounded (non-16K) budget for extraction/fast use cases", () => {
    const match = source.match(/function maxOutputTokensForUseCase[\s\S]*?\n}/);
    assert.ok(match, "maxOutputTokensForUseCase not found");
    const body = match[0];
    // Per-provider caps come from the registry (zai/cerebras = conservative);
    // the generic fallback keeps a bounded extraction/fast budget.
    assert.match(body, /getProviderOutputCap\(provider, useCase\)/);
    assert.match(body, /useCase === "extraction" \|\| useCase === "fast"\)\s*return\s*4096/);
    assert.match(body, /return 16000/);
  });

  it("threads the per-provider computed budget through callProvider", () => {
    const match = source.match(/async function callProvider[\s\S]*?export async function generateWithFallback/);
    assert.ok(match, "callProvider not found");
    const body = match[0];
    // Budget is computed per-provider via the registry caps, and a caller may
    // now lower it for a single call.
    assert.match(body, /maxOutputTokensForUseCase\(useCase, name\)/);
    assert.match(
      body,
      /Math\.min\(opts\.maxOutputTokens, registryBudget\)/,
      "a caller-supplied cap must be clamped to the registry budget, never able to raise it",
    );
    // Each OpenAI-compatible provider call must pass maxTokens, never undefined.
    assert.match(body, /generateWithGroq\(prompt, opts\?\.systemPrompt, maxTokens, useCase, opts\?\.modelOverride\)/);
    assert.match(body, /generateWithOpenRouter\(prompt, opts\?\.systemPrompt, maxTokens, opts\?\.modelOverride\)/);
    assert.match(body, /generateWithMistral\(prompt, opts\?\.systemPrompt, maxTokens, opts\?\.useCase, opts\?\.modelOverride\)/);
    assert.match(body, /generateWithTogether\(prompt, opts\?\.systemPrompt, maxTokens, opts\?\.useCase\)/);
    assert.doesNotMatch(body, /generateWith(?:Mistral|Together)\(prompt, opts\?\.systemPrompt, undefined/);
  });

  it("a caller cannot raise a provider's budget above its registry cap", () => {
    // Per-section proposal generation lowers the budget so four concurrent
    // calls fit inside one serverless invocation. The clamp is what stops that
    // parameter becoming a way to ask any provider for more than it is
    // configured to give — which would reintroduce the monolithic 16K call by
    // the back door.
    const match = source.match(/async function callProviderInner[\s\S]*?const wantJson/);
    assert.ok(match, "callProviderInner not found");
    assert.match(match[0], /Math\.min\(opts\.maxOutputTokens, registryBudget\)/);
    assert.doesNotMatch(
      match[0],
      /Math\.max\(opts\.maxOutputTokens/,
      "clamping must be downward only",
    );
  });

  it("Cerebras never reserves a 16K free-tier budget (conservative caps)", () => {
    // Cerebras uses max_completion_tokens with conservative caps from the registry.
    assert.match(source, /maxTokensParam: "max_completion_tokens"/);
  });
});

describe("AI provider error surfacing", () => {
  it("records the real failure reason inside the OpenAI-compatible caller", () => {
    const match = source.match(/async function generateOpenAICompatible[\s\S]*?\n}\n/);
    assert.ok(match, "generateOpenAICompatible not found");
    const body = match[0];
    // The note() helper records the actual reason rather than swallowing it.
    assert.match(body, /const note = \(reason: string\) =>/);
    assert.match(body, /recordProviderFailure\(providerName/);
    // It is invoked on the HTTP-error, rate-limit, empty-content and timeout paths.
    assert.match(body, /note\(`rate limit HTTP 429/);
    assert.match(body, /note\(`HTTP \$\{res\.status\}/);
    assert.match(body, /note\(`timed out after/);
  });

  it("surfaces per-provider reasons in the exhausted error from generateWithFallback", () => {
    const match = source.match(/export async function generateWithFallback[\s\S]*?\n}\n/);
    assert.ok(match, "generateWithFallback not found");
    const body = match[0];
    // generateWithFallback must still capture the real per-provider failure
    // reason via getProviderStateSnapshot (PR #775/#778 regression guard).
    assert.match(body, /getProviderStateSnapshot\(provider\)/);
    // generateWithFallback must build a human-readable failureDetails array
    // (PR #775/#778 regression guard) and pass it to the structured error.
    assert.match(body, /failureDetails\.push\(`\$\{provider\}: \$\{safeReason\}`\)/);
    assert.match(body, /throw new NoAiProviderReadyError\(\{[\s\S]*?failureDetails,/);
    // The structured NoAiProviderReadyError class (defined elsewhere in lib/ai.ts)
    // must preserve the AI_PROVIDERS_RATE_LIMITED message prefix when every
    // configured provider is in cooldown, so legacy diagnostics
    // (lib/engine/analysis-fallback-diagnostics.ts) that string-match on this
    // prefix continue to classify the error correctly.
    assert.match(source, /AI_PROVIDERS_RATE_LIMITED:/);
    // The structured error must include failureDetails.join in its
    // human-readable message so per-provider reasons are surfaced.
    assert.match(source, /Provider errors: \$\{failureDetails\.join\(" \| "\) \|\| "none captured"\}/);
  });
});
