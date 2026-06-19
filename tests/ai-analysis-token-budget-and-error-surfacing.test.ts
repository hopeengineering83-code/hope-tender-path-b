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
    assert.match(body, /useCase === "extraction" \|\| useCase === "fast"\)\s*return\s*4096/);
    // Proposal generation keeps the full 16K budget.
    assert.match(body, /return 16000/);
  });

  it("threads the computed budget through callProvider", () => {
    const match = source.match(/async function callProvider[\s\S]*?export async function generateWithFallback/);
    assert.ok(match, "callProvider not found");
    const body = match[0];
    assert.match(body, /const maxTokens = maxOutputTokensForUseCase\(opts\?\.useCase\)/);
    // Each OpenAI-compatible provider call must pass maxTokens, never undefined.
    assert.match(body, /generateWithGroq\(prompt, opts\?\.systemPrompt, maxTokens\)/);
    assert.match(body, /generateWithOpenRouter\(prompt, opts\?\.systemPrompt, maxTokens\)/);
    assert.match(body, /generateWithMistral\(prompt, opts\?\.systemPrompt, maxTokens, opts\?\.useCase\)/);
    assert.match(body, /generateWithTogether\(prompt, opts\?\.systemPrompt, maxTokens, opts\?\.useCase\)/);
    assert.doesNotMatch(body, /generateWith(?:Mistral|Together)\(prompt, opts\?\.systemPrompt, undefined/);
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
    assert.match(body, /getProviderStateSnapshot\(provider\)/);
    assert.match(body, /Provider errors: \$\{failureDetails\.join/);
    // Distinguishes an all-cooldown state for actionable diagnostics.
    assert.match(body, /AI_PROVIDERS_RATE_LIMITED/);
  });
});
