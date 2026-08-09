import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { scheduleRequestScopedEngineWorkerWake } from "../lib/ai-jobs/request-scoped-engine-worker-wake";

test("Run Engine once: one QUEUED job is woken, claimed, and succeeds without a duplicate", async () => {
  const route = readFileSync("app/api/tenders/[id]/engine/route.ts", "utf8");
  const enqueue = readFileSync("lib/engine/enqueue-engine-job.ts", "utf8");
  const claim = readFileSync("lib/job-claim-policy.ts", "utf8");
  let status: "QUEUED" | "RUNNING" | "SUCCEEDED" = "QUEUED";
  let wakes = 0;
  let scheduled: (() => Promise<void>) | undefined;

  const accepted = scheduleRequestScopedEngineWorkerWake(
    new Request("https://example.test/api/tenders/tender-1/engine", { headers: { cookie: "session=owner" } }),
    "tender-1",
    (task) => { scheduled = task; },
    async (input) => {
      wakes += 1;
      assert.equal(String(input), "https://example.test/api/ai-jobs/run-next?jobType=ENGINE_RUN&tenderId=tender-1");
      assert.equal(status, "QUEUED");
      status = "RUNNING";
      status = "SUCCEEDED";
      return new Response(null, { status: 200 });
    },
  );

  assert.equal(accepted, true);
  assert.equal(wakes, 0, "the response path must only schedule the server-owned wake");
  assert.ok(scheduled);
  await scheduled();
  assert.equal(wakes, 1);
  assert.equal(status, "SUCCEEDED");

  assert.match(route, /enqueueEngineJobForCurrentSources/);
  assert.match(route, /enqueueResult\.status === "QUEUED"[\s\S]*scheduleRequestScopedEngineWorkerWake\(req, id\)/);
  assert.match(enqueue, /reusedActiveJob:\s*true/);
  assert.match(claim, /"status" = 'QUEUED'[\s\S]*SET "status" = 'RUNNING'[\s\S]*FOR UPDATE SKIP LOCKED/);
});
