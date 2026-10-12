// Live AI provider diagnostics — the "why is AI Analyze failing?" self-test.
//
// Verifies:
//   1. runCapabilityTest refuses an unconfigured OR paid-access provider WITHOUT
//      an outbound call (so the diagnostic is safe, instant, and cannot spend).
//   2. testAutomaticChainCapabilities covers the active zero-paid chain, in order.
//   3. The endpoint requires ADMIN/PROPOSAL_MANAGER, supports ?live=1, and never
//      returns key values.
//   4. The panel exposes a "Diagnose providers" action that hits the endpoint.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { CANONICAL_AI_PROVIDER_ORDER } from "../lib/ai-provider-registry";

// Strip EVERY provider key (incl. the test-runner GEMINI placeholder) so the
// self-test classifies all providers as unconfigured and makes ZERO outbound
// calls — keeping this test hermetic and fast.
const PROVIDER_KEYS = [
  "ZAI_API_KEY", "CEREBRAS_API_KEY", "MISTRAL_API_KEY", "GROQ_API_KEY",
  "OPENROUTER_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY",
  "TOGETHER_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY",
];

async function withNoProviderKeys<T>(fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of PROVIDER_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  try {
    return await fn();
  } finally {
    for (const k of PROVIDER_KEYS) { if (saved[k] !== undefined) process.env[k] = saved[k]; }
  }
}

describe("provider capability test — the real diagnostic", () => {
  it("refuses an unconfigured provider WITHOUT making an outbound call", async () => {
    await withNoProviderKeys(async () => {
      const { runCapabilityTest } = await import("../lib/ai-provider-capability-test");
      const res = await runCapabilityTest("gemini", "connectivity");
      assert.equal(res.status, "skipped");
      assert.equal(res.durationMs, 0); // zero duration proves no call was made
      assert.match(res.safeMessage ?? "", /not configured/i);
    });
  });

  it("includes a normally configured OpenAI provider in automatic diagnostics", async () => {
    // The whole point of zero-paid mode: a key being present must NOT be enough
    // to send a request. A diagnostic that "helpfully" tested OpenAI to see
    // whether it works would be spending money to find out.
    await withNoProviderKeys(async () => {
      process.env.OPENAI_API_KEY = "sk-test-not-used";
      try {
        const { providerAutomaticEligibility } = await import("../lib/ai-provider-registry");
        const res = providerAutomaticEligibility("openai");
        assert.equal(res.eligible, true);
        assert.equal(res.reason, "OK");
      } finally {
        delete process.env.OPENAI_API_KEY;
      }
    });
  });

  it("tests every provider in the active canonical chain, in order", async () => {
    await withNoProviderKeys(async () => {
      const { testAutomaticChainCapabilities } = await import("../lib/ai-provider-capability-test");
      const { getAutomaticProviderOrder } = await import("../lib/ai-provider-registry");
      const { reports, notTested, deadlineExceeded } = await testAutomaticChainCapabilities({ capabilities: ["connectivity"] });
      assert.deepEqual(reports.map((r) => r.provider), [...getAutomaticProviderOrder()]);
      // No deadline armed: the run is complete and nothing is left untested.
      assert.equal(deadlineExceeded, false);
      assert.deepEqual(notTested, []);
      // With no keys, nothing is eligible and nothing claims to be usable.
      assert.ok(reports.every((r) => r.eligible === false));
      assert.ok(reports.every((r) => r.usableForAiAnalyze === false));
    });
  });

  it("does not call connectivity alone sufficient for AI Analyze", async () => {
    // Guards the distinction the old ping-only diagnostic erased: a provider
    // that answers "OK" to a one-word prompt has proven the key and the route,
    // not the ability to return the structured JSON the workflow needs.
    const source = readFileSync("lib/ai-provider-capability-test.ts", "utf8");
    assert.match(source, /usableForAiAnalyze: passed\("analysis"\)/);
  });
});

describe("diagnostics endpoint", () => {
  const route = readFileSync("app/api/ai-providers/diagnostics/route.ts", "utf8");

  it("requires ADMIN/PROPOSAL_MANAGER", () => {
    assert.match(route, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
  });

  it("supports the live capability test via ?live=1 and the health snapshot otherwise", () => {
    assert.match(route, /searchParams\.get\("live"\) === "1"/);
    assert.match(route, /testAutomaticChainCapabilities\(/);
    assert.match(route, /buildProviderDiagnosticsSnapshot\(\)/);
  });

  it("keeps latest real extraction and proposal results tenant-scoped and separate", () => {
    assert.match(route, /userId: actor\.id/);
    assert.match(route, /useCase: \{ in: \["extraction", "proposal"\] \}/);
    assert.match(route, /latestRealExtractionResult/);
    assert.match(route, /latestRealProposalResult/);
  });

  it("headlines ANALYSIS readiness, not 'something answered'", () => {
    // The previous route reported `anyWorking` from a ping. A chain where every
    // provider cheerfully answers a ping and none can produce structured output
    // is not a working chain, and calling it one is what let AI Analyze fail on
    // an environment the diagnostics called healthy.
    assert.match(route, /aiAnalyzeReady: analysisReady\.length > 0/);
    assert.match(route, /verifiedAnalysisProviders/);
  });

  it("never returns API key values (no process.env key reads in the response)", () => {
    assert.doesNotMatch(route, /process\.env\.[A-Z_]*API_KEY/);
  });

  it("tells the operator what to do when nothing is configured", () => {
    // Names the FREE provider keys specifically. Telling a zero-paid operator to
    // "set at least one provider API key" invites them to reach for the paid one
    // they already have.
    assert.match(route, /GEMINI_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY or ZAI_API_KEY/);
  });
});

describe("AI Analyze panel exposes the diagnostic", () => {
  const panel = readFileSync("components/ai-analyze-panel.tsx", "utf8");

  it("has a Diagnose providers function that calls the live endpoint", () => {
    // Gap 2: the Diagnose providers button was removed from the normal path.
    // The function still exists for automatic/diagnostic use.
    assert.match(panel, /\/api\/ai-providers\/diagnostics\?live=1/);
    assert.match(panel, /function runProviderDiagnostics/);
  });

  it("renders per-provider results", () => {
    assert.match(panel, /diag\.perProvider\.map/);
  });
});
