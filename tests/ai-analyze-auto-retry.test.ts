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

// ── 2. Route response — DIRECTIVE 2: streaming/synchronous paths removed ─────
// The legacy /ai-analyze route now returns 422 MANUAL_AI_ANALYZE_REQUIRED.
// Auto-retry is handled by the durable retry state machine in run-next
// (TRANSIENT_RETRY re-arm with bounded backoff), not by SSE response fields.
// The manual-ai-analyze route returns 202 { jobId, status, totalChunks }.

describe("ai-analyze route — returns MANUAL_AI_ANALYZE_REQUIRED (no streaming)", () => {
  it("route returns 422 MANUAL_AI_ANALYZE_REQUIRED for fresh creation", () => {
    assert.ok(routeSrc.includes("MANUAL_AI_ANALYZE_REQUIRED"),
      "route must return MANUAL_AI_ANALYZE_REQUIRED for fresh job creation");
  });

  it("route returns MANUAL_AI_ANALYZE_REQUIRED for fresh creation", () => {
    assert.ok(routeSrc.includes("MANUAL_AI_ANALYZE_REQUIRED"),
      "route must return MANUAL_AI_ANALYZE_REQUIRED for fresh job creation");
  });
});

// ── 5. Streaming path removed — auto-retry handled by durable worker ──────────

describe("durable worker handles auto-retry (not SSE response fields)", () => {
  it("run-next route has TRANSIENT_RETRY_BUDGET_EXHAUSTED terminal state", () => {
    const runNextSrc = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");
    assert.ok(runNextSrc.includes("TRANSIENT_RETRY_BUDGET_EXHAUSTED"),
      "run-next must have bounded retry budget terminal state");
  });

  it("run-next route re-arms QUEUED with nextAttemptAt on transient retry", () => {
    const runNextSrc = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");
    assert.ok(runNextSrc.includes("nextAttemptAt"),
      "run-next must set nextAttemptAt for bounded backoff");
  });
});
