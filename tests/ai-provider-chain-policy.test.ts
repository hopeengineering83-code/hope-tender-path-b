import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/ai.ts", "utf8");
const canonical = ["mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"];

function canonicalChain(): string[] {
  const match = source.match(/CANONICAL_PROVIDER_CHAIN[^=]*=\s*\[([^\]]+)\]/);
  assert.ok(match, "Missing CANONICAL_PROVIDER_CHAIN");
  return Array.from(match[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
}

function chainFor(useCase: string): string[] {
  const direct = source.match(new RegExp(`${useCase}:\\s*\\[([^\\]]+)\\]`));
  if (direct) return Array.from(direct[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
  const spread = source.match(new RegExp(`${useCase}:\\s*\\[\\.\\.\\.CANONICAL_PROVIDER_CHAIN\\]`));
  assert.ok(spread, `Missing ${useCase} provider chain`);
  return canonicalChain();
}

describe("AI provider chain policy", () => {
  it("keeps the required canonical provider chain with Claude/Anthropic last", () => {
    assert.deepEqual(canonicalChain(), canonical);
  });

  it("uses the canonical chain for every use case", () => {
    for (const useCase of ["default", "extraction", "proposal", "validation", "fast"]) {
      assert.deepEqual(chainFor(useCase), canonical, `${useCase} chain mismatch`);
    }
  });

  it("documents and implements proposal/section generation in the required order", () => {
    assert.match(source, /Provider chain for proposal generation: mistral → groq → openrouter → gemini → openai → together → deepseek → anthropic/);
    assert.match(source, /Provider chain for sections: mistral → groq → openrouter → gemini → openai → together → deepseek → anthropic/);
    assert.ok(source.indexOf("// Claude (Anthropic) — last resort") > source.indexOf("// Groq/OpenRouter tail"));
    assert.ok(source.indexOf("// Claude — last resort") > source.indexOf("// Groq/OpenRouter section tail"));
  });
});

describe("admin provider-chain ping budget", () => {
  const route = readFileSync("app/api/admin/ai-provider-health/test/route.ts", "utf8");

  it("keeps the full eight-provider ping within the 30s route budget", () => {
    assert.match(route, /export const maxDuration = 30/);
    assert.match(route, /const PER_PROVIDER_TIMEOUT_MS = 3_000/);
  });

  it("does not ping every provider when the operator requests one provider", () => {
    assert.match(route, /if \(onlyProvider && tester\.provider !== onlyProvider\) continue/);
    assert.match(route, /results\.push\(await tester\.run\(\)\)/);
  });
});

describe("AI provider status surfaces stay aligned with canonical chain", () => {
  const healthRoute = readFileSync("app/api/ai/health/route.ts", "utf8");
  const envReadiness = readFileSync("lib/ai-environment-readiness.ts", "utf8");

  it("surfaces Mistral-first order in the AI health route", () => {
    assert.match(healthRoute, /Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude/);
    assert.ok(healthRoute.indexOf('mistralConfigured ? "mistral"') < healthRoute.indexOf(': geminiConfigured ? "gemini"'));
    assert.ok(healthRoute.indexOf('fallbackRank: 1,\n        label: "Mistral"') < healthRoute.indexOf('fallbackRank: 8,\n        label: "Claude"'));
  });

  it("surfaces Mistral-first order in environment readiness", () => {
    assert.match(envReadiness, /Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude/);
    assert.ok(envReadiness.indexOf('present("MISTRAL_API_KEY")') < envReadiness.indexOf('present("GEMINI_API_KEY")'));
    assert.ok(envReadiness.indexOf('present("ANTHROPIC_API_KEY")') > envReadiness.indexOf('present("OPENROUTER_API_KEY")'));
  });
});
