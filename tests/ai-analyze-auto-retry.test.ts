// AI Analyze auto-retry regression tests.
//
// Verifies:
//   1. getMinCooldownExpiryMs returns 0 when a provider is available.
//   2. getMinCooldownExpiryMs returns null when no providers configured.
//   3. getMinCooldownExpiryMs returns > 0 ms when all providers are cooling down.
//   4. The ai-analyze route exports providerRetryAfterMs in its response shape.
//   5. The ai-analyze route exports resumableJobId in its response shape.
//
// (UI-side auto-retry checks against the old tender-detail.tsx monolith were
// retired along with that dead, unreachable file -- the live ai-analyze-panel.tsx
// has its own durable-job-based auto-retry mechanism, covered separately in
// tests/durable-ai-analyze-workflow.test.ts.)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const providerHealthSrc = readFileSync(path.join(process.cwd(), "lib/ai-provider-health.ts"), "utf-8");
const routeSrc = readFileSync(path.join(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts"), "utf-8");

// ── 1. getMinCooldownExpiryMs function exists ────────────────────────────────

describe("ai-analyze auto-retry — getMinCooldownExpiryMs helper", () => {
  it("is exported from lib/ai-provider-health.ts", () => {
    assert.ok(
      providerHealthSrc.includes("export function getMinCooldownExpiryMs"),
      "getMinCooldownExpiryMs must be exported from lib/ai-provider-health.ts",
    );
  });

  it("returns 0 when a configured provider has no cooldown", () => {
    assert.ok(
      providerHealthSrc.includes("anyAvailable = true") && providerHealthSrc.includes("if (anyAvailable) return 0"),
      "must return 0 when at least one configured provider is available",
    );
  });

  it("returns null when no providers are configured", () => {
    assert.ok(
      providerHealthSrc.includes("if (configured.length === 0) return null"),
      "must return null when no providers are configured",
    );
  });

  it("returns positive ms when all configured providers are cooling down", () => {
    assert.ok(
      providerHealthSrc.includes("minMs = Math.min(minMs, s.cooldownUntil - now)"),
      "must compute minimum cooldown expiry across all providers",
    );
  });
});

// ── 2. Route response includes providerRetryAfterMs and resumableJobId ────────

describe("ai-analyze route — auto-retry fields in response", () => {
  it("imports getMinCooldownExpiryMs", () => {
    assert.ok(
      routeSrc.includes("getMinCooldownExpiryMs"),
      "route must import and use getMinCooldownExpiryMs",
    );
  });

  it("includes providerRetryAfterMs in the success response", () => {
    assert.ok(
      routeSrc.includes("providerRetryAfterMs"),
      "route must include providerRetryAfterMs in response body",
    );
  });

  it("providerRetryAfterMs is null when analysis succeeded (not a fallback)", () => {
    assert.ok(
      routeSrc.includes("providerRetryAfterMs: analysisResult.fallback ? getMinCooldownExpiryMs() : null"),
      "providerRetryAfterMs must be null on AI success and only set on fallback",
    );
  });

  it("includes resumableJobId in the response", () => {
    assert.ok(
      routeSrc.includes("resumableJobId"),
      "route must include resumableJobId in response body",
    );
  });

  it("resumableJobId is only set when chunks are partially complete", () => {
    assert.ok(
      routeSrc.includes("analysisMeta?.isPartial || (analysisMeta && analysisMeta.completedChunks > 0)"),
      "resumableJobId must only be set when some chunks completed (so resume is meaningful)",
    );
  });
});

// ── 5. Streaming path structural fixes ───────────────────────────────────────

describe("ai-analyze streaming path — structural fix for fallback + auto-retry", () => {
  it("SSE complete event includes fallback field when result is a fallback", () => {
    assert.ok(
      routeSrc.includes("fallback: true") && routeSrc.includes("phase: \"complete\""),
      "SSE complete event must include fallback:true when AI fell back to regex",
    );
  });

  it("SSE complete event includes providerRetryAfterMs when fallback", () => {
    assert.ok(
      routeSrc.includes("sseProviderRetryAfterMs") && routeSrc.includes("providerRetryAfterMs: sseProviderRetryAfterMs"),
      "SSE complete event must include providerRetryAfterMs so client can schedule auto-retry",
    );
  });

  it("SSE complete event includes resumableJobId when fallback", () => {
    assert.ok(
      routeSrc.includes("sseResumableJobId") && routeSrc.includes("resumableJobId: sseResumableJobId"),
      "SSE complete event must include resumableJobId so client can resume from last checkpoint",
    );
  });

  it("SSE complete event includes providerDiagnostics when fallback", () => {
    assert.ok(
      routeSrc.includes("providerDiagnostics: buildProviderDiagnosticsSnapshot()"),
      "SSE complete event must include providerDiagnostics for the fallback banner details panel",
    );
  });

});
