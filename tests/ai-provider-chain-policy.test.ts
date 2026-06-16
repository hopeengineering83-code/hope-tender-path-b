import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/ai.ts", "utf8");
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

function executableProviderOrder(startMarker: string, endMarker: string): string[] {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Unable to isolate executable provider block: ${startMarker}`);
  const block = source.slice(start, end);
  const result: string[] = [];
  for (const match of block.matchAll(/isProviderCooledDown\("([^"]+)"\)/g)) {
    const provider = match[1];
    if (!result.includes(provider)) result.push(provider);
  }
  return result;
}

describe("AI provider chain policy", () => {
  it("uses the required canonical provider chain with Claude last", () => {
    assert.deepEqual(canonicalChain(), canonical);
  });

  it("uses the canonical chain for every supported generic use case", () => {
    for (const useCase of ["default", "extraction", "proposal", "validation", "fast", "reasoning"]) {
      assert.deepEqual(chainFor(useCase), canonical, `${useCase} chain mismatch`);
    }
  });

  it("enables AI when any canonical provider is configured", () => {
    const match = source.match(/export function isAIEnabled\(\) \{[\s\S]*?\n\}/);
    assert.ok(match, "Missing isAIEnabled()");
    for (const token of [
      "isMistralConfigured()",
      "isGroqConfigured()",
      "isOpenRouterConfigured()",
      "apiKey",
      "process.env.OPENAI_API_KEY",
      "isTogetherConfigured()",
      "isDeepSeekConfigured()",
      "anthropicApiKey",
    ]) {
      assert.ok(match[0].includes(token), `isAIEnabled() must include ${token}`);
    }
  });

  it("executes monolithic proposal providers in canonical order", () => {
    assert.deepEqual(
      executableProviderOrder(
        "// Provider chain for proposal generation:",
        "lastProposalProvider = null;",
      ),
      canonical,
    );
  });

  it("executes parallel-section providers in canonical order", () => {
    assert.deepEqual(
      executableProviderOrder(
        "// Provider chain for sections:",
        "// All providers failed (or unavailable).",
      ),
      canonical,
    );
  });

  it("applies the prompt trust boundary before generic provider calls", () => {
    assert.match(source, /const trustBoundary = protectPrompt\(prompt\)/);
    assert.match(source, /callProvider\(provider, trustBoundary\.protectedPrompt/);
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

  it("keeps configured-provider checks in the required relative order", () => {
    assert.ok(envReadiness.indexOf('present("MISTRAL_API_KEY")') < envReadiness.indexOf('present("GROQ_API_KEY")'));
    assert.ok(envReadiness.indexOf('present("GROQ_API_KEY")') < envReadiness.indexOf('present("OPENROUTER_API_KEY")'));
    assert.ok(envReadiness.indexOf('present("OPENROUTER_API_KEY")') < envReadiness.indexOf('present("GEMINI_API_KEY")'));
    assert.ok(envReadiness.indexOf('present("GEMINI_API_KEY")') < envReadiness.indexOf('present("OPENAI_API_KEY")'));
    assert.ok(envReadiness.indexOf('present("OPENAI_API_KEY")') < envReadiness.indexOf('present("TOGETHER_API_KEY")'));
    assert.ok(envReadiness.indexOf('present("TOGETHER_API_KEY")') < envReadiness.indexOf('present("DEEPSEEK_API_KEY")'));
    assert.ok(envReadiness.indexOf('present("DEEPSEEK_API_KEY")') < envReadiness.indexOf('present("ANTHROPIC_API_KEY")'));
  });
});
