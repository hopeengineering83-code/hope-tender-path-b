import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/ai.ts", "utf8");
const reconciler = readFileSync("scripts/reconcile-gap-closure.mjs", "utf8");
const canonical = ["mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"];
const displayOrder = "Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude";

function canonicalChain(): string[] {
  const match = source.match(/CANONICAL_PROVIDER_CHAIN[^=]*=\s*\[([^\]]+)\]/);
  assert.ok(match, "Missing CANONICAL_PROVIDER_CHAIN");
  return Array.from(match[1].matchAll(/"([^"]+)"/g)).map((item) => item[1]);
}

function chainFor(useCase: string): string[] {
  const direct = source.match(new RegExp(`${useCase}:\\s*\\[([^\\]]+)\\]`));
  if (direct) return Array.from(direct[1].matchAll(/"([^"]+)"/g)).map((item) => item[1]);
  const spread = source.match(new RegExp(`${useCase}:\\s*\\[\\.\\.\\.CANONICAL_PROVIDER_CHAIN\\]`));
  assert.ok(spread, `Missing ${useCase} provider chain`);
  return canonicalChain();
}

describe("AI provider gateway policy", () => {
  it("uses the required canonical provider chain with Claude last", () => {
    assert.deepEqual(canonicalChain(), canonical);
  });

  it("uses the canonical chain for every generic gateway use case", () => {
    for (const useCase of ["default", "extraction", "proposal", "validation", "fast", "reasoning"]) {
      assert.deepEqual(chainFor(useCase), canonical, `${useCase} chain mismatch`);
    }
  });

  it("applies the prompt trust boundary before generic provider calls", () => {
    assert.match(source, /const trustBoundary = protectPrompt\(prompt\)/);
    assert.match(source, /callProvider\(provider, trustBoundary\.protectedPrompt/);
  });

  it("never rewrites AI or UI source during install, build, lint, test, or typecheck", () => {
    assert.equal(/writeFileSync|appendFileSync|renameSync|unlinkSync|rmSync|cpSync/.test(reconciler), false);
    assert.match(reconciler, /readFileSync/);
    assert.match(reconciler, /never rewrites repository files|without modifying repository files/);
  });
});

describe("admin provider-chain ping budget", () => {
  const route = readFileSync("app/api/admin/ai-provider-health/test/route.ts", "utf8");

  it("keeps provider pings within the route budget", () => {
    assert.match(route, /export const maxDuration = 30/);
    assert.match(route, /const PER_PROVIDER_TIMEOUT_MS = 3_000/);
  });

  it("does not ping every provider when one provider is requested", () => {
    assert.match(route, /if \(onlyProvider && tester\.provider !== onlyProvider\) continue/);
    assert.match(route, /results\.push\(await tester\.run\(\)\)/);
  });
});

describe("AI provider status surfaces stay aligned with canonical chain", () => {
  const healthRoute = readFileSync("app/api/ai/health/route.ts", "utf8");
  const envReadiness = readFileSync("lib/ai-environment-readiness.ts", "utf8");
  const systemReadiness = readFileSync("lib/system-readiness.ts", "utf8");

  it("surfaces the required order in health and readiness", () => {
    assert.ok(healthRoute.includes(displayOrder));
    assert.ok(envReadiness.includes(displayOrder));
    assert.ok(systemReadiness.includes("Gemini") && systemReadiness.includes("OpenRouter"));
  });

  it("surfaces Mistral-first order in the AI health route", () => {
    assert.match(healthRoute, /Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude/);
    assert.ok(healthRoute.indexOf('mistralConfigured ? "mistral"') < healthRoute.indexOf(': geminiConfigured ? "gemini"'));
    assert.ok(healthRoute.indexOf('fallbackRank: 1,\n        label: "Mistral"') < healthRoute.indexOf('fallbackRank: 8,\n        label: "Claude"'));
  });

  it("keeps configured-provider checks in required relative order", () => {
    assert.ok(envReadiness.indexOf('present("MISTRAL_API_KEY")') < envReadiness.indexOf('present("GROQ_API_KEY")'));
    assert.ok(envReadiness.indexOf('present("GROQ_API_KEY")') < envReadiness.indexOf('present("OPENROUTER_API_KEY")'));
    assert.ok(envReadiness.indexOf('present("OPENROUTER_API_KEY")') < envReadiness.indexOf('present("GEMINI_API_KEY")'));
    assert.ok(envReadiness.indexOf('present("GEMINI_API_KEY")') < envReadiness.indexOf('present("OPENAI_API_KEY")'));
    assert.ok(envReadiness.indexOf('present("OPENAI_API_KEY")') < envReadiness.indexOf('present("TOGETHER_API_KEY")'));
    assert.ok(envReadiness.indexOf('present("TOGETHER_API_KEY")') < envReadiness.indexOf('present("DEEPSEEK_API_KEY")'));
    assert.ok(envReadiness.indexOf('present("DEEPSEEK_API_KEY")') < envReadiness.indexOf('present("ANTHROPIC_API_KEY")'));
  });
});
