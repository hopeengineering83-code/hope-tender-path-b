// Mistral AI (3rd-tier) + Together AI (4th-tier) fallback providers.
//
// The actual HTTP calls need live keys, so chain WIRING is asserted at the
// source level and the provider-health plumbing (configured detection, model
// resolution, base URL, diagnostics snapshot, no key leak) is unit-tested.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isMistralConfigured,
  getMistralModel,
  getMistralBaseUrl,
  isTogetherConfigured,
  getTogetherModel,
  getTogetherBaseUrl,
  getProviderRuntimeSnapshot,
  buildProviderDiagnosticsSnapshot,
  recordProviderFailure,
  resetProviderHealth,
} from "../lib/ai-provider-health";

function clearEnv() {
  delete process.env.MISTRAL_API_KEY;
  delete process.env.MISTRAL_PROPOSAL_MODEL;
  delete process.env.TOGETHER_API_KEY;
  delete process.env.TOGETHER_PROPOSAL_MODEL;
}

describe("Mistral provider config", () => {
  beforeEach(() => { clearEnv(); resetProviderHealth(); });

  it("is unconfigured by default, configured via MISTRAL_API_KEY", () => {
    assert.equal(isMistralConfigured(), false);
    process.env.MISTRAL_API_KEY = "msk-test-1234567890";
    assert.equal(isMistralConfigured(), true);
  });

  it("defaults the model and honours MISTRAL_PROPOSAL_MODEL", () => {
    assert.equal(getMistralModel(), "mistral-small-latest");
    process.env.MISTRAL_PROPOSAL_MODEL = "mistral-medium-latest";
    assert.equal(getMistralModel(), "mistral-medium-latest");
  });

  it("returns the canonical Mistral base URL", () => {
    assert.equal(getMistralBaseUrl(), "https://api.mistral.ai/v1");
  });
});

describe("Together AI provider config", () => {
  beforeEach(() => { clearEnv(); resetProviderHealth(); });

  it("is unconfigured by default, configured via TOGETHER_API_KEY", () => {
    assert.equal(isTogetherConfigured(), false);
    process.env.TOGETHER_API_KEY = "together-test-1234567890";
    assert.equal(isTogetherConfigured(), true);
  });

  it("defaults the model and honours TOGETHER_PROPOSAL_MODEL", () => {
    assert.equal(getTogetherModel(), "meta-llama/Llama-3.3-70B-Instruct-Turbo");
    process.env.TOGETHER_PROPOSAL_MODEL = "meta-llama/Llama-3.1-8B-Instruct-Turbo";
    assert.equal(getTogetherModel(), "meta-llama/Llama-3.1-8B-Instruct-Turbo");
  });

  it("returns the canonical Together base URL", () => {
    assert.equal(getTogetherBaseUrl(), "https://api.together.xyz/v1");
  });
});

describe("Mistral provider health tracking", () => {
  beforeEach(() => { clearEnv(); resetProviderHealth(); });

  it("runtime snapshot starts clean for mistral", () => {
    process.env.MISTRAL_API_KEY = "msk-test";
    const snap = getProviderRuntimeSnapshot("mistral");
    assert.equal(snap.available, true);
    assert.equal(snap.coolingDown, false);
    assert.equal(snap.consecutiveFailures, 0);
  });

  it("cooldown is applied after recorded failures", () => {
    process.env.MISTRAL_API_KEY = "msk-test";
    for (let i = 0; i < 3; i++) recordProviderFailure("mistral", "RATE_LIMIT");
    const snap = getProviderRuntimeSnapshot("mistral");
    assert.equal(snap.coolingDown, true);
    assert.equal(snap.available, false);
  });

  it("diagnostics snapshot does not leak the API key", () => {
    process.env.MISTRAL_API_KEY = "msk-super-secret-key";
    const snap = buildProviderDiagnosticsSnapshot();
    const raw = JSON.stringify(snap);
    assert.ok(!raw.includes("msk-super-secret-key"), "Mistral API key must not appear in diagnostics snapshot");
  });
});

describe("Together AI provider health tracking", () => {
  beforeEach(() => { clearEnv(); resetProviderHealth(); });

  it("runtime snapshot starts clean for together", () => {
    process.env.TOGETHER_API_KEY = "tg-test";
    const snap = getProviderRuntimeSnapshot("together");
    assert.equal(snap.available, true);
    assert.equal(snap.coolingDown, false);
    assert.equal(snap.consecutiveFailures, 0);
  });

  it("cooldown is applied after recorded failures", () => {
    process.env.TOGETHER_API_KEY = "tg-test";
    for (let i = 0; i < 3; i++) recordProviderFailure("together", "RATE_LIMIT");
    const snap = getProviderRuntimeSnapshot("together");
    assert.equal(snap.coolingDown, true);
    assert.equal(snap.available, false);
  });

  it("diagnostics snapshot does not leak the Together API key", () => {
    process.env.TOGETHER_API_KEY = "tg-super-secret-key";
    const snap = buildProviderDiagnosticsSnapshot();
    const raw = JSON.stringify(snap);
    assert.ok(!raw.includes("tg-super-secret-key"), "Together API key must not appear in diagnostics snapshot");
  });
});

describe("Mistral/Together chain wiring (source-level)", () => {
  it("mistral and together appear in the default PROVIDER_CHAINS in lib/ai.ts", () => {
    const src = readFileSync("lib/ai.ts", "utf-8");
    // Both providers must appear before anthropic in default chain
    const defaultChain = src.match(/default:\s*\[([^\]]+)\]/)?.[1] ?? "";
    assert.ok(defaultChain.includes("mistral"), "mistral missing from default chain");
    assert.ok(defaultChain.includes("together"), "together missing from default chain");
    const mistralIdx = defaultChain.indexOf('"mistral"');
    const togetherIdx = defaultChain.indexOf('"together"');
    const anthropicIdx = defaultChain.indexOf('"anthropic"');
    assert.ok(mistralIdx < anthropicIdx, "mistral must come before anthropic");
    assert.ok(togetherIdx < anthropicIdx, "together must come before anthropic");
  });

  it("mistral and together appear in all 5 provider chain variants", () => {
    const src = readFileSync("lib/ai.ts", "utf-8");
    const chainBlock = src.match(/PROVIDER_CHAINS[\s\S]*?^}/m)?.[0] ?? src;
    const chainNames = ["default", "extraction", "proposal", "validation", "fast"];
    for (const name of chainNames) {
      const chainLine = chainBlock.match(new RegExp(`${name}:\\s*\\[([^\\]]+)\\]`))?.[1] ?? "";
      assert.ok(chainLine.includes("mistral"), `mistral missing from ${name} chain`);
      assert.ok(chainLine.includes("together"), `together missing from ${name} chain`);
    }
  });

  it("callProvider handles both mistral and together cases", () => {
    const src = readFileSync("lib/ai.ts", "utf-8");
    assert.ok(src.includes(`case "mistral"`), "callProvider missing mistral case");
    assert.ok(src.includes(`case "together"`), "callProvider missing together case");
  });
});
