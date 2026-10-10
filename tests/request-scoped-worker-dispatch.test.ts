import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { dispatchWorkerRequest } from "../lib/ai-jobs/worker-dispatch";
import {
  scheduleRequestScopedAnalyzeWorkerWake,
  scheduleRequestScopedEngineWorkerWake,
} from "../lib/ai-jobs/request-scoped-engine-worker-wake";
import { scheduleRequestScopedWorkerWake } from "../lib/ai-jobs/request-scoped-worker-wake";

type Task = () => Promise<void>;

function request(path: string): Request {
  return new Request(`https://preview.example.test${path}`, {
    method: "POST",
    headers: {
      cookie: "session=test-session",
      origin: "https://preview.example.test",
      referer: "https://preview.example.test/dashboard/tenders/tender-1",
      "x-requested-with": "XMLHttpRequest",
    },
  });
}

describe("request-scoped durable worker dispatcher", () => {
  it("returns 202 before the long worker fetch runs", async () => {
    const scheduled: Task[] = [];
    const workerCalls: Array<{ url: string; init?: RequestInit }> = [];

    const response = await dispatchWorkerRequest(
      request("/api/ai-jobs/dispatch?jobType=ENGINE_RUN&tenderId=tender-1"),
      {
        authorize: async () => ({ id: "owner-1" }),
        schedule: (task) => scheduled.push(task),
        fetchWorker: async (input, init) => {
          workerCalls.push({ url: String(input), init });
          return new Response(JSON.stringify({ processed: 1 }), { status: 200 });
        },
      },
    );

    assert.equal(response.status, 202);
    assert.equal(workerCalls.length, 0, "dispatcher response must not await the long worker");
    assert.equal(scheduled.length, 1);

    await scheduled[0]();
    assert.equal(workerCalls.length, 1);
    const target = new URL(workerCalls[0].url);
    assert.equal(target.pathname, "/api/ai-jobs/run-next");
    assert.equal(target.searchParams.get("jobType"), "ENGINE_RUN");
    assert.equal(target.searchParams.get("tenderId"), "tender-1");
    assert.notEqual(target.pathname, "/api/ai-jobs/dispatch", "dispatcher must never recurse into itself");
  });

  it("rejects unsupported dispatches and manual gates without tender scope", async () => {
    const deps = {
      authorize: async () => ({ id: "owner-1" }),
      schedule: (_task: Task) => undefined,
      fetchWorker: async () => new Response(null, { status: 200 }),
    };

    const unsupported = await dispatchWorkerRequest(
      request("/api/ai-jobs/dispatch?jobType=SOMETHING_ELSE"),
      deps,
    );
    assert.equal(unsupported.status, 400);

    const unscopedEngine = await dispatchWorkerRequest(
      request("/api/ai-jobs/dispatch?jobType=ENGINE_RUN"),
      deps,
    );
    assert.equal(unscopedEngine.status, 400);
  });

  it("manual Engine and AI Analyze wakes target only the short dispatcher", async () => {
    for (const [kind, scheduleWake] of [
      ["ENGINE_RUN", scheduleRequestScopedEngineWorkerWake],
      ["AI_ANALYZE", scheduleRequestScopedAnalyzeWorkerWake],
    ] as const) {
      const scheduled: Task[] = [];
      const calls: string[] = [];
      const accepted = scheduleWake(
        request("/api/tenders/tender-1/engine"),
        "tender-1",
        (task) => scheduled.push(task),
        async (input) => {
          calls.push(String(input));
          return new Response(null, { status: 202 });
        },
      );

      assert.equal(accepted, true);
      assert.equal(calls.length, 0);
      assert.equal(scheduled.length, 1);
      await scheduled[0]();
      assert.equal(calls.length, 1);
      const target = new URL(calls[0]);
      assert.equal(target.pathname, "/api/ai-jobs/dispatch");
      assert.equal(target.searchParams.get("jobType"), kind);
      assert.equal(target.searchParams.get("tenderId"), "tender-1");
      assert.notEqual(target.pathname, "/api/ai-jobs/run-next");
    }
  });

  it("automatic post-Engine continuations also hand off through the dispatcher", async () => {
    const scheduled: Task[] = [];
    const calls: string[] = [];
    const accepted = scheduleRequestScopedWorkerWake(
      request("/api/ai-jobs/run-next"),
      "AUTO_FINALIZE",
      1,
      (task) => scheduled.push(task),
      async (input) => {
        calls.push(String(input));
        return new Response(null, { status: 202 });
      },
    );

    assert.equal(accepted, true);
    assert.equal(calls.length, 0);
    assert.equal(scheduled.length, 1);
    await scheduled[0]();
    const target = new URL(calls[0]);
    assert.equal(target.pathname, "/api/ai-jobs/dispatch");
    assert.equal(target.searchParams.get("jobType"), "AUTO_FINALIZE");
  });
});
