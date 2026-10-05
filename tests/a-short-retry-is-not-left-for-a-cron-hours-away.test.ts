/**
 * A short retry is waited out in the invocation that scheduled it.
 *
 * 2026-10-05: a stage that hit a transient provider error was re-armed QUEUED
 * with a 2-60 s (or 30 s-10 min) back-off and left for "the next worker
 * invocation". With no browser open, that is the scheduled drain, which GitHub
 * ran every 3-7 hours in practice, so a 30-second back-off became an
 * afternoon and the owner's "automatic" pipeline sat still.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const route = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8");

describe("the worker waits out a short retry it scheduled", () => {
  it("records the back-off of both re-arm paths", () => {
    assert.match(route, /retryWaitMs = backoffSeconds \* 1000;/);
    assert.match(route, /if \(retryScheduled\) retryWaitMs = decision\.delayMs;/);
  });

  it("waits only when a working window remains, then claims the same stage again", () => {
    const at = route.indexOf("[run-next] Waiting out a short retry back-off in this invocation");
    assert.ok(at > 0);
    const block = route.slice(route.lastIndexOf("if (retryWaitMs !== null", at), route.indexOf("break;", at));
    assert.match(block, /shouldWaitOutRetry\(retryWaitMs, absoluteDeadline - Date\.now\(\)\)/);
    assert.match(block, /activeJobType = claimed\.jobType/);
    assert.match(block, /continue;/);
    assert.match(route, /remainingMs - retryWaitMs - RETRY_WAIT_MARGIN_MS >= RETRY_MIN_WORK_AFTER_WAIT_MS/);
  });

  it("resets the wait for every claimed job", () => {
    assert.match(route, /let retryWaitMs: number \| null = null;\n\n    const claimed = await claimJobForCaller/);
  });
});
