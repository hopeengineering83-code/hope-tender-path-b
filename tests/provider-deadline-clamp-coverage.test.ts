// P0 #3, coverage: EVERY provider adapter must clamp its timeout to the parent
// deadline — not just the ones that happened to get converted.
//
// The deadline work bound provider cancellation to the parent's clock via
// resolveEffectiveTimeoutMs(), and a sibling suite proves the clamping maths and
// that a hanging socket is terminated on the parent's clock. What neither
// covered is COVERAGE: whether every adapter actually calls it.
//
// Gemini did not. It passed a static GEMINI_TIMEOUT_MS straight to
// generateContent at two call sites. Gemini is sixth in the canonical provider
// order — a routinely exercised path — and the miss was the worst possible one:
// that call sits inside withRateLimitRetry AND a loop over uniqueModels(), so a
// static timeout could be spent again per retry and per fallback model, letting
// a single provider overrun the parent's entire remaining budget several times.
//
// This test greps the adapter source, because coverage is a property of the file
// rather than of any one call: a new adapter added later with a bare static
// timeout is exactly the regression to catch, and only a source-level check
// sees it.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/ai.ts", "utf8");

describe("every provider adapter clamps to the parent deadline", () => {
  it("passes no raw static timeout constant to a provider call", () => {
    // Every timeout constant imported from timeout-config must reach a provider
    // through resolveEffectiveTimeoutMs(...), never bare.
    const constants = [
      "GEMINI_TIMEOUT_MS",
      "DEEPSEEK_DEFAULT_TIMEOUT_MS",
      "OPENAI_COMPAT_DEFAULT_TIMEOUT_MS",
      "O1_O3_TIMEOUT_MS",
    ];
    const offenders: string[] = [];
    for (const name of constants) {
      // Match uses of the constant that are NOT wrapped in resolveEffectiveTimeoutMs,
      // ignoring the import line and any comment lines.
      const re = new RegExp(`^(?!import).*\\b${name}\\b.*$`, "gm");
      for (const line of source.match(re) ?? []) {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
        if (trimmed.includes("resolveEffectiveTimeoutMs")) continue;
        // Diagnostic output interpolates the static constant into human-readable
        // text ("timed out after 60000ms"). That is the value the adapter was
        // configured with, not a timeout being handed to a provider, so it is
        // outside this assertion's subject. Narrowed deliberately rather than
        // relaxed: a genuine unclamped provider call still fails.
        if (/\blogger\.|console\./.test(trimmed)) continue;
        // Assignment/derivation lines that only compute a local are acceptable
        // provided the local is itself clamped at the call site; those show up
        // as `const x = COND ? A : B;` with no timeout: / signal: on the line.
        if (/^const\s+\w+\s*=/.test(trimmed) && !/timeout:|signal:/.test(trimmed)) continue;
        offenders.push(trimmed.slice(0, 120));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `these provider timeouts are not clamped to the parent deadline:\n${offenders.join("\n")}`,
    );
  });

  it("clamps both Gemini call sites specifically", () => {
    const geminiCalls = source.match(/generateContent\([^)]*timeout[^)]*\)/g) ?? [];
    assert.ok(geminiCalls.length >= 1, "expected at least one Gemini generateContent call carrying a timeout");
    for (const call of geminiCalls) {
      assert.match(
        call,
        /resolveEffectiveTimeoutMs/,
        `Gemini call site must clamp to the parent deadline: ${call}`,
      );
    }
  });

  it("arms every AbortController from the clamp, never a bare constant", () => {
    const abortArms = source.match(/setTimeout\(\(\) => controller\.abort\(\),[^)]*\)/g) ?? [];
    assert.ok(abortArms.length >= 3, "expected the fetch-based adapters to arm abort controllers");
    for (const arm of abortArms) {
      assert.match(arm, /resolveEffectiveTimeoutMs/, `abort site must be clamped: ${arm}`);
    }
  });

  it("clamps every AbortSignal.timeout call", () => {
    const signalTimeouts = source.match(/AbortSignal\.timeout\([^)]*\)/g) ?? [];
    assert.ok(signalTimeouts.length >= 1, "expected SDK adapters to use AbortSignal.timeout");
    for (const signal of signalTimeouts) {
      assert.match(signal, /resolveEffectiveTimeoutMs/, `signal must be clamped: ${signal}`);
    }
  });
});
