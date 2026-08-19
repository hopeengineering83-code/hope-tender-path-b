// Live AI provider diagnostics — the "why is AI Analyze failing?" self-test.
//
// Verifies:
//   1. selfTestProvider returns "not configured" WITHOUT an outbound call when
//      the provider has no key (so the diagnostic is safe and instant).
//   2. selfTestAllProviders returns one entry per canonical provider, in order.
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

describe("provider self-test (live diagnostic)", () => {
  it("reports an unconfigured provider WITHOUT making an outbound call", async () => {
    await withNoProviderKeys(async () => {
      const { selfTestProvider } = await import("../lib/ai");
      const res = await selfTestProvider("zai", 1);
      assert.equal(res.configured, false);
      assert.equal(res.ok, false);
      assert.equal(res.latencyMs, null); // null latency proves no call was made
      assert.match(res.reason ?? "", /not configured/i);
    });
  });

  it("selfTestAllProviders returns one entry per canonical provider, in order", async () => {
    await withNoProviderKeys(async () => {
      const { selfTestAllProviders } = await import("../lib/ai");
      const results = await selfTestAllProviders();
      assert.equal(results.length, CANONICAL_AI_PROVIDER_ORDER.length);
      assert.deepEqual(results.map((r) => r.provider), [...CANONICAL_AI_PROVIDER_ORDER]);
      assert.deepEqual(results.map((r) => r.rank), CANONICAL_AI_PROVIDER_ORDER.map((_, i) => i + 1));
      // With no keys, every provider is unconfigured and none "ok".
      assert.ok(results.every((r) => r.configured === false && r.ok === false));
    });
  });
});

describe("diagnostics endpoint", () => {
  const route = readFileSync("app/api/ai-providers/diagnostics/route.ts", "utf8");

  it("requires ADMIN/PROPOSAL_MANAGER", () => {
    assert.match(route, /requireRole\("ADMIN", "PROPOSAL_MANAGER"\)/);
  });

  it("supports the live self-test via ?live=1 and the health snapshot otherwise", () => {
    assert.match(route, /searchParams\.get\("live"\) === "1"/);
    assert.match(route, /selfTestAllProviders\(\)/);
    assert.match(route, /buildProviderDiagnosticsSnapshot\(\)/);
  });

  it("never returns API key values (no process.env key reads in the response)", () => {
    assert.doesNotMatch(route, /process\.env\.[A-Z_]*API_KEY/);
  });

  it("tells the operator what to do when nothing is configured", () => {
    assert.match(route, /Set at least one provider API key/i);
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
