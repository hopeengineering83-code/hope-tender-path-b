// Reported live: the owner pressed Run AI Analyze and the panel sat on
// "AI Analyze is queued" for minutes on end.
//
// It was telling the truth. The route created the job under verified manual
// authority and then nothing claimed it. Run Engine has had a request-scoped
// wake since it was written; AI Analyze never did. The upload wakes are
// forbidden from naming a manual gate, and the drain cron fires only from the
// repository default branch, so on a Preview deployment the job stayed QUEUED
// indefinitely.
//
// These tests drive the real wake with an injected scheduler and fetch, so they
// prove what the request actually sends rather than that a symbol appears in a
// file.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import {
  scheduleRequestScopedAnalyzeWorkerWake,
  scheduleRequestScopedEngineWorkerWake,
} from "../lib/ai-jobs/request-scoped-engine-worker-wake";

function request(cookie: string | null = "session=abc"): Request {
  return new Request("https://preview.example.test/api/tenders/t-1/manual-ai-analyze", {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
}

/** Runs the scheduled task immediately and records the worker call. */
function capture() {
  const calls: Array<{ url: URL; headers: Record<string, string> }> = [];
  const tasks: Array<() => Promise<void>> = [];
  const fetchWorker = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({
      url: new URL(String(input)),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return {
    calls,
    schedule: (task: () => Promise<void>) => { tasks.push(task); },
    run: async () => { for (const task of tasks) await task(); },
    fetchWorker,
  };
}

describe("a manually authorized AI Analyze wakes its own worker", () => {
  it("asks the worker for AI_ANALYZE on this tender", async () => {
    const c = capture();
    const scheduled = scheduleRequestScopedAnalyzeWorkerWake(request(), "t-1", c.schedule, c.fetchWorker);
    await c.run();

    assert.equal(scheduled, true);
    assert.equal(c.calls.length, 1, "exactly one wake — the atomic claim owns QUEUED to RUNNING");
    assert.equal(c.calls[0].url.pathname, "/api/ai-jobs/dispatch");
    assert.equal(
      c.calls[0].url.searchParams.get("jobType"),
      "AI_ANALYZE",
      "without this the job the owner authorized is never claimed",
    );
    assert.equal(c.calls[0].url.searchParams.get("tenderId"), "t-1");
  });

  it("still wakes ENGINE_RUN for the Engine route, unchanged", async () => {
    const c = capture();
    scheduleRequestScopedEngineWorkerWake(request(), "t-2", c.schedule, c.fetchWorker);
    await c.run();

    assert.equal(c.calls[0].url.searchParams.get("jobType"), "ENGINE_RUN");
    assert.equal(c.calls[0].url.searchParams.get("tenderId"), "t-2");
  });

  it("forwards the caller's own session and never a worker secret", async () => {
    // Presenting AI_JOBS_WORKER_SECRET or CRON_SECRET would make run-next treat
    // the woken request as an automated caller and hand it the recovery sweeps.
    const c = capture();
    scheduleRequestScopedAnalyzeWorkerWake(request("session=abc"), "t-1", c.schedule, c.fetchWorker);
    await c.run();

    assert.equal(c.calls[0].headers.cookie, "session=abc");
    const source = readFileSync("lib/ai-jobs/request-scoped-engine-worker-wake.ts", "utf8");
    assert.doesNotMatch(source, /AI_JOBS_WORKER_SECRET|CRON_SECRET|x-worker-secret/i);
  });

  it("never fails the owner's request when the nudge cannot be delivered", async () => {
    // No session cookie: the wake declines rather than throwing, so the owner
    // still gets their job id back and the panel still polls it.
    const scheduled = scheduleRequestScopedAnalyzeWorkerWake(request(null), "t-1", () => {}, (async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch);

    assert.equal(scheduled, false);
  });

  it("is actually called by the manual AI Analyze route after the job is created", async () => {
    const route = readFileSync("app/api/tenders/[id]/manual-ai-analyze/route.ts", "utf8");
    assert.match(route, /scheduleRequestScopedAnalyzeWorkerWake\(req, tenderId\)/);
    // Order matters: the wake must follow job creation, or there is nothing to claim.
    assert.ok(
      route.indexOf("createAnalysisJob(") < route.indexOf("scheduleRequestScopedAnalyzeWorkerWake("),
      "the wake must come after the authorized job row exists",
    );
  });
});
