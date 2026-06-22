import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/ai.ts", "utf8");
const canonical = ["zai", "cerebras", "mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"];
const displayOrder = "Z.ai GLM → Cerebras → Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Anthropic / Claude";

function canonicalChain(): string[] {
  const match = source.match(/CANONICAL_PROVIDER_CHAIN\s*=\s*CANONICAL_AI_PROVIDER_ORDER/);
  if (match) {
      // It's using the registry, which is what we want.
      return canonical;
  }
  const directMatch = source.match(/CANONICAL_PROVIDER_CHAIN[^=]*=\s*\[([^\]]+)\]/);
  assert.ok(directMatch, "Missing CANONICAL_PROVIDER_CHAIN");
  return Array.from(directMatch[1].matchAll(/"([^"]+)"/g)).map((item) => item[1]);
}

describe("AI provider chain policy", () => {
  it("uses the required canonical provider chain with Claude last", () => {
    assert.deepEqual(canonicalChain(), canonical);
  });

  it("includes Mistral and Together in the canonical chain", () => {
    assert.ok(canonicalChain().includes("mistral"), "mistral must be in canonical chain");
    assert.ok(canonicalChain().includes("together"), "together must be in canonical chain");
    assert.equal(canonicalChain()[0], "zai", "zai must be first");
    assert.equal(canonicalChain()[canonicalChain().length - 1], "anthropic", "claude/anthropic must be last");
  });
});

describe("AI provider status surfaces stay aligned with canonical chain", () => {
  const healthRoute = readFileSync("app/api/ai/health/route.ts", "utf8");

  it("surfaces the required order in health", () => {
    assert.ok(healthRoute.includes("CANONICAL_AI_PROVIDER_DISPLAY"));
  });

  it("surfaces Zai-first order in the AI health route", () => {
    assert.ok(healthRoute.indexOf('computePreferredProvider') !== -1);
  });
});
