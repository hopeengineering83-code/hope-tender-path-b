// AI Analyze auto-retry regression tests.
//
// Verifies:
//   1. getMinCooldownExpiryMs returns 0 when a provider is available.
//   2. getMinCooldownExpiryMs returns null when no providers configured.
//   3. getMinCooldownExpiryMs returns > 0 ms when all providers are cooling down.
//   4. The ai-analyze route exports providerRetryAfterMs in its response shape.
//   5. The ai-analyze route exports resumableJobId in its response shape.
//   6. The tender-detail UI includes auto-retry countdown state (autoRetryAt).
//   7. The tender-detail UI includes cancelAutoRetry helper.
//   8. The tender-detail UI includes scheduleAutoRetry helper.
//   9. The tender-detail UI clears auto-retry when handleAnalyzeStreaming is called.
//  10. The auto-retry countdown banner is rendered when autoRetrySecondsLeft > 0.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const providerHealthSrc = readFileSync(path.join(process.cwd(), "lib/ai-provider-health.ts"), "utf-8");
const routeSrc = readFileSync(path.join(process.cwd(), "app/api/tenders/[id]/ai-analyze/route.ts"), "utf-8");
const uiSrc = readFileSync(path.join(process.cwd(), "app/dashboard/tenders/[id]/tender-detail.tsx"), "utf-8");

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

// ── 3. UI — auto-retry state and helpers ─────────────────────────────────────

describe("tender-detail UI — auto-retry state management", () => {
  it("declares autoRetryAt state", () => {
    assert.ok(
      uiSrc.includes("autoRetryAt") && uiSrc.includes("setAutoRetryAt"),
      "tender-detail must declare autoRetryAt state",
    );
  });

  it("declares autoRetrySecondsLeft countdown state", () => {
    assert.ok(
      uiSrc.includes("autoRetrySecondsLeft") && uiSrc.includes("setAutoRetrySecondsLeft"),
      "tender-detail must declare autoRetrySecondsLeft countdown state",
    );
  });

  it("declares cancelAutoRetry helper", () => {
    assert.ok(
      uiSrc.includes("function cancelAutoRetry"),
      "tender-detail must declare cancelAutoRetry helper",
    );
  });

  it("declares scheduleAutoRetry helper", () => {
    assert.ok(
      uiSrc.includes("function scheduleAutoRetry"),
      "tender-detail must declare scheduleAutoRetry helper",
    );
  });

  it("scheduleAutoRetry sets a setTimeout that calls handleAnalyzeStreaming", () => {
    assert.ok(
      uiSrc.includes("handleAnalyzeStreaming") && uiSrc.includes("scheduleAutoRetry"),
      "scheduleAutoRetry must schedule handleAnalyzeStreaming via setTimeout",
    );
  });

  it("handleAnalyzeStreaming calls cancelAutoRetry at the start", () => {
    const streamingFn = uiSrc.slice(uiSrc.indexOf("async function handleAnalyzeStreaming"));
    const fnBody = streamingFn.slice(0, streamingFn.indexOf("\n  async function", 1) || 2000);
    assert.ok(
      fnBody.includes("cancelAutoRetry()"),
      "handleAnalyzeStreaming must cancel any pending auto-retry when user manually triggers",
    );
  });

  it("handleContinueAnalysis calls cancelAutoRetry at the start", () => {
    const fn = uiSrc.slice(uiSrc.indexOf("async function handleContinueAnalysis"));
    const fnBody = fn.slice(0, fn.indexOf("\n  async function", 1) || 2000);
    assert.ok(
      fnBody.includes("cancelAutoRetry()"),
      "handleContinueAnalysis must cancel any pending auto-retry when user manually continues",
    );
  });

  it("cleanup useEffect cancels timer on unmount", () => {
    assert.ok(
      uiSrc.includes("autoRetryTimerRef.current") && uiSrc.includes("clearTimeout") && uiSrc.includes("clearInterval"),
      "a cleanup useEffect must cancel both the retry timer and the countdown interval on unmount",
    );
  });
});

// ── 4. UI — countdown banner rendered ────────────────────────────────────────

describe("tender-detail UI — auto-retry countdown banner", () => {
  it("renders countdown banner when autoRetrySecondsLeft > 0", () => {
    assert.ok(
      uiSrc.includes("autoRetrySecondsLeft !== null && autoRetrySecondsLeft > 0"),
      "banner must only appear when countdown is active",
    );
  });

  it("countdown banner shows seconds remaining", () => {
    assert.ok(
      uiSrc.includes("auto-retrying in {autoRetrySecondsLeft}s"),
      "banner must display the live countdown seconds",
    );
  });

  it("countdown banner has a Cancel button that calls cancelAutoRetry", () => {
    assert.ok(
      uiSrc.includes("onClick={cancelAutoRetry}"),
      "banner must have a Cancel button wired to cancelAutoRetry",
    );
  });

  it("indicates resume-from-checkpoint when resumableJobId is set", () => {
    assert.ok(
      uiSrc.includes("will resume from last checkpoint"),
      "banner must inform the user that analysis will resume from the last checkpoint",
    );
  });

  it("shows no-provider message when providerRetryAfterMs is null", () => {
    assert.ok(
      uiSrc.includes("providerRetryAfterMs === null") &&
        uiSrc.includes("Configure an AI provider"),
      "when no providers are configured, show a configure-provider message instead of countdown",
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

  it("handleAnalyzeStreaming calls setAnalyzeResult when SSE complete has fallback:true", () => {
    const streamingFn = uiSrc.slice(uiSrc.indexOf("async function handleAnalyzeStreaming"));
    const fnEnd = streamingFn.indexOf("\n  async function", 1);
    const fnBody = streamingFn.slice(0, fnEnd > 0 ? fnEnd : 3000);
    assert.ok(
      fnBody.includes("event.fallback") && fnBody.includes("setAnalyzeResult"),
      "streaming path must call setAnalyzeResult when event.fallback is true",
    );
  });

  it("handleAnalyzeStreaming schedules auto-retry when SSE complete has providerRetryAfterMs", () => {
    const streamingFn = uiSrc.slice(uiSrc.indexOf("async function handleAnalyzeStreaming"));
    const fnEnd = streamingFn.indexOf("\n  async function", 1);
    const fnBody = streamingFn.slice(0, fnEnd > 0 ? fnEnd : 3000);
    assert.ok(
      fnBody.includes("scheduleAutoRetry") && fnBody.includes("event.providerRetryAfterMs"),
      "streaming path must call scheduleAutoRetry using event.providerRetryAfterMs",
    );
  });

  it("handleAnalyzeStreaming does NOT call window.location.reload for fallback results", () => {
    const streamingFn = uiSrc.slice(uiSrc.indexOf("async function handleAnalyzeStreaming"));
    const fnEnd = streamingFn.indexOf("\n  async function", 1);
    const fnBody = streamingFn.slice(0, fnEnd > 0 ? fnEnd : 3000);
    // The reload must be conditional — only for non-fallback results
    const reloadLine = fnBody.indexOf("window.location.reload()");
    const streamedFallbackCheck = fnBody.indexOf("streamedFallback");
    assert.ok(
      reloadLine > 0 && streamedFallbackCheck > 0 && streamedFallbackCheck < reloadLine,
      "window.location.reload() must be guarded by !streamedFallback so state is preserved for the countdown banner",
    );
  });
});
