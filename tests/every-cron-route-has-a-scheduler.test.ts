// A cron route nothing schedules is a recovery path that never fires.
//
// app/api/cron/ai-analyze-retry existed, was complete, was auth-hardened, and
// documented itself as "the server-side backstop that makes the durable retry
// actually fire without a browser open". Nothing called it. It was absent from
// vercel.json's crons and from every GitHub workflow.
//
// The consequence was specific. isDurableRetryJobType covers EXTRACT_TEXT,
// VAULT_INGEST, ENGINE_RUN, PROPOSAL_GENERATION and AUTO_FINALIZE — every
// pipeline stage except AI_ANALYZE, whose recovery lives behind that route
// instead. So a failed AI analysis was never retried by anything: one
// transient provider error stranded the tender for good, while the readiness
// surface still reported "processing automatically". An unattended run
// confirmed it — VAULT_INGEST, EXTRACT_TEXT, AI_ANALYZE:FAILED, queue empty,
// nothing re-armed.
//
// Being registered somewhere is a property of the repository, so it is checked
// here. A route counts as scheduled if it is in vercel.json's crons, named in
// a workflow, or invoked in-process by a route that is itself scheduled — the
// last is how cleanup-old-records runs, via cleanup-tender-storage.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CRON_DIR = "app/api/cron";
const WORKFLOW_DIR = ".github/workflows";

function cronRouteNames(): string[] {
  return readdirSync(CRON_DIR).filter((entry) => existsSync(join(CRON_DIR, entry, "route.ts")));
}

function vercelCronPaths(): string[] {
  const config = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons?: Array<{ path: string }> };
  return (config.crons ?? []).map((c) => c.path);
}

/**
 * Workflow YAML with comment lines removed.
 *
 * Comments must not count. The first version of this matched raw file text, so
 * deleting the step that calls the retry cron still "passed" — the explanatory
 * comment above it mentioned the path. A prose mention schedules nothing.
 */
function workflowText(): string {
  if (!existsSync(WORKFLOW_DIR)) return "";
  return readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => readFileSync(join(WORKFLOW_DIR, f), "utf8"))
    .join("\n")
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

/** Cron routes imported and invoked by another cron route. */
function invokedInProcess(): Set<string> {
  const out = new Set<string>();
  for (const name of cronRouteNames()) {
    const src = readFileSync(join(CRON_DIR, name, "route.ts"), "utf8");
    for (const match of src.matchAll(/from\s+["']\.\.\/([a-z0-9-]+)\/route["']/g)) {
      out.add(match[1]);
    }
  }
  return out;
}

const ROUTES = cronRouteNames();
const VERCEL = vercelCronPaths();
const WORKFLOWS = workflowText();
const IN_PROCESS = invokedInProcess();

describe("the scheduler check is not vacuous", () => {
  it("finds cron routes, a vercel cron list, and workflow text", () => {
    assert.ok(ROUTES.length >= 3, `expected several cron routes, found ${ROUTES.length}`);
    assert.ok(VERCEL.length >= 1, "vercel.json must declare at least one cron");
    assert.ok(WORKFLOWS.includes("run-next"), "workflow text must be loaded");
  });

  it("ignores commented-out and merely-mentioned paths", () => {
    // The hole this closes: matching raw file text meant a comment naming a
    // route counted as scheduling it, so deleting the real step still passed.
    assert.ok(
      !WORKFLOWS.includes("# AI_ANALYZE is the one pipeline stage"),
      "comment lines must be stripped before matching",
    );
  });

  it("recognises the in-process invocation that keeps cleanup-old-records alive", () => {
    // If this detection broke, cleanup-old-records would look orphaned and the
    // real signal would be lost in a false positive.
    assert.ok(
      IN_PROCESS.has("cleanup-old-records"),
      "cleanup-tender-storage imports cleanup-old-records; the detector must see it",
    );
  });
});

describe("every cron route is reachable by some scheduler", () => {
  for (const name of ROUTES) {
    it(`${name} is scheduled`, () => {
      const scheduledByVercel = VERCEL.some((p) => p === `/api/cron/${name}`);
      const scheduledByWorkflow = WORKFLOWS.includes(`/api/cron/${name}`);
      const scheduledInProcess = IN_PROCESS.has(name);

      assert.ok(
        scheduledByVercel || scheduledByWorkflow || scheduledInProcess,
        `app/api/cron/${name} is never invoked: absent from vercel.json crons, from every ` +
          `workflow, and not called by another cron route. Either schedule it or delete it — ` +
          `a recovery path that cannot fire is worse than none, because the UI reports the ` +
          `work as still in progress.`,
      );
    });
  }
});

describe("AI_ANALYZE specifically has a retry driver", () => {
  it("is excluded from the durable-stage retry policy", () => {
    // The premise. If AI_ANALYZE were ever added to isDurableRetryJobType, the
    // dedicated cron would become a second retry authority and this test's
    // reasoning would need revisiting rather than silently passing.
    const policy = readFileSync("lib/engine/stage-retry-policy.ts", "utf8");
    const guard = policy.slice(policy.indexOf("export function isDurableRetryJobType"));
    assert.ok(
      !guard.slice(0, 400).includes('"AI_ANALYZE"'),
      "AI_ANALYZE is now in the durable retry path; reconcile it with the ai-analyze-retry cron " +
        "so there are not two competing retry authorities",
    );
  });

  it("is therefore driven by the ai-analyze-retry cron", () => {
    assert.ok(
      WORKFLOWS.includes("/api/cron/ai-analyze-retry") ||
        VERCEL.includes("/api/cron/ai-analyze-retry"),
      "nothing schedules /api/cron/ai-analyze-retry, so a failed AI analysis is never retried",
    );
  });
});
