// On Vercel Pro the queue is drained by Vercel Cron, not GitHub Actions.
//
// The GitHub drain workflow was the Hobby-plan workaround (Vercel Hobby allows
// only daily crons). It targeted the Production URL from `main` and in
// practice fired hours apart. Normal operation now depends only on
// vercel.json's crons; the workflow stays as a manual/emergency drain.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";

const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons?: Array<{ path: string; schedule: string }> };
const drain = readFileSync(".github/workflows/drain-ai-job-queue.yml", "utf8");
const codeOnly = (yaml: string) => yaml.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");

describe("the queue scheduler is Vercel-native", () => {
  it("Vercel Cron drains the queue every minute and re-arms AI Analyze retries", () => {
    const crons = new Map((vercel.crons ?? []).map((c) => [c.path, c.schedule]));
    assert.equal(crons.get("/api/ai-jobs/run-next"), "* * * * *");
    assert.equal(crons.get("/api/cron/ai-analyze-retry"), "*/5 * * * *");
  });

  it("both cron routes accept the Vercel Cron bearer", () => {
    for (const route of ["app/api/ai-jobs/run-next/route.ts", "app/api/cron/ai-analyze-retry/route.ts"]) {
      const src = readFileSync(route, "utf8");
      assert.match(src, /process\.env\.CRON_SECRET/, route);
      assert.match(src, /Bearer \$\{cronSecret\}/, route);
      assert.match(src, /cronSecret\.length >= 16/, `${route} refuses a short or missing CRON_SECRET`);
    }
  });

  it("the GitHub drain is manual only — no schedule", () => {
    assert.doesNotMatch(codeOnly(drain), /^\s*schedule:/m);
    assert.match(codeOnly(drain), /workflow_dispatch:/);
  });

  // Release check. GitHub runs schedules only from the default branch, so the
  // Hobby-era */5 drain keeps running on `main` until this release reaches it.
  // Once it does, no workflow may bring a scheduled queue driver back under
  // another name: the queue has one scheduler, Vercel Cron.
  it("no scheduled workflow drives the job queue or the AI Analyze retry", () => {
    const dir = ".github/workflows";
    for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
      const code = codeOnly(readFileSync(`${dir}/${file}`, "utf8"));
      if (!/^\s*schedule:/m.test(code)) continue;
      assert.doesNotMatch(code, /\/api\/ai-jobs\/run-next|\/api\/cron\/ai-analyze-retry/, `${file} is scheduled and drives the queue`);
    }
  });

  it("the release runbook says merging removes main's scheduled drain", () => {
    const runbook = readFileSync("docs/PRODUCTION_RELIABILITY_RUNBOOK.md", "utf8");
    assert.match(runbook, /removes the scheduled GitHub drain/);
    assert.match(runbook, /CRON_SECRET/);
    assert.match(runbook, /no duplicate/i);
  });
});

describe("the admin diagnostics say whether the scheduler can authenticate", () => {
  it("reports booleans, never the secret", async () => {
    const { schedulerReadiness } = await import("../lib/liveness");
    const secret = "s".repeat(32);
    const ready = schedulerReadiness({ CRON_SECRET: secret, AI_JOBS_WORKER_SECRET: "", VERCEL_ENV: "production" });
    assert.deepEqual(ready, { cronSecretConfigured: true, workerSecretConfigured: false, vercelCronRunsHere: true });
    assert.equal(JSON.stringify(ready).includes(secret), false);
    assert.equal(schedulerReadiness({ CRON_SECRET: "short", VERCEL_ENV: "preview" }).cronSecretConfigured, false);
  });
});
