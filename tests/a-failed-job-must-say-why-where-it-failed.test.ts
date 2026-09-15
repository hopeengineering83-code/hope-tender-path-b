import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * THE DEFECT, read off acceptance run 34978972693.
 * ------------------------------------------------
 * AI Analyze failed. The run reported this, in full:
 *
 *   AI_ANALYZE FAILED id=01b06b0f-... created=... finished=...
 *     error=(no failure detail returned)
 *
 * and then continued — snapshotting readiness, recording a baseline artifact
 * hash — before dying twenty seconds later at a completely different step:
 *
 *   {"error":"Run Engine requires a successful manual AI Analyze result ...",
 *    "code":"CURRENT_ANALYSIS_REQUIRED"} ---STATUS:422---
 *
 * Two independent faults, both about a cause being unreadable where it occurs.
 *
 * FAULT 1 — the reader asked for fields the producer has never sent.
 * GET /api/ai-jobs serialises `listUserJobs`, whose select lists exactly one
 * failure column: `errorMessage`. The summariser read `error` and `result`, so
 * EVERY failed job printed "(no failure detail returned)" no matter what the
 * worker recorded. The provider-exhaustion text — the line that names which
 * providers were contacted and how each failed, which the entire AI-routing
 * investigation depends on — was written to that field and reported as absent
 * every single time. A diagnostic that answers "nothing to report" when it
 * simply looked in the wrong place is worse than one that is missing, because
 * it ends the enquiry instead of prompting it.
 *
 * This is the same reader/producer drift that had already sent a read to
 * `tenders` on a payload keyed `items`, and to a documents route that does not
 * exist. The test below ties the reader to the producer so the drift cannot
 * recur silently.
 *
 * FAULT 2 — the wait settled on terminality, and FAILED is terminal.
 * "Wait for AI Analyze to reach a terminal state" did what its name says and
 * passed. Nothing between it and Run Engine asked whether the analysis was
 * USABLE, so an AI Analyze failure surfaced as an engine error two steps later.
 * The gate added here reads the product's own verdict — tender-release-snapshot
 * already decides release-readiness and publishes it on workflow-center — so
 * the harness cannot enforce a policy stricter or looser than the engine it is
 * meant to be testing.
 */

const summarizer = readFileSync("scripts/tmp-summarize-tender-jobs.py", "utf8");
const workflow = readFileSync(".github/workflows/lockfile-refresh-artifact.yml", "utf8");
const aiJobs = readFileSync("lib/ai-jobs.ts", "utf8");

/**
 * Comments are where these files EXPLAIN the rules they must not re-implement,
 * so every "must not contain" assertion below reads executable lines only.
 * Without this, a faithful comment about the old wording, or about the rule the
 * harness deliberately defers to, fails the very test that protects it.
 */
