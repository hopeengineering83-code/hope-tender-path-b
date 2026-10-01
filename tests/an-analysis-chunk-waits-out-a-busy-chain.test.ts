// 2026-09-29, Preview, a new tender's AI Analyze (job 6dbcee14): Gemini 503
// "high demand", Groq refused by its per-minute budget, Mistral 429, Z.ai
// timed out, the rest out of credit. The chunk retried once after 1.5s —
// inside every cooldown — and failed with most of its budget unused. Nothing
// retried it afterwards: the automatic retry rides a scheduled drain that runs
// every few hours. A chunk now waits for the next provider to recover, as
// proposal sections do, bounded by the shared deadline.

import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { chunkCooldownWaitMs, isRecoverableByWaiting, MAX_CHUNK_COOLDOWN_WAITS } from "../lib/ai";
import { getNextCooldownRecoveryMs, recordProviderFailure, resetProviderHealth } from "../lib/ai-provider-health";

const busyChain = new Error('Contacted 2 of 10 configured provider(s) for use-case "extraction" and none succeeded (tried: gemini, mistral). Provider errors: gemini: [503 Service Unavailable] This model is currently experiencing high demand | mistral: Mistral rate limit HTTP 429 | zai: in cooldown');

describe("an analysis chunk waits out a busy provider chain", () => {
  beforeEach(() => resetProviderHealth());

  it("treats overload, rate limits and cooldowns as recoverable, and a malformed answer as not", () => {
    assert.equal(isRecoverableByWaiting(busyChain), true);
    assert.equal(isRecoverableByWaiting(new Error("gemini: 503 Service Unavailable")), true);
    assert.equal(isRecoverableByWaiting(new Error("AI returned malformed JSON for tender analysis")), false);
    assert.equal(isRecoverableByWaiting(new Error("TENANT_MISMATCH")), false);
    assert.ok(MAX_CHUNK_COOLDOWN_WAITS >= 2);
  });

  it("waits for the next recovery when it fits the deadline, and not when it does not", () => {
    const now = 1_000_000;
    assert.equal(chunkCooldownWaitMs({ cooldownMs: 30_000, now, deadlineAt: now + 200_000 }), 30_000);
    assert.equal(chunkCooldownWaitMs({ cooldownMs: 600_000, now, deadlineAt: now + 200_000 }), 65_000, "capped");
    assert.equal(chunkCooldownWaitMs({ cooldownMs: 30_000, now, deadlineAt: now + 60_000 }), null, "no attempt fits after the wait");
    assert.equal(chunkCooldownWaitMs({ cooldownMs: null, now, deadlineAt: now + 200_000 }), null, "nothing recovers by waiting");
  });

  it("measures the next recovery from transient cooldowns only", () => {
    assert.equal(getNextCooldownRecoveryMs(), null, "nothing cooling");
    recordProviderFailure("gemini", new Error("HTTP 429 rate limit exceeded"));
    const wait = getNextCooldownRecoveryMs();
    assert.ok(wait !== null && wait > 0 && wait <= 60_000, `rate-limit cooldown is waited on (got ${wait})`);
    resetProviderHealth();
    recordProviderFailure("gemini", new Error("HTTP 401 Invalid API key"));
    assert.equal(getNextCooldownRecoveryMs(), null, "a rejected key is not cured by waiting");
  });

  it("the chunk retry loop uses them", () => {
    const src = readFileSync("lib/ai.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function analyzeOneChunkWithRetry"), src.indexOf("export type AnalysisChunkCacheEntry"));
    assert.match(fn, /for \(let round = 0; ; round \+= 1\)/);
    assert.match(fn, /isRecoverableByWaiting\(err\)/);
    assert.match(fn, /getNextCooldownRecoveryMs\(\)/);
    assert.match(fn, /chunkCooldownWaitMs\(/);
  });
});
