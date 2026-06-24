// Durable, provider-aware AI Analyze retry scheduler.
//
// This locks in the server-side backstop that resumes a stopped AI_ANALYZE run
// when no browser is open:
//   1. Failures are classified retryable vs non-retryable — corrupted
//      extraction, OCR-required, ownership/auth, content-hash drift, and weak
//      grounding NEVER auto-retry.
//   2. Bounded exponential backoff: 30s → 1m → 3m → 10m → stop (4 attempts).
//   3. Re-arm only when a provider is actually eligible; resume from the last
//      SUCCEEDED chunk; never spawn a duplicate active job.
//   4. run-next records retry state on a terminal partial/failed AI_ANALYZE and,
//      for automated callers, re-arms due jobs — so the EXISTING daily run-next
//      cron drives retries with no new cron entry (Vercel Hobby caps at 2).
//
// Pure logic is exercised behaviourally; route/schema/migration wiring is
// asserted at the source level (the convention the rest of this suite uses for
// DB/session-bound code).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import {
  classifyFailure,
  isAnyProviderEligible,
  RETRY_DELAYS_MS,
  MAX_RETRY_COUNT,
  NON_RETRYABLE_CATEGORIES,
  RETRYABLE_CATEGORIES,
} from "../lib/ai-analyze/retry-service";

// ── Backoff schedule ─────────────────────────────────────────────────────────
describe("bounded exponential backoff schedule", () => {
  it("is 30s → 1m → 3m → 10m, then stops (4 attempts)", () => {
    assert.deepEqual([...RETRY_DELAYS_MS], [30_000, 60_000, 180_000, 600_000]);
    assert.equal(MAX_RETRY_COUNT, 4);
  });

  it("is strictly increasing (true backoff, never tightens)", () => {
    for (let i = 1; i < RETRY_DELAYS_MS.length; i++) {
      assert.ok(RETRY_DELAYS_MS[i] > RETRY_DELAYS_MS[i - 1], `delay[${i}] must exceed delay[${i - 1}]`);
    }
  });

  it("the next-delay slot mirrors recordRetryState (min(n-1, last)) and stops past the cap", () => {
    const slot = (retryCount: number): number | null =>
      retryCount <= MAX_RETRY_COUNT ? RETRY_DELAYS_MS[Math.min(retryCount - 1, RETRY_DELAYS_MS.length - 1)] : null;
    assert.equal(slot(1), 30_000);
    assert.equal(slot(2), 60_000);
    assert.equal(slot(3), 180_000);
    assert.equal(slot(4), 600_000);
    assert.equal(slot(5), null); // attempt cap reached → no further retry
  });
});

// ── Failure classification ───────────────────────────────────────────────────
describe("classifyFailure — retryable vs non-retryable", () => {
  it("never auto-retries non-retryable categories", () => {
    for (const cat of NON_RETRYABLE_CATEGORIES) {
      assert.equal(classifyFailure(undefined, cat, "FAILED").retryable, false, `${cat} must be non-retryable`);
    }
  });

  it("retries transient/provider categories", () => {
    for (const cat of RETRYABLE_CATEGORIES) {
      assert.equal(classifyFailure(undefined, cat, "FAILED").retryable, true, `${cat} must be retryable`);
    }
  });

  it("classifies provider exhaustion (the common stop reason) as retryable", () => {
    assert.equal(classifyFailure("AI providers exhausted", "AI_PROVIDERS_EXHAUSTED", "FAILED").retryable, true);
    assert.equal(classifyFailure(undefined, "PROVIDER_EXHAUSTED", "FAILED").retryable, true);
  });

  it("blocks retry by MESSAGE even when the category is missing — the safety net", () => {
    assert.equal(classifyFailure("Extraction is corrupted", undefined, "FAILED").retryable, false);
    assert.equal(classifyFailure("This document requires OCR", undefined, "FAILED").retryable, false);
    assert.equal(classifyFailure("Tender not found or access denied", undefined, "FAILED").retryable, false);
    assert.equal(classifyFailure("content hash changed since the run", undefined, "FAILED").retryable, false);
    assert.equal(classifyFailure("mandatory requirements have weak grounding", undefined, "FAILED").retryable, false);
    assert.equal(classifyFailure("Worker returned 401 unauthorized", undefined, "FAILED").retryable, false);
  });

  it("treats PARTIAL_SUCCESS as retryable (remaining chunks may complete)", () => {
    const c = classifyFailure(undefined, undefined, "PARTIAL_SUCCESS");
    assert.equal(c.retryable, true);
    assert.equal(c.category, "PARTIAL_SUCCESS");
  });

  it("defaults a genuinely-unknown failure to retryable (attempt cap still bounds it)", () => {
    assert.equal(classifyFailure(undefined, undefined, "FAILED").retryable, true);
  });

  it("category wins over message — a non-retryable category is never overridden", () => {
    // Even with an otherwise-retryable-sounding message, the hard category holds.
    assert.equal(classifyFailure("transient blip", "GROUNDING_TOO_WEAK", "FAILED").retryable, false);
  });
});

