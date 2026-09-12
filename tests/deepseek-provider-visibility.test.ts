// DeepSeek end-to-end visibility (PR: AI fallback recovery + DeepSeek UI).
//
// Covers:
//   - central DeepSeek key resolution (official var + aliases)
//   - "official env present" vs "configured via alias"
//   - route/UI-friendly runtime snapshot field names
//   - provider diagnostics snapshot includes deepseek and never leaks keys
//   - /api/ai/health route always exposes a deepseek provider object with the
//     required fields, and advertises the full fallback chain (source-level
//     contract assertion — the handler itself requires an auth session)

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  getDeepSeekApiKey,
  isDeepSeekConfigured,
  deepSeekOfficialEnvPresent,
  getDeepSeekModel,
  getProviderRuntimeSnapshot,
  buildProviderDiagnosticsSnapshot,
  recordProviderFailure,
  recordProviderSuccess,
  resetProviderHealth,
} from "../lib/ai-provider-health";

const SECRET = "sk-deepseek-supersecret-key-0123456789";

function clearDeepSeekEnv() {
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEP_SEEK_API_KEY;
  delete process.env.DEEPSEEK_KEY;
  delete process.env.DEEPSEEK_PROPOSAL_MODEL;
}

describe("DeepSeek central key resolution", () => {
  beforeEach(() => { clearDeepSeekEnv(); resetProviderHealth(); });

  it("is not configured when no env var is set", () => {
    assert.equal(isDeepSeekConfigured(), false);
    assert.equal(getDeepSeekApiKey(), undefined);
    assert.equal(deepSeekOfficialEnvPresent(), false);
  });

  it("is configured via the official DEEPSEEK_API_KEY", () => {
    process.env.DEEPSEEK_API_KEY = SECRET;
    assert.equal(isDeepSeekConfigured(), true);
    assert.equal(getDeepSeekApiKey(), SECRET);
    assert.equal(deepSeekOfficialEnvPresent(), true);
  });

  it("is configured via the DEEP_SEEK_API_KEY alias but not 'official present'", () => {
    process.env.DEEP_SEEK_API_KEY = SECRET;
    assert.equal(isDeepSeekConfigured(), true);
    assert.equal(getDeepSeekApiKey(), SECRET);
    assert.equal(deepSeekOfficialEnvPresent(), false);
  });

  it("is configured via the DEEPSEEK_KEY alias", () => {
    process.env.DEEPSEEK_KEY = SECRET;
    assert.equal(isDeepSeekConfigured(), true);
    assert.equal(deepSeekOfficialEnvPresent(), false);
  });

  it("prefers the official var over aliases", () => {
    process.env.DEEPSEEK_API_KEY = "sk-official";
    process.env.DEEP_SEEK_API_KEY = "sk-alias";
    assert.equal(getDeepSeekApiKey(), "sk-official");
  });

  it("defaults the model to deepseek-chat and honours DEEPSEEK_PROPOSAL_MODEL", () => {
    assert.equal(getDeepSeekModel(), "deepseek-chat");
    process.env.DEEPSEEK_PROPOSAL_MODEL = "deepseek-reasoner";
    assert.equal(getDeepSeekModel(), "deepseek-reasoner");
  });
});

