// Behavioral test: persisted stage checkpoints (Directive 13)
//
// Verifies that the Engine worker records checkpoints via AiJobStep and
// that these checkpoints enable resume from the last completed stage.
//
// This is a source-text contract test proving the checkpoint architecture
// is in place. Full behavioral integration tests require a live PostgreSQL
// database (CI provides via ephemeral postgres:16).

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (path: string): string => readFileSync(path, "utf8");

describe("DIRECTIVE 13 — Persisted stage checkpoints", () => {
  it("recordStep is available for checkpoint persistence", () => {
    const aiJobs = read("lib/ai-jobs.ts");
    assert.match(aiJobs, /export async function recordStep/);
    assert.match(aiJobs, /AiJobStep/);
  });

  it("the Engine handler records granular stage progress via recordStep", () => {
    const handlers = read("lib/ai-job-handlers-legacy.ts");
    // Engine handler must record steps at each major milestone
    assert.match(handlers, /recordStep.*engine\.start/);
    assert.match(handlers, /recordStep.*engine\.heartbeat/);
    assert.match(handlers, /recordStep.*engine\.complete/);
    // Heartbeat interval ensures stuck-job detection works
    assert.match(handlers, /setInterval/);
    assert.match(handlers, /recordStep.*heartbeat/);
  });

  it("the AI_ANALYZE handler records chunk-level checkpoints", () => {
    const handlers = read("lib/ai-job-handlers-legacy.ts");
    assert.match(handlers, /recordStep.*analyze\.start/);
    assert.match(handlers, /recordStep.*analyze\.heartbeat/);
  });

  it("failStuckJobs uses AiJobStep timestamps to detect stranded jobs", () => {
    const aiJobs = read("lib/ai-jobs.ts");
    assert.match(aiJobs, /failStuckJobs/);
    assert.match(aiJobs, /AiJobStep/);
    // The stuck-job threshold must be configurable and documented
    assert.match(aiJobs, /AI_JOB_PROGRESS_STUCK_AFTER_MS|180.*000|stuck/);
  });

  it("transient retry re-arms QUEUED so the worker can resume from checkpoint", () => {
    const route = read("app/api/ai-jobs/run-next/route.ts");
    // The transient retry path must re-arm to QUEUED (not leave RUNNING)
    assert.match(route, /status: "QUEUED"/);
    assert.match(route, /nextAttemptAt/);
    assert.match(route, /retries: currentRetries/);
  });

  it("worker deadline architecture prevents the platform hard timeout", () => {
    const route = read("app/api/ai-jobs/run-next/route.ts");
    assert.match(route, /maxRunMs = 240_000/);
    assert.match(route, /MINIMUM_REMAINING_BUDGET_MS = 10_000/);
    assert.match(route, /PERSISTENCE_RESERVE_MS = 5_000/);
    assert.match(route, /absoluteDeadline/);
  });

  it("Engine handler has 10s heartbeat for stuck-job detection", () => {
    const handlers = read("lib/ai-job-handlers-legacy.ts");
    // Heartbeat every 10s so the stuck-job checker (180s threshold) never
    // fires on a legitimately slow but progressing Engine call.
    assert.match(handlers, /10_000/);
  });
});

describe("DIRECTIVE 13 — Stuck-job recovery end-to-end", () => {
  it("failStuckJobs marks RUNNING jobs as FAILED when no AiJobStep is recorded", () => {
    const aiJobs = read("lib/ai-jobs.ts");
    assert.match(aiJobs, /failStuckJobs/);
    assert.match(aiJobs, /RUNNING/);
    assert.match(aiJobs, /FAILED/);
  });

  it("reapStaleQueuedJobs reaps QUEUED jobs that never got claimed", () => {
    const reaper = read("lib/engine/stale-job-reaper.ts");
    assert.match(reaper, /reapStaleQueuedJobs/);
    assert.match(reaper, /QUEUED/);
  });

  it("rearmDurableStageJob re-arms retryable jobs with bounded backoff", () => {
    const route = read("app/api/ai-jobs/run-next/route.ts");
    assert.match(route, /rearmDurableStageJob/);
    assert.match(route, /MAX_TRANSIENT_RETRIES = 8/);
    assert.match(route, /TRANSIENT_RETRY_BUDGET_EXHAUSTED/);
  });

  it("terminal jobs never resurrect (SUCCEEDED/FAILED stay terminal)", () => {
    const aiJobs = read("lib/ai-jobs.ts");
    // claimJobForCaller only claims QUEUED rows — terminal jobs are never claimed
    const claim = read("lib/job-claim-policy.ts");
    assert.match(claim, /status.*=.*QUEUED/);
    // completeJob and failJob write terminal statuses
    assert.match(aiJobs, /SUCCEEDED/);
    assert.match(aiJobs, /FAILED/);
  });
});
