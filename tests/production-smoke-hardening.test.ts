import { test } from "node:test";
import assert from "node:assert";
import { GET as healthGET } from "../app/api/health/route";
import { GET as alertsGET } from "../app/api/cron/deadline-alerts/route";
import { GET as cleanupGET } from "../app/api/cron/cleanup-old-records/route";
import { POST as runNextPOST } from "../app/api/ai-jobs/run-next/route";
import { NextRequest } from "next/server";

test("health route returns 200 or 503", async () => {
  const res = await healthGET();
  // We expect 503 if DB is not reachable in test env, which is fine
  assert.ok(res.status === 200 || res.status === 503);
});

test("cron routes reject missing or short CRON_SECRET", async () => {
  const req = new NextRequest("http://localhost/api/cron/deadline-alerts");
  // No auth header
  const res1 = await alertsGET(req);
  assert.strictEqual(res1.status, 401);

  const req2 = new NextRequest("http://localhost/api/cron/deadline-alerts", {
    headers: { authorization: "Bearer too-short" }
  });
  process.env.CRON_SECRET = "too-short";
  const res2 = await alertsGET(req2);
  assert.strictEqual(res2.status, 401);

  const req3 = new NextRequest("http://localhost/api/cron/cleanup-old-records", {
    headers: { authorization: "Bearer too-short" }
  });
  const res3 = await cleanupGET(req3);
  assert.strictEqual(res3.status, 401);
});

test("ai-jobs worker rejects missing or short secrets", async () => {
  const req = new NextRequest("http://localhost/api/ai-jobs/run-next", { method: "POST" });
  // No auth
  const res1 = await runNextPOST(req);
  assert.strictEqual(res1.status, 401);

  const req2 = new NextRequest("http://localhost/api/ai-jobs/run-next", {
    method: "POST",
    headers: { "x-worker-secret": "too-short" }
  });
  process.env.AI_JOBS_WORKER_SECRET = "too-short";
  const res2 = await runNextPOST(req2);
  assert.strictEqual(res2.status, 401);
});
