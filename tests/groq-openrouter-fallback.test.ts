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
  });

  it("groq and openrouter are included in the provider chain", () => {
    assert.match(source, /PROVIDER_CHAINS/);
    assert.match(source, /"groq"/);
    assert.match(source, /"openrouter"/);
    assert.match(source, /tryTailFallbackProviders/);
  });

  it("includes the new keys in the no-provider error", () => {
    assert.match(source, /GROQ_API_KEY, TOGETHER_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY/);
  });

  it("OpenRouter attribution headers use the centralized getters", () => {
    assert.match(source, /"HTTP-Referer":\s*getOpenRouterSiteUrl\(\)/);
    assert.match(source, /"X-Title":\s*getOpenRouterAppName\(\)/);
  });

  it("uses Mistral, Groq, OpenRouter, Gemini, OpenAI, Together, DeepSeek, Claude in that order", () => {
    const match = source.match(/CANONICAL_PROVIDER_CHAIN[^=]*=\s*\[([^\]]+)\]/);
    assert.ok(match);
    const chain = Array.from(match[1].matchAll(/"([^"]+)"/g)).map((item) => item[1]);
    assert.deepEqual(chain, ["mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"]);
  });
});

describe("/api/ai/health exposes groq + openrouter and the full chain", () => {
  const source = readFileSync("app/api/ai/health/route.ts", "utf8");

  it("returns groq and openrouter provider objects with fallback ranks", () => {
    assert.match(source, /groq:\s*\{/);
    assert.match(source, /openrouter:\s*\{/);
    assert.match(source, /fallbackRank:\s*6/);
    assert.match(source, /fallbackRank:\s*7/);
    assert.match(source, /fallbackRank:\s*8/);
  });

  it("advertises the extended fallback chain with Claude last", () => {
    assert.match(source, /Together → DeepSeek → Claude → deterministic draft fallback/);
  });
});

describe("AI Health panel renders all eight provider cards from the contract", () => {
  const source = readFileSync("components/ai-health-panel.tsx", "utf8");

  it("includes Groq + OpenRouter labels, env vars, and fallback ranks", () => {
    assert.match(source, /label: "Groq"/);
    assert.match(source, /label: "OpenRouter"/);
    assert.match(source, /GROQ_API_KEY/);
    assert.match(source, /OPENROUTER_API_KEY/);
    assert.match(source, /rank: 6/);
    assert.match(source, /rank: 7/);
  });

  it("renders cards by mapping the provider contract (rank + cooldown shown)", () => {
    assert.match(source, /health\.providers\.map/);
    assert.match(source, /Fallback rank \{p\.rank\}/);
    assert.match(source, /Rate-limited|coolingDown/);
  });

  it("nudges pinning a model when OpenRouter uses the auto default", () => {
    assert.match(source, /Set OPENROUTER_PROPOSAL_MODEL/);
  });
});

describe("AI health contract", () => {
  const source = readFileSync("app/api/ai/health/route.ts", "utf8");

  it("publishes canonical ranks with Mistral first and Claude last", () => {
    assert.match(source, /mistral:\s*\{[\s\S]*?fallbackRank:\s*1/);
    assert.match(source, /groq:\s*\{[\s\S]*?fallbackRank:\s*2/);
    assert.match(source, /openrouter:\s*\{[\s\S]*?fallbackRank:\s*3/);
    assert.match(source, /claude:\s*\{[\s\S]*?fallbackRank:\s*8/);
    assert.match(source, /Mistral → Groq → OpenRouter → Gemini → OpenAI → Together → DeepSeek → Claude → deterministic draft fallback/);
  });

  it("selects the preferred provider in canonical order", () => {
    const mistral = source.indexOf('mistralConfigured ? "mistral"');
    const groq = source.indexOf('groqConfigured ? "groq"');
    const openrouter = source.indexOf('openRouterConfigured ? "openrouter"');
    const gemini = source.indexOf('geminiConfigured ? "gemini"');
    const deepseek = source.indexOf('deepSeekConfigured ? "deepseek"');
    const claude = source.indexOf('claudeConfigured ? "claude"');
    assert.ok(mistral >= 0 && mistral < groq && groq < openrouter && openrouter < gemini && gemini < deepseek && deepseek < claude);
  });

  it("includes Mistral and Together at canonical positions", () => {
    assert.match(source, /mistral:\s*\{[\s\S]*?fallbackRank:\s*1/);
    assert.match(source, /together:\s*\{[\s\S]*?fallbackRank:\s*6/);
  });
});

describe("base-url + attribution config (centralized)", () => {
  beforeEach(() => { clearEnv(); });

  it("Groq base URL default + override (trailing slash trimmed)", () => {
    assert.equal(getGroqBaseUrl(), "https://api.groq.com/openai/v1");
    process.env.GROQ_BASE_URL = "https://groq.proxy.internal/openai/v1/";
    assert.equal(getGroqBaseUrl(), "https://groq.proxy.internal/openai/v1");
  });

  it("OpenRouter base URL default + override", () => {
    assert.equal(getOpenRouterBaseUrl(), "https://openrouter.ai/api/v1");
    process.env.OPENROUTER_BASE_URL = "https://or.proxy.internal/api/v1";
    assert.equal(getOpenRouterBaseUrl(), "https://or.proxy.internal/api/v1");
  });

  it("OpenRouter site URL default", () => {
    assert.equal(getOpenRouterSiteUrl(), "https://hope-tender-path-b.vercel.app");
  });

  it("OpenRouter app name: APP_NAME wins, SITE_NAME alias, default", () => {
    assert.equal(getOpenRouterAppName(), "Hope Tender Proposal Generator");
    process.env.OPENROUTER_SITE_NAME = "Legacy Alias Name";
    assert.equal(getOpenRouterAppName(), "Legacy Alias Name");
    process.env.OPENROUTER_APP_NAME = "Official App Name";
    assert.equal(getOpenRouterAppName(), "Official App Name");
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

describe("lib/ai.ts uses centralized base URLs + temperature", () => {
  const source = readFileSync("lib/ai.ts", "utf8");

  it("Groq + OpenRouter endpoints derive from the base-url getters", () => {
    assert.match(source, /\$\{getGroqBaseUrl\(\)\}\/chat\/completions/);
    assert.match(source, /\$\{getOpenRouterBaseUrl\(\)\}\/chat\/completions/);
  });
});
