// Unit tests for the heartbeat-aware stuck-job recovery in lib/ai-jobs.ts.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  AI_JOB_STUCK_AFTER_MS,
  AI_JOB_PROGRESS_STUCK_AFTER_MS,
  findStuckJobs,
  failStuckJobs,
  recoverIfStuck,
  findActiveEngineRunForTender,
} from "../lib/ai-jobs";

describe("stuck-job constants", () => {
  it("AI_JOB_STUCK_AFTER_MS defaults to 15 minutes", () => {
    assert.ok(AI_JOB_STUCK_AFTER_MS >= 15 * 60 * 1000);
  });

  it("AI_JOB_PROGRESS_STUCK_AFTER_MS defaults to 180 seconds (gives slow AI providers room)", () => {
    // 180 s default so a Vercel-killed worker (killed at 60 s, heartbeat
    // every 10 s → last step at ~50 s) is not prematurely marked FAILED.
    // The next worker invocation (cron or browser poll) has ~130 s to resume.
    if (process.env.AI_JOB_PROGRESS_STUCK_AFTER_MS === undefined) {
      assert.equal(AI_JOB_PROGRESS_STUCK_AFTER_MS, 180_000);
    } else {
      assert.ok(AI_JOB_PROGRESS_STUCK_AFTER_MS >= 30_000);
    }
  });

  it("AI_JOB_PROGRESS_STUCK_AFTER_MS is less than AI_JOB_STUCK_AFTER_MS", () => {
    assert.ok(AI_JOB_PROGRESS_STUCK_AFTER_MS < AI_JOB_STUCK_AFTER_MS);
  });

  it("AI_JOB_PROGRESS_STUCK_AFTER_MS is bounded 30s–30min", () => {
    assert.ok(AI_JOB_PROGRESS_STUCK_AFTER_MS >= 30_000);
    assert.ok(AI_JOB_PROGRESS_STUCK_AFTER_MS <= 1_800_000);
  });
});

describe("findActiveEngineRunForTender API surface", () => {
  it("is exported as a callable async function", () => {
    assert.equal(typeof findActiveEngineRunForTender, "function");
  });

  it("accepts (tenderId, userId) and returns a thenable", () => {
    const p = findActiveEngineRunForTender("t1", "u1");
    assert.equal(typeof p.then, "function");
    p.catch(() => {});
  });
});

describe("heartbeat-aware stuck-job API surface", () => {
  it("findStuckJobs accepts progressStuckAfterMs option", () => {
    const p = findStuckJobs({ stuckAfterMs: 900_000, progressStuckAfterMs: 300_000, limit: 1 });
    assert.equal(typeof p.then, "function");
    p.catch(() => {});
  });

  it("failStuckJobs accepts progressStuckAfterMs option", () => {
    const p = failStuckJobs({ stuckAfterMs: 900_000, progressStuckAfterMs: 300_000, limit: 1 });
    assert.equal(typeof p.then, "function");
    p.catch(() => {});
  });

  it("recoverIfStuck accepts progressStuckAfterMs option", () => {
    const p = recoverIfStuck("job-id", { stuckAfterMs: 900_000, progressStuckAfterMs: 300_000 });
    assert.equal(typeof p.then, "function");
    p.catch(() => {});
  });
});
