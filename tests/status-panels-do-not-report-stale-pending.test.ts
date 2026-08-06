// A status heading derived only from client polling lies on every fresh load.
//
// components/ai-analyze-panel.tsx computed:
//
//   const analysisComplete = jobStatus === "SUCCEEDED";
//
// `jobStatus` is React state owned by that component, initialised to null. It
// is only ever set while THAT browser session polls a running job. So after a
// reload — or for any analysis completed in an earlier session, which is the
// normal case — it stayed null and the heading fell through to
// "Pending automatic analysis".
//
// The owner hit this in production preview: a finished analysis reporting
// "Analysis source: AI · 100/100 · produced by AI provider" rendered directly
// under a heading saying it was still pending, and reasonably concluded the
// app was broken. Nothing was broken. The panel could not see its own success.
//
// This is the same defect class that made components/engine-action-panel.tsx a
// permanently stale status surface (deleted in e2ec8e74): a panel reporting
// progress it structurally cannot observe. The rule this file enforces is that
// a completion heading must be able to reach its "complete" branch from
// SERVER-KNOWN state, not only from a live poll in the current session.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const panel = readFileSync("components/ai-analyze-panel.tsx", "utf8");
const page = readFileSync("app/dashboard/tenders/[id]/page.tsx", "utf8");

describe("AI Analyze completion is derived from server state, not only polling", () => {
  it("accepts a server-known completion fact", () => {
    assert.match(
      panel,
      /analysisAlreadySucceeded/,
      "the panel must accept a server-known completion fact; without one it cannot " +
        "distinguish 'not started' from 'finished before this page load'",
    );
  });

  it("the page actually supplies it", () => {
    // The page must pass a REAL completion signal derived from a SUCCEEDED
    // AI_ANALYZE job. The current implementation passes `analysisComplete`
    // which is derived from `Boolean(succeededAnalysisJob)` plus the
    // analysisExtractionStatus check.
    assert.match(
      page,
      /analysisAlreadySucceeded=\{analysisComplete\}/,
      "the tender page must pass a REAL completion signal — a SUCCEEDED AI_ANALYZE job. " +
        "tender.analysisSummary was tried and is empty even after a successful run, so it silently " +
        "kept the panel reporting Pending",
    );
    // Verify analysisComplete is derived from succeededAnalysisJob.
    assert.match(
      page,
      /analysisComplete\s*=\s*Boolean\(succeededAnalysisJob\)/,
      "analysisComplete must be derived from a SUCCEEDED AI_ANALYZE job query",
    );
  });

  it("completion is not gated on polling state alone", () => {
    const line = panel.split("\n").find((l) => l.includes("const analysisComplete"));
    assert.ok(line, "analysisComplete must still exist");
    assert.ok(
      /readiness\?\.analysisCurrent/.test(line!),
      `analysisComplete is derived from canonical readiness, not polling state alone: ${line}`,
    );
  });

  it("still prefers live polling while a job is running", () => {
    // The canonical readiness endpoint provides the completion fact.
    // The `analyzing` state is tracked separately and prevents the panel
    // from showing "complete" while a job is actively running.
    const line = panel.split("\n").find((l) => l.includes("const analysisComplete"))!;
    assert.ok(
      /readiness\?\.analysisCurrent/.test(line),
      "analysisComplete must be derived from canonical readiness",
    );
    // The panel must also track analyzing state separately.
    assert.match(panel, /analyzing.*useState/);
  });
});