function codeOnly(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

/** The `select: { ... }` of listUserJobs — the producer's actual field list. */
function listUserJobsSelectedFields(): string[] {
  const fn = aiJobs.slice(aiJobs.indexOf("export async function listUserJobs"));
  const select = fn.slice(fn.indexOf("select:"), fn.indexOf("});"));
  return Array.from(select.matchAll(/(\w+):\s*true/g)).map((m) => m[1]);
}

describe("a failed job must say why, where it failed", () => {
  it("the producer exposes the failure cause as errorMessage and under no other name", () => {
    const fields = listUserJobsSelectedFields();
    assert.ok(
      fields.includes("errorMessage"),
      `listUserJobs must select errorMessage; it selects: ${fields.join(", ")}`,
    );
    // If the producer ever grew a second failure-ish column, a reader could
    // pick the wrong one and be quietly right for the wrong reason.
    for (const alias of ["error", "result", "failureMessage", "lastError"]) {
      assert.ok(
        !fields.includes(alias),
        `listUserJobs unexpectedly selects "${alias}" — update the readers deliberately, not by accident`,
      );
    }
  });

  it("the summariser reads the field the producer actually sends", () => {
    const failureBranch = summarizer.slice(summarizer.indexOf('if j.get("status") in'));
    assert.match(
      failureBranch,
      /detail\s*=\s*j\.get\("errorMessage"\)/,
      "the summariser must read errorMessage FIRST — the only failure field /api/ai-jobs sends",
    );
    assert.doesNotMatch(
      failureBranch,
      /j\.get\("error"\)\s*or\s*j\.get\("result"\)\s*or\s*"\(no failure detail returned\)"/,
      "the original error/result-only read must not come back",
    );
  });

  it("every key the summariser reads off a job row is a key the producer sends", () => {
    const fields = new Set(listUserJobsSelectedFields());
    // Alternates are tolerated as alternates, never as the primary read, so
    // only the FIRST key of the failure lookup is required to be real.
    const read = Array.from(summarizer.matchAll(/j\.get\("(\w+)"\)/g)).map((m) => m[1]);
    const primary = ["jobType", "status", "id", "createdAt", "finishedAt", "errorMessage"];
    for (const key of primary) {
      assert.ok(read.includes(key), `summariser should read ${key}`);
      assert.ok(fields.has(key), `summariser reads "${key}", which listUserJobs does not select`);
    }
  });

  it("a job that recorded no detail is reported differently from one that was never read", () => {
    assert.match(
      summarizer,
      /\(job recorded no failure detail\)/,
      "the fallback must say the JOB recorded nothing — not that nothing was returned",
    );
    assert.doesNotMatch(
      codeOnly(summarizer),
      /\(no failure detail returned\)/,
      "the old wording blamed the response for the reader's own miss",
    );
  });

  it("the acceptance run stops at AI Analyze when the analysis is not release-ready", () => {
    const gate = workflow.slice(
      workflow.indexOf("Require AI Analyze to be release-ready before Run Engine"),
    );
    assert.ok(gate.length > 0, "the release-readiness gate step must exist");
    const body = gate.slice(0, gate.indexOf("- name:", 1));
    assert.match(body, /analysis.*blocker|blocker.*analysis/s, "the gate must read the analysis blocker");
    assert.match(body, /raise SystemExit/, "the gate must fail the run, not merely log");
    assert.match(
      body,
      /errorMessage/,
      "the gate must print the durable per-job cause alongside the product's verdict",
    );
  });

  it("the gate runs before Run Engine is triggered", () => {
    const gateAt = workflow.indexOf("Require AI Analyze to be release-ready before Run Engine");
    const engineAt = workflow.indexOf("Trigger Run Engine (manual, owner-authorized)");
    assert.ok(gateAt > 0 && engineAt > 0, "both steps must exist");
    assert.ok(
      gateAt < engineAt,
      "a gate that runs after the step it protects explains the failure too late to prevent it",
    );
  });

  it("the gate takes the product's verdict instead of re-deriving one", () => {
    const gate = workflow.slice(
      workflow.indexOf("Require AI Analyze to be release-ready before Run Engine"),
    );
    const body = gate.slice(0, gate.indexOf("- name:", 1));
    // Re-implementing "AI_SUCCEEDED and canonicalJobId and contentHashMatch"
    // here is how a harness drifts away from the engine it is testing.
    assert.doesNotMatch(
      codeOnly(body),
      /AI_SUCCEEDED/,
      "release-readiness is tender-release-snapshot's decision; the harness must read it, not restate it",
    );
    assert.doesNotMatch(codeOnly(body), /contentHashMatch\s*[=!]=/, "same — do not re-derive the hash rule");
  });

  it("the diagnostic carries no tender-specific, client-specific or sector-specific special case", () => {
    for (const [name, text] of [["summariser", summarizer]] as const) {
      assert.doesNotMatch(text, /pharo/i, `${name} must not name a benchmark client`);
      assert.doesNotMatch(text, /22b5e12e/i, `${name} must not hard-code a tender id`);
      assert.doesNotMatch(text, /health(care)?\b.*special/i, `${name} must not special-case a sector`);
    }
  });
});
