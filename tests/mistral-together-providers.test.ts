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

describe("optional provider adapters", () => {
  beforeEach(() => { clearEnv(); resetProviderHealth(); });

  it("keeps Mistral configuration helpers available", () => {
    assert.equal(isMistralConfigured(), false);
    process.env.MISTRAL_API_KEY = "test-value";
    assert.equal(isMistralConfigured(), true);
    assert.equal(getMistralModel(), "mistral-small-latest");
    assert.equal(getMistralBaseUrl(), "https://api.mistral.ai/v1");
  });

  it("keeps Together configuration helpers available", () => {
    assert.equal(isTogetherConfigured(), false);
    process.env.TOGETHER_API_KEY = "test-value";
    assert.equal(isTogetherConfigured(), true);
    assert.equal(getTogetherModel(), "meta-llama/Llama-3.3-70B-Instruct-Turbo");
    assert.equal(getTogetherBaseUrl(), "https://api.together.xyz/v1");
  });

  it("redacts provider configuration values from diagnostics", () => {
    process.env.MISTRAL_API_KEY = "diagnostic-test-value";
    process.env.TOGETHER_API_KEY = "diagnostic-test-value-2";
    recordProviderFailure("mistral", "RATE_LIMIT");
    recordProviderFailure("together", "RATE_LIMIT");
    assert.ok(!JSON.stringify(buildProviderDiagnosticsSnapshot()).includes("diagnostic-test-value"));
    assert.ok("coolingDown" in getProviderRuntimeSnapshot("mistral"));
    assert.ok("coolingDown" in getProviderRuntimeSnapshot("together"));
  });
});

describe("canonical provider chain", () => {
  const source = readFileSync("lib/ai.ts", "utf8");

  it("uses the required ten providers with Z.ai first and Anthropic last", () => {
    const match = source.match(/CANONICAL_PROVIDER_CHAIN[^=]*=\s*\[([^\]]+)\]/);
    assert.ok(match);
    const chain = Array.from(match[1].matchAll(/"([^"]+)"/g)).map((item) => item[1]);
    assert.deepEqual(chain, ["zai", "cerebras", "mistral", "groq", "openrouter", "gemini", "openai", "together", "deepseek", "anthropic"]);
    assert.equal(chain[0], "zai", "Z.ai must be first in the canonical chain");
    assert.equal(chain[chain.length - 1], "anthropic", "Claude/Anthropic must be last in the canonical chain");
    assert.ok(chain.includes("together"), "Together must be in the canonical chain");
  });

  it("retains explicit adapter cases without automatic fallback placement", () => {
    assert.ok(source.includes('case "mistral"'));
    assert.ok(source.includes('case "together"'));
  });
});
