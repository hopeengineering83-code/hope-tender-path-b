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
  // These two cases assert PROPERTIES of the summary, not its wording. They
  // were written against an earlier rendering that printed category constants
  // (RATE_LIMITED, BILLING, ...) into the owner-facing string. That rendering
  // was deliberately replaced: a constant name tells the person reading the
  // tender page nothing about whether the failure is theirs to fix, and a
  // sibling suite now asserts those constants do NOT reach the page. The
  // properties below are unchanged and still worth pinning — distinct causes
  // stay distinct, and a repeated error event is never counted as a provider.
  it("never turns repeated error events into an impossible provider count", () => {
    const repeated = Array.from(
      { length: 11 },
      () => "Gemini HTTP 429 rate limited and temporarily unavailable",
    ).join(" | ");
    const summary = summarizeAIAnalyzeFailure(repeated);

    assert.doesNotMatch(summary, /11 provider issues/i);
    assert.match(summary, /rate limited/i);
    assert.match(summary, /temporarily unavailable/i);
    assert.match(summary, /unique-provider results/);
    // These segments carry no `provider: message` pairing, so the summary must
    // say the causes are unattributed rather than imply it knows whose they are.
    assert.match(summary, /not attributed to a provider/);
  });

  it("keeps billing, auth, timeout and malformed output as distinct causes", () => {
    const summary = summarizeAIAnalyzeFailure(
      "Cerebras HTTP 402 payment required | Together HTTP 401 invalid API key | Mistral timed out | Gemini malformed empty structured response",
    );
    // Four different causes, four different statements — never collapsed into
    // one "rate-limited or unavailable".
    assert.match(summary, /no credit/i);
    assert.match(summary, /key or configured model rejected/i);
    assert.match(summary, /timed out/i);
    assert.match(summary, /nothing usable/i);
  });
});
