import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isGroqConfigured,
  getGroqModel,
  getGroqBaseUrl,
  isOpenRouterConfigured,
  getOpenRouterModel,
  getOpenRouterBaseUrl,
  getOpenRouterSiteUrl,
  getOpenRouterAppName,
  getProviderRuntimeSnapshot,
  buildProviderDiagnosticsSnapshot,
  recordProviderFailure,
  resetProviderHealth,
} from "../lib/ai-provider-health";

function clearEnv() {
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_PROPOSAL_MODEL;
  delete process.env.GROQ_BASE_URL;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_PROPOSAL_MODEL;
  delete process.env.OPENROUTER_BASE_URL;
  delete process.env.OPENROUTER_SITE_URL;
  delete process.env.OPENROUTER_APP_NAME;
  delete process.env.OPENROUTER_SITE_NAME;
}

describe("Groq provider config", () => {
  beforeEach(() => { clearEnv(); resetProviderHealth(); });

  it("detects configuration and model overrides", () => {
    assert.equal(isGroqConfigured(), false);
    process.env.GROQ_API_KEY = "gsk-test-1234567890";
    assert.equal(isGroqConfigured(), true);
    assert.equal(getGroqModel(), "llama-3.3-70b-versatile");
    process.env.GROQ_PROPOSAL_MODEL = "llama-3.1-8b-instant";
    assert.equal(getGroqModel(), "llama-3.1-8b-instant");
  });
});

describe("OpenRouter provider config", () => {
  beforeEach(() => { clearEnv(); resetProviderHealth(); });

  it("detects configuration and model overrides", () => {
    assert.equal(isOpenRouterConfigured(), false);
    process.env.OPENROUTER_API_KEY = "sk-or-test-1234567890";
    assert.equal(isOpenRouterConfigured(), true);
    assert.equal(getOpenRouterModel(), "openrouter/auto");
    process.env.OPENROUTER_PROPOSAL_MODEL = "openai/gpt-4o-mini";
    assert.equal(getOpenRouterModel(), "openai/gpt-4o-mini");
  });
});

describe("provider health redaction", () => {
  beforeEach(() => { clearEnv(); resetProviderHealth(); });

  it("tracks Groq and OpenRouter without leaking keys", () => {
    process.env.GROQ_API_KEY = "gsk-secret-abcdef123456";
    process.env.OPENROUTER_API_KEY = "sk-or-secret-abcdef123456";
    recordProviderFailure("groq", new Error(`429 boom ${process.env.GROQ_API_KEY}`));
    const snapshot = buildProviderDiagnosticsSnapshot();
    const names = snapshot.perProvider.map((provider) => provider.provider);
    assert.ok(names.includes("groq"));
    assert.ok(names.includes("openrouter"));
    assert.ok(snapshot.providersCoolingDown.includes("groq"));
    assert.ok(!JSON.stringify(snapshot).includes("gsk-secret-abcdef123456"));
    for (const provider of ["groq", "openrouter"] as const) {
      const runtime = getProviderRuntimeSnapshot(provider);
      assert.ok("lastErrorCategory" in runtime);
      assert.ok("coolingDown" in runtime);
    }
  });
});

describe("canonical provider wiring", () => {
  const source = readFileSync("lib/ai.ts", "utf8");

  it("keeps Groq and OpenRouter adapters and central URLs", () => {
    assert.match(source, /function generateWithGroq/);
    assert.match(source, /function generateWithOpenRouter/);
    assert.match(source, /getGroqBaseUrl\(\)/);
    assert.match(source, /getOpenRouterBaseUrl\(\)/);
    assert.match(source, /"HTTP-Referer":\s*getOpenRouterSiteUrl\(\)/);
    assert.match(source, /"X-Title":\s*getOpenRouterAppName\(\)/);
  });

  it("uses Gemini, OpenRouter, OpenAI, Groq, DeepSeek, Claude in that order", () => {
    const match = source.match(/CANONICAL_PROVIDER_CHAIN[^=]*=\s*\[([^\]]+)\]/);
    assert.ok(match);
    const chain = Array.from(match[1].matchAll(/"([^"]+)"/g)).map((item) => item[1]);
    assert.deepEqual(chain, ["gemini", "openrouter", "openai", "groq", "deepseek", "anthropic"]);
  });
});

describe("AI health contract", () => {
  const source = readFileSync("app/api/ai/health/route.ts", "utf8");

  it("publishes canonical ranks and Claude last", () => {
    assert.match(source, /openrouter:\s*\{[\s\S]*?fallbackRank:\s*2/);
    assert.match(source, /groq:\s*\{[\s\S]*?fallbackRank:\s*4/);
    assert.match(source, /claude:\s*\{[\s\S]*?fallbackRank:\s*6/);
    assert.match(source, /Gemini → OpenRouter → OpenAI → Groq → DeepSeek → Claude → deterministic draft fallback/);
  });

  it("selects the preferred provider in canonical order", () => {
    const gemini = source.indexOf('geminiConfigured ? "gemini"');
    const openrouter = source.indexOf('openRouterConfigured ? "openrouter"');
    const openai = source.indexOf('openaiConfigured ? "openai"');
    const groq = source.indexOf('groqConfigured ? "groq"');
    const deepseek = source.indexOf('deepSeekConfigured ? "deepseek"');
    const claude = source.indexOf('claudeConfigured ? "claude"');
    assert.ok(gemini >= 0 && gemini < openrouter && openrouter < openai && openai < groq && groq < deepseek && deepseek < claude);
  });

  it("keeps optional legacy adapters outside the canonical order", () => {
    assert.match(source, /mistral:\s*\{[\s\S]*?fallbackRank:\s*99/);
    assert.match(source, /together:\s*\{[\s\S]*?fallbackRank:\s*99/);
  });
});

describe("centralized provider endpoints", () => {
  beforeEach(() => clearEnv());

  it("normalizes Groq and OpenRouter base URLs and attribution", () => {
    assert.equal(getGroqBaseUrl(), "https://api.groq.com/openai/v1");
    process.env.GROQ_BASE_URL = "https://groq.proxy.internal/openai/v1/";
    assert.equal(getGroqBaseUrl(), "https://groq.proxy.internal/openai/v1");
    assert.equal(getOpenRouterBaseUrl(), "https://openrouter.ai/api/v1");
    assert.equal(getOpenRouterSiteUrl(), "https://hope-tender-path-b.vercel.app");
    assert.equal(getOpenRouterAppName(), "Hope Tender Proposal Generator");
  });
});
