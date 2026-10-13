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

  it("fails closed without an explicitly configured proven-free model", () => {
    assert.equal(isGroqConfigured(), false);
    process.env.GROQ_API_KEY = "gsk-test-1234567890";
    assert.equal(isGroqConfigured(), false);
    assert.equal(getGroqModel(), "");
    process.env.GROQ_PROPOSAL_MODEL = "llama-3.1-8b-instant";
    assert.equal(getGroqModel(), "llama-3.1-8b-instant");
  });
});

describe("OpenRouter provider config", () => {
  beforeEach(() => { clearEnv(); resetProviderHealth(); });

  it("requires a configured model and preserves its exact identifier", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test-1234567890";
    assert.equal(isOpenRouterConfigured(), false);
    assert.equal(getOpenRouterModel(), null);

    // Configured identifiers are used exactly, without policy rewriting.
    process.env.OPENROUTER_PROPOSAL_MODEL = "openrouter/auto";
    assert.equal(isOpenRouterConfigured(), true);
    assert.equal(getOpenRouterModel(), "openrouter/auto");

    // A model does not need a custom suffix.
    process.env.OPENROUTER_PROPOSAL_MODEL = "openai/gpt-4o-mini";
    assert.equal(isOpenRouterConfigured(), true);
    assert.equal(getOpenRouterModel(), "openai/gpt-4o-mini");

    // A :free identifier is also preserved when explicitly configured.
    process.env.OPENROUTER_PROPOSAL_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
    assert.equal(isOpenRouterConfigured(), true);
    assert.equal(getOpenRouterModel(), "meta-llama/llama-3.3-70b-instruct:free");
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

  it("groq and openrouter are part of the registry-derived chain", () => {
    // The chain is derived from CANONICAL_AI_PROVIDER_ORDER (no PROVIDER_CHAINS
    // literal map). The dedicated tail fallback helper remains.
    assert.match(source, /CANONICAL_AI_PROVIDER_ORDER/);
    assert.match(source, /tryTailFallbackProviders/);
  });

  it("includes provider keys in the no-provider error", () => {
    assert.match(source, /GROQ_API_KEY/);
    assert.match(source, /OPENROUTER_API_KEY/);
    assert.match(source, /ANTHROPIC_API_KEY/);
  });

  it("OpenRouter attribution headers use the centralized getters", () => {
    assert.match(source, /"HTTP-Referer":\s*getOpenRouterSiteUrl\(\)/);
    assert.match(source, /"X-Title":\s*getOpenRouterAppName\(\)/);
  });
});

describe("/api/ai/health exposes the full registry-derived chain", () => {
  const source = readFileSync("app/api/ai/health/route.ts", "utf8");

  it("builds provider objects from the canonical registry entries", () => {
    assert.match(source, /getCanonicalProviderEntries/);
    assert.match(source, /fallbackRank:\s*entry\.rank/);
  });

  it("advertises the registry-generated fallback chain string", () => {
    assert.match(source, /CANONICAL_AI_FALLBACK_CHAIN_DISPLAY/);
  });
});

describe("AI Health panel renders all provider cards from the registry", () => {
  const source = readFileSync("components/ai-health-panel.tsx", "utf8");

  it("builds the cards from the canonical registry entries", () => {
    assert.match(source, /getCanonicalProviderEntries/);
    assert.match(source, /label:\s*entry\.displayName/);
    assert.match(source, /envVar:\s*entry\.env\.apiKey/);
  });

  it("renders cards by mapping the provider contract (rank + cooldown shown)", () => {
    assert.match(source, /health\.providers\.map/);
    assert.match(source, /Fallback rank \{p\.rank\}/);
    assert.match(source, /Rate-limited|coolingDown/);
  });

  it("surfaces the OpenRouter free-model requirement", () => {
    assert.match(source, /openRouterModelValidity/);
  });
});

describe("AI health contract", () => {
  const source = readFileSync("app/api/ai/health/route.ts", "utf8");

  it("publishes registry-derived ranks and the preferred provider", () => {
    assert.match(source, /getCanonicalProviderEntries/);
    assert.match(source, /preferredConfiguredProviderName/);
    assert.match(source, /CANONICAL_AI_FALLBACK_CHAIN_DISPLAY/);
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
