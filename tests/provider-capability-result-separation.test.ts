import { afterEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildProviderDiagnosticsSnapshot,
  getProviderRuntimeSnapshot,
  recordProviderCapabilityResult,
  resetProviderHealth,
} from "../lib/ai-provider-health";
import { getProviderModel } from "../lib/ai-provider-registry";
import { summarizeAIAnalyzeFailure } from "../components/ai-analyze-panel";

const savedGeminiKey = process.env.GEMINI_API_KEY;

afterEach(() => {
  resetProviderHealth();
  if (savedGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedGeminiKey;
});

describe("real provider capability results stay separate", () => {
  it("does not let a proposal success erase the latest extraction failure", () => {
    process.env.GEMINI_API_KEY = "test-key-never-sent";
    const extractionModel = getProviderModel("gemini", "extraction");
    const proposalModel = getProviderModel("gemini", "proposal");

    recordProviderCapabilityResult("gemini", "analysis", {
      observedAt: 1_000,
      outcome: "FAILED",
      model: extractionModel,
      category: "MALFORMED_RESPONSE",
      safeMessage: "structured response was empty",
    });
    recordProviderCapabilityResult("gemini", "generation", {
      observedAt: 2_000,
      outcome: "SUCCEEDED",
      model: proposalModel,
      category: null,
      safeMessage: null,
    });

    const runtime = getProviderRuntimeSnapshot("gemini");
    assert.deepEqual(runtime.latestRealExtractionResult, {
      observedAt: 1_000,
      outcome: "FAILED",
      model: extractionModel,
      category: "MALFORMED_RESPONSE",
      safeMessage: "structured response was empty",
    });
    assert.equal(runtime.latestRealProposalResult?.outcome, "SUCCEEDED");
    assert.equal(runtime.latestRealProposalResult?.model, proposalModel);
  });

  it("publishes exact extraction/proposal models and both real results in diagnostics", () => {
    process.env.GEMINI_API_KEY = "test-key-never-sent";
    recordProviderCapabilityResult("gemini", "analysis", {
      outcome: "SUCCEEDED",
      model: getProviderModel("gemini", "extraction"),
      category: null,
      safeMessage: null,
    });

    const row = buildProviderDiagnosticsSnapshot().perProvider.find(
      (provider) => provider.provider === "gemini",
    );
    assert.ok(row);
    assert.equal(row.extractionModel, getProviderModel("gemini", "extraction"));
    assert.equal(row.proposalModel, getProviderModel("gemini", "proposal"));
    assert.equal(row.latestRealExtractionResult?.outcome, "SUCCEEDED");
    assert.equal(row.latestRealProposalResult, null);
  });

  it("redacts secrets before storing a capability-specific failure", () => {
    const secret = "gsk_abcdefghijklmnopqrstuvwxyz0123456789";
    recordProviderCapabilityResult("groq", "analysis", {
      outcome: "FAILED",
      model: "configured-model",
      category: "AUTH",
      safeMessage: `provider rejected ${secret}`,
    });

    const result = getProviderRuntimeSnapshot("groq").latestRealExtractionResult;
    assert.ok(result);
    assert.doesNotMatch(result.safeMessage ?? "", /gsk_/);
    assert.match(result.safeMessage ?? "", /REDACTED/);
  });
});

describe("provider failure summary counts only what it can prove", () => {
  it("never turns repeated error events into an impossible provider count", () => {
    const repeated = Array.from(
      { length: 11 },
      () => "Gemini HTTP 429 rate limited and temporarily unavailable",
    ).join(" | ");
    const summary = summarizeAIAnalyzeFailure(repeated);

    assert.doesNotMatch(summary, /11 provider issues/i);
    assert.match(summary, /RATE_LIMITED/);
    assert.match(summary, /TEMPORARILY_UNAVAILABLE/);
    assert.match(summary, /unique-provider results/);
  });

  it("keeps billing, auth, timeout and malformed output as distinct categories", () => {
    const summary = summarizeAIAnalyzeFailure(
      "Cerebras HTTP 402 payment required | Together HTTP 401 invalid API key | Mistral timed out | Gemini malformed empty structured response",
    );
    assert.match(summary, /BILLING/);
    assert.match(summary, /AUTH_OR_CONFIGURATION_INVALID/);
    assert.match(summary, /TIMEOUT/);
    assert.match(summary, /MALFORMED_RESPONSE/);
  });
});
