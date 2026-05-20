// Unit tests for the stuck-job recovery hooks in lib/ai-jobs.ts.
//
// These tests cover the env-var parsing + the public API shape.
// The DB-backed functions (findStuckJobs, failStuckJobs,
// recoverIfStuck) are exported as async functions; we verify
// the function signature without hitting Prisma.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { AI_JOB_STUCK_AFTER_MS, findStuckJobs, failStuckJobs, recoverIfStuck } from "../lib/ai-jobs";

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