describe("DeepSeek runtime snapshot", () => {
  beforeEach(() => { clearDeepSeekEnv(); resetProviderHealth(); });

  it("exposes the API-contract field names", () => {
    const snap = getProviderRuntimeSnapshot("deepseek");
    assert.deepEqual(Object.keys(snap).sort(), [
      "consecutiveFailures",
      "coolingDown",
      "cooldownUntil",
      "available",
      "lastErrorCategory",
      "lastFailureAt",
      "lastFailureReason",
      "lastSafeErrorMessage",
      "lastSuccessAt",
      // Latest real workload outcomes are capability-specific. A proposal
      // failure must not erase the latest extraction result (or vice versa).
      "latestRealExtractionResult",
      "latestRealProposalResult",
      "rateLimited",
      "runtimeVerified",
      // Whether the provider will answer only with a bill — either it said so,
      // or zero-paid mode excludes it. Distinct from `available`, which is now
      // false as a consequence.
      "billingBlocked",
      // Whether a real ANALYSIS call succeeded. `runtimeVerified` is true for a
      // bare connectivity ping too, and a ping does not prove the provider can
      // return the structured output AI Analyze needs.
      "analysisUsable",
      // Unified operator-facing status enum (see AiProviderStatus in
      // lib/ai-provider-health.ts). The dashboard uses this field, NOT the
      // legacy `available` boolean, to decide whether to show a green pill.
      "status",
    ].sort());
  });

  it("reflects a recorded failure and never leaks the key", () => {
    recordProviderFailure("deepseek", new Error(`Invalid API key ${SECRET} (401)`));
    const snap = getProviderRuntimeSnapshot("deepseek");
    assert.equal(snap.lastErrorCategory, "AUTH");
    assert.equal(snap.coolingDown, true);
    assert.ok(!(snap.lastSafeErrorMessage ?? "").includes(SECRET));
    assert.match(snap.lastSafeErrorMessage ?? "", /REDACTED/);
  });

  it("clears after a recorded success", () => {
    recordProviderFailure("deepseek", new Error("429 rate limit"));
    recordProviderSuccess("deepseek");
    const snap = getProviderRuntimeSnapshot("deepseek");
    assert.equal(snap.coolingDown, false);
    assert.equal(snap.consecutiveFailures, 0);
  });
});

describe("provider diagnostics snapshot", () => {
  beforeEach(() => { clearDeepSeekEnv(); resetProviderHealth(); });

  it("includes deepseek in perProvider and reports configured state", () => {
    process.env.DEEPSEEK_API_KEY = SECRET;
    const snap = buildProviderDiagnosticsSnapshot();
    const deepseek = snap.perProvider.find((p) => p.provider === "deepseek");
    assert.ok(deepseek, "deepseek must be present in perProvider");
    assert.equal(deepseek?.configured, true);
    assert.ok(snap.providersAttempted.includes("deepseek"));
  });

  it("lists cooling-down providers and leaks no secret material", () => {
    process.env.DEEPSEEK_API_KEY = SECRET;
    recordProviderFailure("deepseek", new Error(`boom ${SECRET}`));
    const snap = buildProviderDiagnosticsSnapshot();
    assert.ok(snap.providersCoolingDown.includes("deepseek"));
    assert.ok(!JSON.stringify(snap).includes(SECRET));
  });
});

describe("/api/ai/health route contract", () => {
  it("exposes every registry provider (including deepseek) with rank + model", () => {
    const source = readFileSync("app/api/ai/health/route.ts", "utf8");
    // The route builds provider objects from the registry, so deepseek is
    // included automatically with its registry rank (9) and model.
    assert.match(source, /getCanonicalProviderEntries/);
    assert.match(source, /fallbackRank:\s*entry\.rank/);
    assert.match(source, /model:\s*getProviderModel/);
    assert.match(source, /fallbackChain:/);
    assert.match(source, /CANONICAL_AI_FALLBACK_CHAIN_DISPLAY/);
    // deepseek is rank 9 in the canonical registry order.
    const { getProviderEntry } = require("../lib/ai-provider-registry");
    assert.equal(getProviderEntry("deepseek").rank, 9);
  });

  it("AIHealthPanel renders all registry cards (including DeepSeek) with messaging", () => {
    const source = readFileSync("components/ai-health-panel.tsx", "utf8");
    assert.match(source, /getCanonicalProviderEntries/);
    assert.match(source, /set \{p\.envVar\} in Vercel Production environment/);
    assert.match(source, /Check \{p\.label\} model access or retry after cooldown/);
    assert.match(source, /lg:grid-cols-/);
  });
});
