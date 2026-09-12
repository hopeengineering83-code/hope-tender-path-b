// After a successful manual Run Engine the workflow reported "Processing
// automatically — the workflow is running" while sitting on "No documents have
// been generated yet" indefinitely. Nothing was broken about generation: the
// stage after Run Engine was simply never claimed by anyone.
//
// The claim loop in run-next is pinned to a single jobType for its whole run.
// The wake that starts it sets jobType=ENGINE_RUN, so the PROPOSAL_GENERATION
// job that same invocation enqueues cannot be claimed by that invocation. The
// request-scoped wakes covered EXTRACT_TEXT, VAULT_INGEST and ENGINE_RUN only,
// and the drain cron fires from the repository default branch — so on a Preview
// deployment nothing drained the continuation at all.
//
// These assertions pin the hand-off, and pin what it must never become: a way
// to reach the two manual gates without the owner.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const runNext = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");
const wake = readFileSync("lib/ai-jobs/request-scoped-worker-wake.ts", "utf8");

describe("worker continuation chain", () => {
  it("wakes the stage it just enqueued", () => {
    assert.match(runNext, /scheduleRequestScopedWorkerWake\(req, continuationJobType\)/);
    // The successor is taken from what was actually enqueued, not guessed.
    assert.match(runNext, /processedJobs[\s\S]{0,120}nextJobType/);
  });

  it("chains only the automatic post-Engine stages", () => {
    assert.match(wake, /RequestScopedContinuationJobType\s*=\s*"PROPOSAL_GENERATION"\s*\|\s*"AUTO_FINALIZE"/);
    const continuationType = wake.match(
      /export type RequestScopedContinuationJobType[^;]+;/,
    )?.[0] ?? "";
    assert.doesNotMatch(continuationType, /AI_ANALYZE|ENGINE_RUN/);
  });

  it("cannot start either manual gate", () => {
    // The chain may only carry forward authority the owner already gave. A
    // stage that was never enqueued cannot be claimed, and neither manual gate
    // is a permitted continuation target.
    const chainBlock = runNext.slice(runNext.indexOf("const continuationJobType"));
    assert.doesNotMatch(
      chainBlock.slice(0, chainBlock.indexOf("return NextResponse.json")),
      /"AI_ANALYZE"|"ENGINE_RUN"/,
      "the continuation hand-off must never target a manual gate",
    );
  });

  it("forwards the caller's own session rather than a worker secret", () => {
    // Presenting AI_JOBS_WORKER_SECRET or CRON_SECRET would make run-next treat
    // the woken request as an automated caller and hand it the recovery sweeps.
    assert.doesNotMatch(wake, /AI_JOBS_WORKER_SECRET|CRON_SECRET|x-worker-secret/i);
    assert.match(wake, /req\.headers\.get\("cookie"\)/);
  });

  it("never fails the owner's request when the nudge cannot be delivered", () => {
    assert.match(wake, /if \(!cookie\)[\s\S]*?return false/);
    assert.match(wake, /catch \(error\)/);
    assert.doesNotMatch(wake, /throw /);
  });
});
