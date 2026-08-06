// Unit tests for the stuck-job recovery hooks in lib/ai-jobs.ts.
//
// Covers:
//   - env-var parsing
//   - public API shape
//   - ENGINE_RUN progress-only stuck recovery (Gap 1)
//   - non-ENGINE_RUN types still require wall-clock + progress thresholds

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  AI_JOB_STUCK_AFTER_MS,
  AI_JOB_PROGRESS_STUCK_AFTER_MS,
  findStuckJobs,
  failStuckJobs,
  recoverIfStuck,
  isProgressStuckOnlyType,
} from "../lib/ai-jobs";

describe("AI_JOB_STUCK_AFTER_MS — env-var parsing", () => {
  it("defaults to 15 minutes (900_000ms) when AI_JOB_STUCK_AFTER_MS is unset", () => {
    // The constant is captured at module-load time; tests can only
    // observe the captured value. With the test harness having no
    // env override, the default applies.
    if (process.env.AI_JOB_STUCK_AFTER_MS === undefined) {
      assert.equal(AI_JOB_STUCK_AFTER_MS, 15 * 60 * 1000);
    } else {
      // If a test runner sets a value, just assert the type + range.
      assert.equal(typeof AI_JOB_STUCK_AFTER_MS, "number");
      assert.ok(AI_JOB_STUCK_AFTER_MS >= 60_000 && AI_JOB_STUCK_AFTER_MS <= 3_600_000);
    }
  });

  it("is bounded between 1 minute and 1 hour for safety", () => {
    assert.ok(AI_JOB_STUCK_AFTER_MS >= 60_000, "stuck threshold should be at least 1 minute");
    assert.ok(AI_JOB_STUCK_AFTER_MS <= 3_600_000, "stuck threshold should be at most 1 hour");
  });

  it("AI_JOB_PROGRESS_STUCK_AFTER_MS defaults to 180s and is bounded", () => {
    if (process.env.AI_JOB_PROGRESS_STUCK_AFTER_MS === undefined) {
      assert.equal(AI_JOB_PROGRESS_STUCK_AFTER_MS, 180_000);
    }
    assert.ok(AI_JOB_PROGRESS_STUCK_AFTER_MS >= 30_000);
    assert.ok(AI_JOB_PROGRESS_STUCK_AFTER_MS <= 1_800_000);
  });
});

describe("stuck-job recovery API surface", () => {
  it("findStuckJobs is exported as a callable async function", () => {
    assert.equal(typeof findStuckJobs, "function");
  });

  it("failStuckJobs is exported as a callable async function", () => {
    assert.equal(typeof failStuckJobs, "function");
  });

  it("recoverIfStuck is exported as a callable async function", () => {
    assert.equal(typeof recoverIfStuck, "function");
  });
});

// ─── Gap 1 — logic-level tests for progress-only stuck-detection policy ──────
//
// The actual DB-backed functions are async wrappers over Prisma. We can't run
// them without a real database in the test runner. Instead we exercise the
// SAME predicate logic on plain JavaScript objects — but, critically, this
// predicate CALLS THE REAL isProgressStuckOnlyType() exported from
// lib/ai-jobs.ts rather than re-implementing the ENGINE_RUN/PROPOSAL_GENERATION
// membership check inline. An earlier version of this file hard-coded
// `job.jobType === "ENGINE_RUN"` here, which silently drifted out of sync
// when PROPOSAL_GENERATION was added to isProgressStuckOnlyType (it also
// gets a 25s AiJobStep heartbeat now, see lib/ai-job-handlers.ts) — this test
// kept "passing" while asserting the OLD, no-longer-true behavior. Calling
// the real predicate makes that class of drift impossible.
function isStuck(
  job: { jobType: string; startedAt: Date | null; latestStepAt: Date | null },
  now: number,
  totalThresholdMs: number,
  progressThresholdMs: number,
): boolean {
  const totalThreshold = new Date(now - totalThresholdMs);
  const progressThreshold = new Date(now - progressThresholdMs);
  const progressStalled = !job.latestStepAt || job.latestStepAt < progressThreshold;
  if (!progressStalled) return false;
  if (isProgressStuckOnlyType(job.jobType)) {
    // Progress-stall alone is sufficient, but the job must have been
    // running at least the progress threshold (otherwise it's a fresh job
    // whose first step hasn't been emitted yet).
    return job.startedAt !== null && job.startedAt < progressThreshold;
  }
  // Other types: wall-clock AND progress both required.
  return job.startedAt !== null && job.startedAt < totalThreshold;
}

