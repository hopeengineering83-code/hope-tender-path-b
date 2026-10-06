// A durable job re-armed for a short back-off must not wait for the external
// drain. The drain runs from the default branch against Production only, and
// GitHub has run it hours apart; with the browser closed, a 30-second retry
// re-armed near the end of a worker invocation sat QUEUED until then.
//
// Pinned: the worker waits for a re-armed job when the back-off fits its
// budget, otherwise spends its spare time and hands the job to one fresh
// worker through the same authenticated dispatcher a continuation uses — which
// can only nudge a job that already exists, never create one or start a manual
// gate.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

import { scheduleRetryWorkerWake } from "../lib/ai-jobs/request-scoped-worker-wake";

const code = readFileSync("app/api/ai-jobs/run-next/route.ts", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("a retry the worker cannot wait for is handed on", () => {
  it("waits for a re-armed job that is not yet due when the back-off fits", () => {
    const empty = code.slice(code.indexOf("if (!claimed) {"), code.indexOf("const handler = getHandler"));
    assert.match(empty, /status: "QUEUED"/);
    assert.match(empty, /nextAttemptAt: \{ gt: new Date\(\) \}/);
    assert.match(empty, /shouldWaitOutRetry\(waitMs, remaining\)/);
    assert.match(empty, /pendingRetry = \{ jobType: waiting\.jobType, tenderId: waiting\.tenderId \}/);
  });

  it("hands an un-waited retry to a fresh worker after the loop", () => {
    assert.match(code, /if \(retryWaitMs !== null\) pendingRetry = /);
    assert.match(code, /if \(pendingRetry\) \{\s*const woke = scheduleRetryWorkerWake\(req, pendingRetry\.jobType, pendingRetry\.tenderId\)/);
  });

  it("the wake goes through the authenticated dispatcher with the tender, and needs a session", async () => {
    const tasks: Array<() => Promise<void>> = [];
    const calls: string[] = [];
    const req = new Request("https://app.example/api/ai-jobs/run-next?jobType=ENGINE_RUN", { headers: { cookie: "session=abc" } });
    const fetcher = (async (url: URL | RequestInfo) => { calls.push(String(url)); return new Response(null, { status: 202 }); }) as typeof fetch;
    assert.equal(scheduleRetryWorkerWake(req, "ENGINE_RUN", "t-1", (t) => tasks.push(t), fetcher), true);
    await Promise.all(tasks.map((t) => t()));
    assert.deepEqual(calls, ["https://app.example/api/ai-jobs/dispatch?jobType=ENGINE_RUN&tenderId=t-1"]);
    const anonymous = new Request("https://app.example/api/ai-jobs/run-next");
    assert.equal(scheduleRetryWorkerWake(anonymous, "ENGINE_RUN", "t-1", (t) => tasks.push(t), fetcher), false);
  });
});
