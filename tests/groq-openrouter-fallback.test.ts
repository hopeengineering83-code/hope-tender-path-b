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
  isOpenRouterConfigured,
  getOpenRouterModel,
  getProviderRuntimeSnapshot,
  buildProviderDiagnosticsSnapshot,
  recordProviderFailure,
  resetProviderHealth,
} from "../lib/ai-provider-health";

function clearEnv() {
  delete process.env.GROQ_API_KEY;
  delete process.env.GROQ_PROPOSAL_MODEL;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_PROPOSAL_MODEL;
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
    assert.match(source, /api\.groq\.com\/openai\/v1\/chat\/completions/);
    assert.match(source, /openrouter\.ai\/api\/v1\/chat\/completions/);
  });
  it("calls the tail helper in generateWithFallback (both branches)", () => {
    assert.match(source, /tail1/);
    assert.match(source, /tail2/);
    assert.match(source, /tail3/);
  });
  it("includes the new keys in the no-provider error", () => {
    assert.match(source, /GROQ_API_KEY, or OPENROUTER_API_KEY/);
  });
});

describe("/api/ai/health exposes groq + openrouter and the full chain", () => {
  const source = readFileSync("app/api/ai/health/route.ts", "utf8");
  it("returns groq (rank 5) and openrouter (rank 6) provider objects", () => {
    assert.match(source, /groq:\s*\{/);
    assert.match(source, /openrouter:\s*\{/);
    assert.match(source, /fallbackRank:\s*5/);
    assert.match(source, /fallbackRank:\s*6/);
  });
  it("advertises the extended fallback chain", () => {
    assert.match(source, /DeepSeek → Groq → OpenRouter → deterministic draft fallback/);
  });
});

describe("AI Health panel renders Groq + OpenRouter cards", () => {
  const source = readFileSync("components/ai-health-panel.tsx", "utf8");
  it("renders both cards with configure messaging", () => {
    assert.match(source, /name="Groq"/);
    assert.match(source, /name="OpenRouter"/);
    assert.match(source, /GROQ_API_KEY/);
    assert.match(source, /OPENROUTER_API_KEY/);
  });
});