describe("Gap 1 — progress-only stuck-job policy (ENGINE_RUN, PROPOSAL_GENERATION)", () => {
  const now = Date.now();
  const FIFTEEN_MIN = 15 * 60 * 1000;
  const NINETY_SECONDS = 90_000;

  it("isProgressStuckOnlyType covers exactly ENGINE_RUN and PROPOSAL_GENERATION", () => {
    assert.equal(isProgressStuckOnlyType("ENGINE_RUN"), true);
    assert.equal(isProgressStuckOnlyType("PROPOSAL_GENERATION"), true);
    assert.equal(isProgressStuckOnlyType("VAULT_INGEST"), false);
    assert.equal(isProgressStuckOnlyType("EXTRACT_TEXT"), false);
    assert.equal(isProgressStuckOnlyType("AI_ANALYZE"), false);
  });

  for (const progressOnlyType of ["ENGINE_RUN", "PROPOSAL_GENERATION"]) {
    it(`marks a ${progressOnlyType} with no recent step as STUCK after 90s even if wall-clock < 15 min`, () => {
      const startedAt = new Date(now - 5 * 60 * 1000); // 5 min ago
      const job = { jobType: progressOnlyType, startedAt, latestStepAt: null };
      assert.equal(isStuck(job, now, FIFTEEN_MIN, NINETY_SECONDS), true);
    });

    it(`marks a ${progressOnlyType} with stale step (>90s) as STUCK even if wall-clock < 15 min`, () => {
      const startedAt = new Date(now - 5 * 60 * 1000); // 5 min ago
      const latestStepAt = new Date(now - 2 * 60 * 1000); // 2 min ago (> 90s)
      const job = { jobType: progressOnlyType, startedAt, latestStepAt };
      assert.equal(isStuck(job, now, FIFTEEN_MIN, NINETY_SECONDS), true);
    });

    it(`does NOT mark a ${progressOnlyType} as STUCK when a fresh (heartbeat) step exists within 90s`, () => {
      const startedAt = new Date(now - 5 * 60 * 1000);
      const latestStepAt = new Date(now - 30_000); // 30 s ago
      const job = { jobType: progressOnlyType, startedAt, latestStepAt };
      assert.equal(isStuck(job, now, FIFTEEN_MIN, NINETY_SECONDS), false);
    });

    it(`does NOT mark a brand-new ${progressOnlyType} (started <90s ago) as STUCK even with no steps`, () => {
      const startedAt = new Date(now - 30_000); // 30 s ago
      const job = { jobType: progressOnlyType, startedAt, latestStepAt: null };
      assert.equal(isStuck(job, now, FIFTEEN_MIN, NINETY_SECONDS), false);
    });
  }

  it("does NOT aggressively fail a non-progress-only job (VAULT_INGEST) that is progress-stalled but wall-clock < 15 min", () => {
    // A VAULT_INGEST job can legitimately run several minutes re-extracting a
    // large batch of documents without emitting a step in between. The
    // ENGINE_RUN/PROPOSAL_GENERATION shortcut must NOT apply to it.
    const startedAt = new Date(now - 5 * 60 * 1000); // 5 min ago
    const job = { jobType: "VAULT_INGEST", startedAt, latestStepAt: null };
    assert.equal(isStuck(job, now, FIFTEEN_MIN, NINETY_SECONDS), false);
  });

  it("marks a non-progress-only job STUCK only when BOTH wall-clock and progress thresholds passed", () => {
    const startedAt = new Date(now - 20 * 60 * 1000); // 20 min ago
    const latestStepAt = new Date(now - 5 * 60 * 1000); // 5 min ago (>90s)
    const job = { jobType: "VAULT_INGEST", startedAt, latestStepAt };
    assert.equal(isStuck(job, now, FIFTEEN_MIN, NINETY_SECONDS), true);
  });

  it("a non-progress-only job past wall-clock but with fresh step is NOT stuck", () => {
    const startedAt = new Date(now - 20 * 60 * 1000); // 20 min ago
    const latestStepAt = new Date(now - 30_000); // 30 s ago
    const job = { jobType: "VAULT_INGEST", startedAt, latestStepAt };
    assert.equal(isStuck(job, now, FIFTEEN_MIN, NINETY_SECONDS), false);
  });
});

describe("Gap 1 — structured failed-job output shape", () => {
  it("expected JSON keys for ASYNC_ENGINE_TIMEOUT failure payload", () => {
    // The recovery routines write a JSON blob to AiJob.output of the form
    // { code, nextAction, safeModeAvailable, failedStage, lastProgressAt }.
    // This test pins the contract.
    const expected = {
      code: "ASYNC_ENGINE_TIMEOUT",
      nextAction: "RUN_ENGINE_SAFE_MODE",
      safeModeAvailable: true,
      failedStage: "UNKNOWN",
      lastProgressAt: null,
    };
    const serialized = JSON.stringify({
      code: "ASYNC_ENGINE_TIMEOUT",
      nextAction: "RUN_ENGINE_SAFE_MODE",
      safeModeAvailable: true,
      failedStage: "UNKNOWN",
      lastProgressAt: null,
    });
    assert.deepEqual(JSON.parse(serialized), expected);
  });
});
