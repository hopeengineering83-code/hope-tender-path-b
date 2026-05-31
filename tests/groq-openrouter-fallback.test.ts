// Groq (5th-tier) + OpenRouter (6th-tier) fallback providers.
//
// The actual HTTP calls need live keys, so the chain WIRING is asserted at the
// source level and the provider-health plumbing (configured detection, model
// resolution, diagnostics snapshot, no key leak) is unit-tested.

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
  it("is unconfigured by default, configured via GROQ_API_KEY", () => {
    assert.equal(isGroqConfigured(), false);
    process.env.GROQ_API_KEY = "gsk-test-1234567890";
    assert.equal(isGroqConfigured(), true);
  });
  it("defaults the model and honours GROQ_PROPOSAL_MODEL", () => {
    assert.equal(getGroqModel(), "llama-3.3-70b-versatile");
    process.env.GROQ_PROPOSAL_MODEL = "llama-3.1-8b-instant";
    assert.equal(getGroqModel(), "llama-3.1-8b-instant");
  });
});

describe("OpenRouter provider config", () => {
  beforeEach(() => { clearEnv(); resetProviderHealth(); });
  it("is unconfigured by default, configured via OPENROUTER_API_KEY", () => {
    assert.equal(isOpenRouterConfigured(), false);
    process.env.OPENROUTER_API_KEY = "sk-or-test-1234567890";
    assert.equal(isOpenRouterConfigured(), true);
  });
  it("defaults the model and honours OPENROUTER_PROPOSAL_MODEL", () => {
    assert.equal(getOpenRouterModel(), "openrouter/auto");
    process.env.OPENROUTER_PROPOSAL_MODEL = "openai/gpt-4o-mini";
    assert.equal(getOpenRouterModel(), "openai/gpt-4o-mini");
  });
});

describe("provider health includes groq + openrouter", () => {
  beforeEach(() => { clearEnv(); resetProviderHealth(); });
  it("runtime snapshots expose the contract fields", () => {
    for (const p of ["groq", "openrouter"] as const) {
      const snap = getProviderRuntimeSnapshot(p);
      assert.ok("lastErrorCategory" in snap);
      assert.ok("coolingDown" in snap);
    }
  });
  it("diagnostics snapshot lists groq + openrouter and never leaks keys", () => {
    process.env.GROQ_API_KEY = "gsk-secret-abcdef123456";
    process.env.OPENROUTER_API_KEY = "sk-or-secret-abcdef123456";
    recordProviderFailure("groq", new Error(`429 boom ${process.env.GROQ_API_KEY}`));
    const snap = buildProviderDiagnosticsSnapshot();
    const names = snap.perProvider.map((p) => p.provider);
    assert.ok(names.includes("groq"));
    assert.ok(names.includes("openrouter"));
    assert.ok(snap.providersAttempted.includes("groq"));
    assert.ok(snap.providersCoolingDown.includes("groq"));
    assert.ok(!JSON.stringify(snap).includes("gsk-secret-abcdef123456"));
  });
});

describe("lib/ai.ts wires Groq → OpenRouter into the chain", () => {
  const source = readFileSync("lib/ai.ts", "utf8");
  it("defines the new providers and the shared tail helper", () => {
    assert.match(source, /function generateWithGroq/);
    assert.match(source, /function generateWithOpenRouter/);
    assert.match(source, /function tryTailFallbackProviders/);
    // Endpoints derive from the centralized base-url getters (default URLs live in ai-provider-health).
    assert.match(source, /getGroqBaseUrl\(\)/);
    assert.match(source, /getOpenRouterBaseUrl\(\)/);
  });
  it("groq and openrouter are included in the provider chain", () => {
    // PROVIDER_CHAINS includes groq and openrouter in every chain variant
    assert.match(source, /PROVIDER_CHAINS/);
    assert.match(source, /"groq"/);
    assert.match(source, /"openrouter"/);
    // tryTailFallbackProviders is still used in section-parallel generation
    assert.match(source, /tryTailFallbackProviders/);
  });
  it("includes the new keys in the no-provider error", () => {
    assert.match(source, /GROQ_API_KEY, or OPENROUTER_API_KEY/);
  });
});

describe("/api/ai/health exposes groq + openrouter and the full chain", () => {
  const source = readFileSync("app/api/ai/health/route.ts", "utf8");
  it("returns groq and openrouter provider objects with fallback ranks", () => {
    assert.match(source, /groq:\s*\{/);
    assert.match(source, /openrouter:\s*\{/);
    // Claude is last (rank 6); openrouter and groq are in the chain
    assert.match(source, /fallbackRank:\s*5/);
    assert.match(source, /fallbackRank:\s*6/);
  });
  it("advertises the extended fallback chain with Claude last", () => {
    // DeepSeek → Groq → OpenRouter appear together before Claude
    assert.match(source, /DeepSeek → Groq → OpenRouter → Claude → deterministic draft fallback/);
  });
});

describe("AI Health panel renders all six provider cards from the contract", () => {
  const source = readFileSync("components/ai-health-panel.tsx", "utf8");
  it("includes Groq + OpenRouter labels, env vars, and fallback ranks", () => {
    assert.match(source, /label: "Groq"/);
    assert.match(source, /label: "OpenRouter"/);
    assert.match(source, /GROQ_API_KEY/);
    assert.match(source, /OPENROUTER_API_KEY/);
    assert.match(source, /rank: 5/);
    assert.match(source, /rank: 6/);
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

describe("lib/ai.ts uses centralized base URLs + temperature", () => {
  const source = readFileSync("lib/ai.ts", "utf8");
  it("Groq + OpenRouter endpoints derive from the base-url getters", () => {
    assert.match(source, /\$\{getGroqBaseUrl\(\)\}\/chat\/completions/);
    assert.match(source, /\$\{getOpenRouterBaseUrl\(\)\}\/chat\/completions/);
  });
  it("OpenRouter attribution headers use the centralized getters", () => {
    assert.match(source, /"HTTP-Referer":\s*getOpenRouterSiteUrl\(\)/);
    assert.match(source, /"X-Title":\s*getOpenRouterAppName\(\)/);
  });
  it("sends a temperature in the request body", () => {
    assert.match(source, /temperature: fallbackTemperature\(\)/);
  });
});

describe("/api/ai/health success + preferredProvider span the whole chain", () => {
  const source = readFileSync("app/api/ai/health/route.ts", "utf8");
  it("success is true when ANY provider is configured", () => {
    assert.match(source, /const anyConfigured =/);
    assert.match(source, /success: anyConfigured/);
  });
  it("preferredProvider priority includes deepseek, groq, openrouter", () => {
    assert.match(source, /deepSeekConfigured \? "deepseek"/);
    assert.match(source, /groqConfigured \? "groq"/);
    assert.match(source, /openRouterConfigured \? "openrouter"/);
  });
  it("only blocks when NO provider is configured", () => {
    assert.match(source, /if \(!anyConfigured\)/);
  });
  it("every provider object carries envPresent + fallbackRank + label + runtime", () => {
    assert.match(source, /envPresent:/);
    assert.match(source, /fallbackRank: 1/);
    assert.match(source, /fallbackRank: 6/);
    assert.match(source, /providerRuntime\.(openai|gemini|deepseek|groq|openrouter|anthropic)/);
  });
});
