// Gap 3: Replace the request-bound post-generation continuation with
// durable, idempotent, revision-bound jobs and automatic retries.
//
// The AUTO_FINALIZE job type is now a durable queued job that runs
// runAutoFinalizeAfterGeneration in its own worker budget (not inline
// in the run-next request). It is:
//   - Registered in SUPPORTED_JOB_TYPES and the JobType union.
//   - Handled in lib/ai-job-handlers-legacy.ts.
//   - A DurableRetryJobType (automatically retried on transient failure).
//   - In the progress-stuck checker (recovered if Vercel kills the function).
//   - Enqueued by run-next after PROPOSAL_GENERATION succeeds (not inline).
//
// No failure falls back to "manual retry" when it can be safely automated.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const aiJobs = readFileSync("lib/ai-jobs.ts", "utf8");
const stageRetry = readFileSync("lib/engine/stage-retry-policy.ts", "utf8");
const jobTypePolicy = readFileSync("lib/job-type-policy.ts", "utf8");
const runNext = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");
const handlers = readFileSync("lib/ai-job-handlers-legacy.ts", "utf8");

describe("Gap 3 — AUTO_FINALIZE is a durable, idempotent, revision-bound job", () => {
  it("JobType union includes AUTO_FINALIZE", () => {
    assert.match(aiJobs, /\| "AUTO_FINALIZE"/);
  });

  it("isProgressStuckOnlyType includes AUTO_FINALIZE", () => {
    assert.match(aiJobs, /jobType === "AUTO_FINALIZE"/);
  });

  it("stuck-job query includes AUTO_FINALIZE", () => {
    assert.match(aiJobs, /"ENGINE_RUN", "PROPOSAL_GENERATION", "AUTO_FINALIZE"/);
  });

  it("DurableRetryJobType includes AUTO_FINALIZE", () => {
    assert.match(stageRetry, /"AUTO_FINALIZE"/);
  });

  it("isDurableRetryJobType returns true for AUTO_FINALIZE", () => {
    assert.match(stageRetry, /value === "AUTO_FINALIZE"/);
  });

  it("SUPPORTED_JOB_TYPES includes AUTO_FINALIZE", () => {
    assert.match(jobTypePolicy, /"AUTO_FINALIZE"/);
  });

  it("handler is registered in ai-job-handlers-legacy.ts", () => {
    assert.match(handlers, /AUTO_FINALIZE:\s*async \(ctx\) =>/);
  });

  it("handler calls runAutoFinalizeAfterGeneration", () => {
    assert.match(handlers, /runAutoFinalizeAfterGeneration/);
  });

  it("run-next enqueues AUTO_FINALIZE after PROPOSAL_GENERATION (not inline)", () => {
    const idx = runNext.indexOf('claimed.jobType === "PROPOSAL_GENERATION"');
    assert.ok(idx > -1);
    const region = runNext.slice(idx, idx + 800);
    assert.match(region, /jobType: "AUTO_FINALIZE"/);
    assert.match(region, /enqueueJob/);
    // Must NOT call runAutoFinalizeAfterGeneration inline.
    assert.doesNotMatch(region, /runAutoFinalizeAfterGeneration/);
  });

  it("run-next includes AUTO_FINALIZE in the break list", () => {
    assert.match(runNext, /"AUTO_FINALIZE"\]\.includes\(claimed\.jobType\)/);
  });

  it("run-next no longer imports runAutoFinalizeAfterGeneration", () => {
    // The inline import is removed — the handler lives in the job handler, not the route.
    assert.doesNotMatch(runNext, /import.*runAutoFinalizeAfterGeneration/);
  });
});