// ── Provider eligibility gate ────────────────────────────────────────────────
describe("isAnyProviderEligible gates both scheduling and re-arming", () => {
  it("returns a boolean and is false when no provider is configured", () => {
    const saved: Record<string, string | undefined> = {};
    const keys = [
      "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
      "ZAI_API_KEY", "CEREBRAS_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY",
      "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "TOGETHER_API_KEY", "FIREWORKS_API_KEY",
    ];
    for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
    try {
      assert.equal(isAnyProviderEligible(), false);
    } finally {
      for (const k of keys) { if (saved[k] !== undefined) process.env[k] = saved[k]; }
    }
  });
});

// ── run-next wiring ──────────────────────────────────────────────────────────
describe("run-next records retry state and re-arms due jobs (automated path)", () => {
  const src = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");

  it("records retry state ONLY for terminal partial/failed AI_ANALYZE", () => {
    assert.match(src, /recordRetryStateForJob/);
    assert.match(src, /claimed\.jobType === "AI_ANALYZE"[\s\S]*?PARTIAL_SUCCESS"[\s\S]*?FAILED"/);
  });

  it("re-arms due retries only for automated callers, before the claim loop", () => {
    assert.match(src, /if \(isAutomatedCaller\) \{[\s\S]*?findJobsDueForRetry\([\s\S]*?rearmJobForRetry\(/);
  });

  it("re-arm is best-effort and never throws into the claim loop", () => {
    assert.match(src, /rearmJobForRetry\(job\.jobId\)\.catch\(/);
    assert.match(src, /Retry re-arm failed/);
  });
});

// ── Dedicated cron route ─────────────────────────────────────────────────────
describe("ai-analyze-retry cron route", () => {
  const route = readFileSync("app/api/cron/ai-analyze-retry/route.ts", "utf8");

  it("requires the CRON_SECRET bearer (or worker secret) and rejects otherwise", () => {
    assert.match(route, /Bearer \$\{cronSecret\}/);
    assert.match(route, /x-worker-secret/);
    assert.match(route, /status: 401/);
  });

  it("finds due jobs, re-arms them, and short-circuits when no provider is eligible", () => {
    assert.match(route, /findJobsDueForRetry\(/);
    assert.match(route, /rearmJobForRetry\(/);
    assert.match(route, /isAnyProviderEligible\(\)/);
  });

  it("triggers run-next so re-armed jobs resume immediately", () => {
    assert.match(route, /\/api\/ai-jobs\/run-next\?jobType=AI_ANALYZE/);
  });
});

// ── Schema + migration + bootstrap stay in lock-step ─────────────────────────
describe("AiAnalyzeRetryState persistence is wired end-to-end", () => {
  it("schema defines the model with a cascading 1:1 relation to AiJob", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    assert.match(schema, /model AiAnalyzeRetryState \{/);
    assert.match(schema, /job\s+AiJob\s+@relation\(fields: \[jobId\], references: \[id\], onDelete: Cascade\)/);
    assert.match(schema, /retryState\s+AiAnalyzeRetryState\?/); // back-relation on AiJob
  });

  it("a migration creates the table, its indexes, and the FK", () => {
    const dir = "prisma/migrations/20260624000000_add_ai_analyze_retry_state/migration.sql";
    assert.ok(existsSync(dir), "migration must exist");
    const sql = readFileSync(dir, "utf8");
    assert.match(sql, /CREATE TABLE "AiAnalyzeRetryState"/);
    assert.match(sql, /CREATE UNIQUE INDEX "AiAnalyzeRetryState_jobId_key"/);
    assert.match(sql, /ADD CONSTRAINT "AiAnalyzeRetryState_jobId_fkey" FOREIGN KEY \("jobId"\) REFERENCES "AiJob"\("id"\) ON DELETE CASCADE/);
  });

  it("the runtime bootstrap mirrors the table + indexes for dev", () => {
    const prismaTs = readFileSync("lib/prisma.ts", "utf8");
    assert.match(prismaTs, /CREATE TABLE IF NOT EXISTS "AiAnalyzeRetryState"/);
    assert.match(prismaTs, /AiAnalyzeRetryState_nonRetryable_nextRetryAt_idx/);
  });
});

// ── Deploy-safety guard ──────────────────────────────────────────────────────
describe("Vercel cron budget is not exceeded", () => {
  it("vercel.json keeps at most 2 crons (Hobby limit) — retries reuse run-next", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons?: unknown[] };
    assert.ok(Array.isArray(vercel.crons), "crons must be an array");
    assert.ok((vercel.crons ?? []).length <= 2, `expected ≤ 2 crons, found ${(vercel.crons ?? []).length}`);
  });
});
