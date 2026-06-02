import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/ai.ts", "utf8");

function chainFor(useCase: string): string[] {
  const match = source.match(new RegExp(`${useCase}:\\s*\\[([^\\]]+)\\]`));
  assert.ok(match, `Missing ${useCase} provider chain`);
  return Array.from(match[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
}

describe("AI provider chain policy", () => {
  it("keeps Claude/Anthropic last and matches the approved default chain", () => {
    assert.deepEqual(chainFor("default"), ["openai", "gemini", "mistral", "deepseek", "groq", "together", "openrouter", "anthropic"]);
  });

  it("matches the approved extraction/analyze chain", () => {
    assert.deepEqual(chainFor("extraction"), ["gemini", "openai", "mistral", "together", "deepseek", "groq", "openrouter", "anthropic"]);
  });

  it("matches the approved proposal and validation chains", () => {
    const expected = ["openai", "gemini", "mistral", "deepseek", "together", "groq", "openrouter", "anthropic"];
    assert.deepEqual(chainFor("proposal"), expected);
    assert.deepEqual(chainFor("validation"), expected);
  });

  it("matches the approved fast/cheap chain", () => {
    assert.deepEqual(chainFor("fast"), ["groq", "together", "deepseek", "mistral", "gemini", "openai", "openrouter", "anthropic"]);
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
