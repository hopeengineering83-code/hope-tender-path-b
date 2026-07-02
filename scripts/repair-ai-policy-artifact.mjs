#!/usr/bin/env node
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

// Retired repair artifact.
//
// Older revisions of this script wrote a hand-maintained provider order back
// into lib/ai.ts/.env.example. That is now unsafe: the production policy has a
// single canonical automatic order in lib/ai-provider-catalog.cjs, and every
// runtime/health/env surface must derive from it. This script intentionally
// performs verification only so nobody can accidentally reintroduce a stale
// six/eight-provider or Mistral/Gemini-first fallback chain by running it.

const catalog = readFileSync("lib/ai-provider-catalog.cjs", "utf8");
const ai = readFileSync("lib/ai.ts", "utf8");

const requiredOrder = [
  "zai",
  "cerebras",
  "mistral",
  "groq",
  "openrouter",
  "gemini",
  "openai",
  "together",
  "deepseek",
  "anthropic",
];

for (const provider of requiredOrder) {
  assert.match(catalog, new RegExp(`"${provider}"`), `catalog must include ${provider}`);
}

assert.match(ai, /CANONICAL_AI_PROVIDER_ORDER/, "lib/ai.ts must derive provider order from the canonical registry");
assert.doesNotMatch(
  ai,
  /\[\s*"mistral"\s*,\s*"groq"\s*,\s*"openrouter"/,
  "lib/ai.ts must not contain the retired Mistral-first provider-order literal",
);
assert.doesNotMatch(
  ai,
  /Provider chain for sections:\s*[\s\S]*?Gemini[^\n]{1,8}first tier/,
  "section generation must not contain a hand-maintained Gemini-first chain",
);

console.log("AI provider policy artifact is retired; canonical registry verification passed.");
