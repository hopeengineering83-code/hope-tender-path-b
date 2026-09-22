// 2026-09-22, Preview: AI Analyze job 5b9f07f6 failed with "zai: timed out
// after 45000ms" while the durable worker still had ~220s of its 300s budget
// left. Z.ai was the only reachable, generation-verified provider at that
// moment (Gemini 503, Groq excluded by its 8000 TPM limit, the rest locked
// out by billing), so a fixed 45s cap turned a slow-but-working provider into
// a failed analysis.
//
// The fix gives a provider a longer per-attempt ceiling ONLY when a durable
// worker has armed a deadline, and never lets that ceiling pass the deadline.
// These tests pin the behaviour, not the source text.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  resolveProviderAttemptTimeoutMs,
  withProviderDeadline,
  MIN_PROVIDER_TIMEOUT_MS,
} from "../lib/ai";
import { getProviderTimeoutMs, getProviderWorkerTimeoutMs } from "../lib/ai-provider-registry";

const NOW = 1_000_000;

describe("a worker attempt may use its budget but never pass its deadline", () => {
  it("keeps the static timeout when no worker deadline is armed", () => {
    assert.equal(resolveProviderAttemptTimeoutMs(45_000, 150_000, NOW), 45_000);
  });

  it("keeps the static timeout when the provider has no worker ceiling", () => {
    const got = withProviderDeadline(NOW + 220_000, () => resolveProviderAttemptTimeoutMs(45_000, undefined, NOW));
    assert.equal(got, 45_000);
  });

  it("lengthens to the worker ceiling when the deadline leaves room", () => {
    const got = withProviderDeadline(NOW + 220_000, () => resolveProviderAttemptTimeoutMs(45_000, 150_000, NOW));
    assert.equal(got, 150_000);
  });

  it("stops at the deadline when less time remains than the ceiling", () => {
    const got = withProviderDeadline(NOW + 90_000, () => resolveProviderAttemptTimeoutMs(45_000, 150_000, NOW));
    assert.equal(got, 90_000);
  });

  it("shortens below the static timeout when the deadline is nearer still", () => {
    const got = withProviderDeadline(NOW + 10_000, () => resolveProviderAttemptTimeoutMs(45_000, 150_000, NOW));
    assert.equal(got, 10_000);
  });

  it("never exceeds the time remaining, for any remaining budget", () => {
    for (const remaining of [2_000, 30_000, 44_999, 45_000, 100_000, 149_999, 150_000, 299_000]) {
      const got = withProviderDeadline(NOW + remaining, () => resolveProviderAttemptTimeoutMs(45_000, 150_000, NOW));
      assert.ok(got <= Math.max(remaining, MIN_PROVIDER_TIMEOUT_MS), `remaining ${remaining} → ${got}`);
      assert.ok(got <= 150_000);
    }
  });

  it("gives Z.ai and Cerebras a worker ceiling above their static timeout", () => {
    for (const p of ["zai", "cerebras"] as const) {
      const worker = getProviderWorkerTimeoutMs(p);
      assert.equal(typeof worker, "number", `${p} must have a worker ceiling`);
      assert.ok(worker! > getProviderTimeoutMs(p), `${p} worker ceiling must exceed its static timeout`);
    }
  });
});
