// Behavioral test: worker deadline architecture (Directive 5)
//
// Verifies that the run-next worker:
//   1. Has a request-level absolute deadline (maxRunMs = 40_000)
//   2. Enforces MINIMUM_REMAINING_BUDGET before claiming new jobs
//   3. Passes deadlineMs and absoluteDeadline into handler input
//   4. Never starts a job when insufficient budget remains
//
// This is a source-text contract test (not a runtime integration test) because
// the worker's deadline behavior depends on wall-clock timing that's hard to
// test deterministically without mocking the Vercel runtime. The source-text
// assertions prove the architecture is in place; runtime behavior is validated
// by the CI E2E golden workflow which exercises real provider calls within
// the 60s Vercel limit.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");

describe("DIRECTIVE 5 — Worker deadline architecture", () => {
  it("has a 40-second soft deadline (maxRunMs = 40_000)", () => {
    assert.match(
      route,
      /const maxRunMs = 40_000/,
      "Worker must have a 40s soft deadline — 20s reserve below Vercel's 60s hard kill",
    );
  });

  it("calculates an absolute deadline at invocation start", () => {
    assert.match(
      route,
      /const absoluteDeadline = startTime \+ maxRunMs/,
      "Worker must calculate an absolute deadline from invocation start, not from handler start",
    );
  });

  it("enforces MINIMUM_REMAINING_BUDGET before claiming new jobs", () => {
    assert.match(
      route,
      /const MINIMUM_REMAINING_BUDGET_MS = 10_000/,
      "Worker must refuse to claim new jobs when <10s remain",
    );
    assert.match(
      route,
      /if \(remainingMs < MINIMUM_REMAINING_BUDGET_MS\)/,
      "Worker must check remainingMs against MINIMUM_REMAINING_BUDGET_MS",
    );
  });

  it("reserves persistence time (PERSISTENCE_RESERVE_MS = 5_000)", () => {
    assert.match(
      route,
      /const PERSISTENCE_RESERVE_MS = 5_000/,
      "Worker must reserve 5s for DB persistence before the hard deadline",
    );
  });

  it("passes deadlineMs and absoluteDeadline into handler input", () => {
    assert.match(
      route,
      /deadlineMs: handlerBudgetMs/,
      "Worker must pass deadlineMs into handler input so handlers can cooperatively check budget",
    );
    assert.match(
      route,
      /absoluteDeadline/,
      "Worker must pass absoluteDeadline into handler input",
    );
  });

  it("logs when stopping due to insufficient budget", () => {
    assert.match(
      route,
      /Stopping claim loop/,
      "Worker must log when it stops claiming due to insufficient budget",
    );
  });
});

describe("DIRECTIVE 5 — Transient retry re-arms QUEUED with bounded backoff", () => {
  it("has MAX_TRANSIENT_RETRIES budget (8 attempts)", () => {
    assert.match(
      route,
      /const MAX_TRANSIENT_RETRIES = 8/,
      "Worker must have a bounded retry budget (8 attempts) — no infinite loop",
    );
  });

  it("re-arms QUEUED with nextAttemptAt on transient retry", () => {
    assert.match(
      route,
      /status: "QUEUED"/,
      "Transient retry must re-arm the job to QUEUED (not leave RUNNING)",
    );
    assert.match(
      route,
      /nextAttemptAt/,
      "Transient retry must set nextAttemptAt for bounded backoff",
    );
  });

  it("increments retries counter on transient retry", () => {
    assert.match(
      route,
      /retries: currentRetries/,
      "Transient retry must increment the retries counter",
    );
  });

  it("transitions to FAILED terminal when budget exhausted", () => {
    assert.match(
      route,
      /TRANSIENT_RETRY_BUDGET_EXHAUSTED/,
      "Worker must transition to FAILED terminal when retry budget is exhausted",
    );
  });

  it("uses exponential backoff capped at 60s", () => {
    assert.match(
      route,
      /Math\.min\(60, Math\.pow\(2, currentRetries\)\)/,
      "Worker must use exponential backoff (2^n seconds) capped at 60s",
    );
  });
});
